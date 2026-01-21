/**
 * OpenTelemetry configuration and setup utilities for Strands agents.
 *
 * This module provides centralized configuration and initialization functionality
 * for OpenTelemetry components and other telemetry infrastructure shared across Strands applications.
 */

import { context as apiContext, propagation, metrics as metricsApi } from '@opentelemetry/api'
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
import { Resource } from '@opentelemetry/resources'
import { NodeTracerProvider, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node'
import { SimpleSpanProcessor, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { CompositePropagator } from '@opentelemetry/core'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { W3CBaggagePropagator } from '@opentelemetry/core'
import { MeterProvider, PeriodicExportingMetricReader, ConsoleMetricExporter } from '@opentelemetry/sdk-metrics'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { logger } from '../logging/index.js'

/**
 * Options for configuring the meter.
 */
export interface MeterOptions {
  /**
   * Enable console metrics exporter for debugging.
   */
  console?: boolean
  /**
   * Enable OTLP metrics exporter.
   */
  otlp?: boolean
}

/**
 * Get or create the OpenTelemetry resource with service information.
 * Reads from standard OTEL environment variables with sensible defaults.
 */
export function getOtelResource(): Resource {
  const serviceName = process.env.OTEL_SERVICE_NAME || 'strands-agents'
  const serviceNamespace = process.env.OTEL_SERVICE_NAMESPACE || 'strands'
  const deploymentEnvironment = process.env.OTEL_DEPLOYMENT_ENVIRONMENT || 'development'
  
  return new Resource({
    'service.name': serviceName,
    'service.namespace': serviceNamespace,
    'deployment.environment': deploymentEnvironment,
    'telemetry.sdk.name': 'opentelemetry',
    'telemetry.sdk.language': 'typescript',
  })
}

/**
 * Parse OTLP headers from environment variable.
 * Handles format: "key1=value1,key2=value2" with support for values containing '='.
 */
export function parseOtlpHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  const headersEnv = process.env.OTEL_EXPORTER_OTLP_HEADERS
  
  if (!headersEnv) {
    return headers
  }

  const headerPairs = headersEnv.split(',')
  for (const pair of headerPairs) {
    const eqIndex = pair.indexOf('=')
    if (eqIndex > 0) {
      const key = pair.substring(0, eqIndex).trim()
      const value = pair.substring(eqIndex + 1).trim()
      if (key && value) {
        headers[key] = value
      }
    }
  }
  
  return headers
}

// Global tracer provider instance
let _tracerProvider: NodeTracerProvider | null = null

// Global StrandsTelemetry instance - agents automatically pick this up
let _globalTelemetry: StrandsTelemetry | null = null

/**
 * Get the global StrandsTelemetry instance if one has been created.
 * Agents use this to automatically enable telemetry when StrandsTelemetry is instantiated.
 *
 * @returns The global StrandsTelemetry instance, or null if not initialized
 */
export function getGlobalTelemetry(): StrandsTelemetry | null {
  return _globalTelemetry
}

/**
 * Check if global telemetry is enabled.
 * Returns true if StrandsTelemetry has been instantiated.
 *
 * @returns True if telemetry is enabled globally
 */
export function isTelemetryEnabled(): boolean {
  return _globalTelemetry !== null
}

/**
 * Get the global tracer provider instance.
 * @internal
 */
export function getTracerProvider(): NodeTracerProvider | null {
  return _tracerProvider
}

/**
 * Initialize the global tracer provider with OTLP exporter if configured.
 * This is called once on first use and sets up the global tracer provider.
 * Subsequent calls return the same instance (idempotent).
 *
 * @internal
 */
export function initializeTracerProvider(): NodeTracerProvider {
  if (_tracerProvider) {
    return _tracerProvider
  }

  // Register AsyncHooksContextManager for context propagation across async boundaries
  const contextManager = new AsyncHooksContextManager()
  contextManager.enable()
  apiContext.setGlobalContextManager(contextManager)
  
  const resource = getOtelResource()
  _tracerProvider = new NodeTracerProvider({ resource })

  // Set up propagators for distributed tracing
  const propagator = new CompositePropagator({
    propagators: [new W3CBaggagePropagator(), new W3CTraceContextPropagator()],
  })
  propagation.setGlobalPropagator(propagator)

  return _tracerProvider
}

/**
 * Reset tracer provider and global telemetry (for testing only).
 * @internal
 */
export function _resetTracerProvider(): void {
  _tracerProvider = null
  _globalTelemetry = null
}

/**
 * OpenTelemetry configuration and setup for Strands applications.
 *
 * Automatically initializes a tracer provider with text map propagators and
 * registers itself as the global telemetry instance. Agents automatically
 * pick up this global instance for tracing.
 *
 * Trace exporters (console, OTLP) can be set up individually using dedicated methods
 * that support method chaining for convenient configuration.
 *
 * @example
 * ```typescript
 * import { Agent, StrandsTelemetry } from '@strands-agents/sdk'
 *
 * // Initialize telemetry - registers global hook provider
 * const telemetry = new StrandsTelemetry()
 *   .setupOtlpExporter()     // Optional: Export traces to OTLP endpoint
 *   .setupConsoleExporter()  // Optional: Log spans to console
 *   .setupMeter({ otlp: true, console: true })  // Optional: Enable metrics
 *
 * // Create agent - automatically picks up global telemetry
 * const agent = new Agent({
 *   model,
 *   tools: [weather_tool],
 *   customTraceAttributes: {
 *     'session.id': 'abc-1234',
 *     'user.id': 'user@example.com',
 *   },
 * })
 * ```
 */
export class StrandsTelemetry {
  private _tracerProvider: NodeTracerProvider
  private _meterProvider: MeterProvider | null = null

  /**
   * Initialize the StrandsTelemetry instance.
   * Creates and sets the global tracer provider, and registers this instance
   * as the global telemetry provider that agents will automatically use.
   *
   * The instance is ready to use immediately after initialization, though
   * trace exporters must be configured separately using the setup methods.
   */
  constructor() {
    this._tracerProvider = initializeTracerProvider()
    
    // Register as global telemetry instance
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    _globalTelemetry = this
  }

  /**
   * Set up OTLP exporter for the tracer provider.
   * Exports traces to an OpenTelemetry Collector or backend (e.g., Langfuse, Jaeger, Datadog).
   *
   * Configuration is read from environment variables:
   * - OTEL_EXPORTER_OTLP_ENDPOINT: The OTLP endpoint URL (e.g., http://localhost:4317)
   * - OTEL_EXPORTER_OTLP_HEADERS: Optional headers (e.g., Authorization=Basic ...)
   * - OTEL_TRACES_SAMPLER: Sampling strategy (e.g., always_on, always_off, traceidratio)
   *
   * @example
   * ```typescript
   * // Set environment variables
   * process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://cloud.langfuse.com/api/public/otel'
   * process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Basic ...'
   *
   * // Configure telemetry (one-liner, matches Python SDK)
   * const telemetry = new StrandsTelemetry().setupOtlpExporter()
   * ```
   *
   * @returns This instance for method chaining
   */
  setupOtlpExporter(): StrandsTelemetry {
    const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    if (!otlpEndpoint) {
      logger.warn('otlp_endpoint=<not set> | skipping otlp exporter configuration')
      return this
    }

    try {
      const headers = parseOtlpHeaders()
      
      // Build the traces URL - append /v1/traces if not already present
      let tracesUrl = otlpEndpoint
      if (!tracesUrl.endsWith('/v1/traces')) {
        tracesUrl = tracesUrl.replace(/\/$/, '') + '/v1/traces'
      }
      
      const exporter = new OTLPTraceExporter({ url: tracesUrl, headers })
      const batchProcessor = new BatchSpanProcessor(exporter)
      this._tracerProvider.addSpanProcessor(batchProcessor)
    } catch (error) {
      logger.warn(`error=<${error}> | failed to configure otlp exporter`)
    }
    return this
  }

  /**
   * Set up console exporter for the tracer provider.
   * Logs all spans to the console for debugging and development.
   *
   * @example
   * ```typescript
   * const telemetry = new StrandsTelemetry().setupConsoleExporter()
   * ```
   *
   * @returns This instance for method chaining
   */
  setupConsoleExporter(): StrandsTelemetry {
    try {
      const consoleExporter = new ConsoleSpanExporter()
      this._tracerProvider.addSpanProcessor(new SimpleSpanProcessor(consoleExporter))
    } catch (error) {
      logger.warn(`error=<${error}> | failed to configure console exporter`)
    }
    return this
  }

  /**
   * Initialize the OpenTelemetry Meter for metrics collection.
   * 
   * Sets up a MeterProvider with optional console and OTLP exporters for metrics.
   * Metrics can be used to track counters, histograms, and other measurements.
   *
   * @param options - Configuration options for the meter. Supports `console` (boolean) to enable
   *   console metrics exporter for debugging, and `otlp` (boolean) to enable OTLP metrics exporter.
   * @returns This instance for method chaining
   * 
   * @example
   * ```typescript
   * // Enable both console and OTLP metrics exporters
   * const telemetry = new StrandsTelemetry()
   *   .setupOtlpExporter()
   *   .setupMeter({ otlp: true, console: true })
   * ```
   */
  setupMeter(options: MeterOptions = {}): StrandsTelemetry {
    const { console: enableConsole = false, otlp: enableOtlp = false } = options
    
    const metricReaders: PeriodicExportingMetricReader[] = []
    
    try {
      if (enableConsole) {
        try {
          const consoleReader = new PeriodicExportingMetricReader({
            exporter: new ConsoleMetricExporter(),
            exportIntervalMillis: 10000,
          })
          metricReaders.push(consoleReader)
        } catch (error) {
          logger.warn(`error=<${error}> | failed to configure console metrics exporter`)
        }
      }
      
      if (enableOtlp) {
        try {
          const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
          if (!otlpEndpoint) {
            logger.warn('otlp_endpoint=<not set> | skipping otlp metrics exporter')
          } else {
            let metricsUrl = otlpEndpoint.replace(/\/$/, '')
            if (!metricsUrl.endsWith('/v1/metrics')) {
              metricsUrl = metricsUrl + '/v1/metrics'
            }
          
            const headers = parseOtlpHeaders()
            const otlpReader = new PeriodicExportingMetricReader({
              exporter: new OTLPMetricExporter({ url: metricsUrl, headers }),
              exportIntervalMillis: 10000,
            })
            metricReaders.push(otlpReader)
          }
        } catch (error) {
          logger.warn(`error=<${error}> | failed to configure otlp metrics exporter`)
        }
      }
      
      const resource = getOtelResource()
      this._meterProvider = new MeterProvider({
        resource,
        readers: metricReaders,
      })
      
      metricsApi.setGlobalMeterProvider(this._meterProvider)
    } catch (error) {
      logger.warn(`error=<${error}> | failed to configure meter`)
    }

    return this
  }

  /**
   * Flush all pending spans to the configured exporters.
   * This should be called before the application exits to ensure all traces are sent.
   *
   * @returns A promise that resolves when all spans have been flushed
   */
  async flush(): Promise<void> {
    try {
      await this._tracerProvider.forceFlush()
      
      if (this._meterProvider) {
        await this._meterProvider.forceFlush()
      }
    } catch (error) {
      logger.warn(`error=<${error}> | failed to flush telemetry`)
      throw error
    }
  }

  /**
   * Shutdown the telemetry providers and clean up resources.
   * This should be called when the application is shutting down.
   *
   * @returns A promise that resolves when shutdown is complete
   */
  async shutdown(): Promise<void> {
    try {
      await this._tracerProvider.shutdown()
      
      if (this._meterProvider) {
        await this._meterProvider.shutdown()
      }
      
      _globalTelemetry = null
    } catch (error) {
      logger.warn(`error=<${error}> | failed to shutdown telemetry`)
      throw error
    }
  }
}
