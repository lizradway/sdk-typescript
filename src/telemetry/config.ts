/**
 * OpenTelemetry configuration and setup utilities for Strands agents.
 *
 * This module provides centralized configuration and initialization functionality
 * for OpenTelemetry components and other telemetry infrastructure shared across Strands applications.
 *
 * @remarks
 * **Runtime Compatibility**: The telemetry module is designed for server-side JavaScript runtimes:
 * - **Node.js**: Fully supported (18+)
 * - **Bun**: Fully supported
 * - **Browsers**: Not supported - telemetry uses Node-specific packages (`@opentelemetry/sdk-trace-node`,
 *   `@opentelemetry/context-async-hooks`) and `process.env` which are not available in browsers.
 *
 * For browser-based applications, you can:
 * - Disable telemetry (`telemetryConfig: { enabled: false }`)
 * - Use the `ITracer` and `IMeter` interfaces to implement browser-compatible telemetry
 *
 * **GenAI Semantic Conventions Warning**: This SDK uses OpenTelemetry GenAI semantic conventions
 * which are currently experimental and subject to change. The default behavior uses stable conventions,
 * but you can opt-in to the latest experimental conventions by setting:
 *
 * ```
 * OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
 * ```
 *
 * Be aware that experimental conventions may change in future releases, potentially requiring
 * updates to your telemetry queries and dashboards.
 *
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/ for GenAI semantic conventions
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
import type { OtlpExporterOptions, MeterOptions } from './types.js'
import { TelemetryHookProvider } from './telemetry-hook-provider.js'
import type { HookProvider } from '../hooks/types.js'

/**
 * Get or create the OpenTelemetry resource with service information.
 * Reads from standard OTEL environment variables with sensible defaults.
 */
export function getOtelResource(): Resource {
  // Read from standard OTEL env vars, with defaults
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

// Global tracer provider instance
let _tracerProvider: NodeTracerProvider | null = null

// Global telemetry hook provider - set when StrandsTelemetry is instantiated
let _globalTelemetryHookProvider: HookProvider | null = null

/**
 * Get the global telemetry hook provider.
 * Returns the hook provider if StrandsTelemetry has been instantiated, null otherwise.
 */
export function getGlobalTelemetryHookProvider(): HookProvider | null {
  return _globalTelemetryHookProvider
}

/**
 * Reset global telemetry hook provider (for testing only).
 * @internal
 */
export function _resetGlobalTelemetryHookProvider(): void {
  _globalTelemetryHookProvider = null
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
    logger.warn('tracer_provider=<cached> | returning cached tracer provider')
    return _tracerProvider
  }

  logger.warn('tracer_provider=<initializing> | creating new node tracer provider')
  
  // Register AsyncHooksContextManager for context propagation across async boundaries
  // This is CRITICAL for MCP trace context propagation to work
  const contextManager = new AsyncHooksContextManager()
  contextManager.enable()
  apiContext.setGlobalContextManager(contextManager)
  logger.warn('context_manager=<registered> | AsyncHooksContextManager enabled for async context propagation')
  
  const resource = getOtelResource()
  _tracerProvider = new NodeTracerProvider({ resource })
  logger.warn(`tracer_provider=<created> | resource.service.name=<${resource.attributes['service.name']}>`)

  // NodeTracerProvider auto-registers itself as the global provider
  logger.warn('tracer_provider=<registered> | node tracer provider auto-registered as global')

  // Set up propagators
  const propagator = new CompositePropagator({
    propagators: [new W3CBaggagePropagator(), new W3CTraceContextPropagator()],
  })
  propagation.setGlobalPropagator(propagator)
  logger.warn('propagators=<configured> | composite propagator with W3C trace context and baggage')

  return _tracerProvider
}

/**
 * Reset tracer provider (for testing only).
 * @internal
 */
export function _resetTracerProvider(): void {
  _tracerProvider = null
}

/**
 * Configuration options for StrandsTelemetry.
 */
export interface StrandsTelemetryConfig {
  /**
   * Enable cycle spans in the trace hierarchy.
   * When true (default), traces include cycle spans that group model calls and tool executions.
   * When false, model and tool spans are direct children of the agent span (flat hierarchy).
   *
   * With cycle spans (default):
   * ```
   * Agent Span
   * ├── Cycle Span (cycle-1)
   * │   ├── Model Span (chat)
   * │   └── Tool Span (execute_tool)
   * └── Cycle Span (cycle-2)
   *     └── Model Span (chat)
   * ```
   *
   * Without cycle spans:
   * ```
   * Agent Span
   * ├── Model Span (chat)
   * ├── Tool Span (execute_tool)
   * └── Model Span (chat)
   * ```
   */
  enableCycleSpans?: boolean
}

/**
 * OpenTelemetry configuration and setup for Strands applications.
 *
 * Automatically initializes a tracer provider with text map propagators and
 * registers a global telemetry hook provider. When instantiated, telemetry is
 * automatically enabled for all Agent instances.
 *
 * Trace exporters (console, OTLP) can be set up individually using dedicated methods
 * that support method chaining for convenient configuration.
 *
 * @example
 * ```typescript
 * // Enable telemetry for all agents
 * const telemetry = new StrandsTelemetry().setupOtlpExporter()
 *
 * // Create agent with custom trace attributes
 * const agent = new Agent({
 *   model,
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
   * Creates and sets the global tracer provider and registers a global telemetry hook provider.
   * Use method chaining to configure exporters (setupOtlpExporter, setupConsoleExporter, setupMeter).
   *
   * @param config - Optional configuration for telemetry behavior
   */
  constructor(config?: StrandsTelemetryConfig) {
    this._tracerProvider = initializeTracerProvider()

    // Register global telemetry hook provider with defaults
    _globalTelemetryHookProvider = new TelemetryHookProvider({
      enableCycleSpans: config?.enableCycleSpans ?? true,
    })
    logger.warn('telemetry=<enabled> | global telemetry hook provider registered')
  }

  /**
   * Set up OTLP exporter for the tracer provider.
   * Exports traces to an OpenTelemetry Collector or backend (e.g., Langfuse, Jaeger, Datadog).
   *
   * Configuration can be provided via parameters or environment variables:
   * - OTEL_EXPORTER_OTLP_ENDPOINT: The OTLP endpoint URL (e.g., http://localhost:4317)
   * - OTEL_EXPORTER_OTLP_HEADERS: Optional headers (e.g., Authorization=Basic ...)
   * - OTEL_TRACES_SAMPLER: Sampling strategy (e.g., always_on, always_off, traceidratio)
   *
   * @param options - Optional configuration for the OTLP exporter
   * @returns This instance for method chaining
   *
   * @example
   * ```typescript
   * // Using environment variables (12-factor app style)
   * process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://cloud.langfuse.com/api/public/otel'
   * process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Basic ...'
   * const telemetry = new StrandsTelemetry().setupOtlpExporter()
   *
   * // Using parameters (explicit configuration)
   * const telemetry = new StrandsTelemetry().setupOtlpExporter({
   *   endpoint: 'https://cloud.langfuse.com/api/public/otel',
   *   headers: { 'Authorization': 'Basic ...' }
   * })
   * ```
   */
  setupOtlpExporter(options?: OtlpExporterOptions): StrandsTelemetry {
    const otlpEndpoint = options?.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    if (!otlpEndpoint) {
      logger.warn('otlp_endpoint=<not set> | skipping otlp exporter configuration')
      return this
    }

    try {
      logger.warn(`otlp_endpoint=<${otlpEndpoint}> | configuring otlp exporter`)
      
      // Use provided headers or parse from environment variable
      let headers: Record<string, string> = {}
      if (options?.headers) {
        headers = options.headers
      } else {
        const headersEnv = process.env.OTEL_EXPORTER_OTLP_HEADERS
        if (headersEnv) {
          // Parse headers in format: "key1=value1,key2=value2"
          // Use indexOf to handle values containing '=' (like base64)
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
        }
      }
      
      if (Object.keys(headers).length > 0) {
        logger.warn(`otlp_headers=<${Object.keys(headers).join(', ')}> | headers configured`)
      }
      
      // Build the traces URL - append /v1/traces if not already present
      let tracesUrl = otlpEndpoint
      if (!tracesUrl.endsWith('/v1/traces')) {
        tracesUrl = tracesUrl.replace(/\/$/, '') + '/v1/traces'
      }
      
      const exporter = new OTLPTraceExporter({
        url: tracesUrl,
        headers,
      })
      logger.warn('otlp_exporter=<created> | instantiated OTLPTraceExporter')
      
      // Use BatchSpanProcessor for OTLP export (matching Python SDK behavior)
      // BatchSpanProcessor batches spans for better throughput in production
      const batchProcessor = new BatchSpanProcessor(exporter)
      this._tracerProvider.addSpanProcessor(batchProcessor)
      logger.warn(`otlp_endpoint=<${otlpEndpoint}> | initialized opentelemetry with otlp export`)
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
      logger.warn('enabling console export')
      const consoleExporter = new ConsoleSpanExporter()
      this._tracerProvider.addSpanProcessor(new SimpleSpanProcessor(consoleExporter))
      console.log('[OTEL] Console exporter configured - spans will be logged to console')
      logger.warn('console_exporter=<configured> | spans will be logged to console')
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
   * @param options - Configuration options for the meter
   * @returns This instance for method chaining
   * 
   * @example
   * ```typescript
   * // Enable OTLP metrics exporter only
   * const telemetry = new StrandsTelemetry()
   *   .setupOtlpExporter()
   *   .setupMeter({ otlp: true })
   * 
   * // Enable both console and OTLP metrics exporters
   * const telemetry = new StrandsTelemetry()
   *   .setupOtlpExporter()
   *   .setupMeter({ console: true, otlp: true })
   *
   * // With explicit endpoint configuration
   * const telemetry = new StrandsTelemetry()
   *   .setupMeter({
   *     otlp: true,
   *     endpoint: 'https://my-collector.example.com',
   *     headers: { 'Authorization': 'Bearer ...' }
   *   })
   * 
   * // Get a meter and create metrics
   * const meter = metricsApi.getMeter('my-agent')
   * const counter = meter.createCounter('agent.invocations')
   * counter.add(1)
   * ```
   */
  setupMeter(options: MeterOptions = {}): StrandsTelemetry {
    const { console: enableConsole = false, otlp: enableOtlp = false } = options
    
    logger.warn('initializing meter')
    
    const metricReaders: PeriodicExportingMetricReader[] = []
    
    try {
      if (enableConsole) {
        logger.warn('enabling console metrics exporter')
        try {
          const consoleReader = new PeriodicExportingMetricReader({
            exporter: new ConsoleMetricExporter(),
            exportIntervalMillis: 10000,
          })
          metricReaders.push(consoleReader)
          console.log('[OTEL] Console metrics exporter configured')
          logger.warn('console_metrics_exporter=<configured> | metrics will be logged to console')
        } catch (error) {
          logger.warn(`error=<${error}> | failed to configure console metrics exporter`)
        }
      }
      
      if (enableOtlp) {
        logger.warn('enabling otlp metrics exporter')
        try {
          // Use provided endpoint or fall back to environment variable
          const otlpEndpoint = options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT
          if (!otlpEndpoint) {
            console.log('[OTEL] No OTLP endpoint configured, skipping metrics exporter')
            logger.warn('otlp_endpoint=<not set> | skipping otlp metrics exporter')
          } else {
            // Build the metrics URL - append /v1/metrics if not already present
            let metricsUrl = otlpEndpoint.replace(/\/$/, '')
            if (!metricsUrl.endsWith('/v1/metrics')) {
              metricsUrl = metricsUrl + '/v1/metrics'
            }
            console.log(`[OTEL] Metrics URL: ${metricsUrl}`)
          
            // Use provided headers or parse from environment variable
            let headers: Record<string, string> = {}
            if (options.headers) {
              headers = options.headers
            } else {
              const headersEnv = process.env.OTEL_EXPORTER_OTLP_HEADERS
              if (headersEnv) {
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
              }
            }
          
            const otlpReader = new PeriodicExportingMetricReader({
              exporter: new OTLPMetricExporter({
                url: metricsUrl,
                headers,
              }),
              exportIntervalMillis: 10000,
            })
            metricReaders.push(otlpReader)
            console.log('[OTEL] OTLP metrics exporter configured')
            logger.warn('otlp_metrics_exporter=<configured> | metrics will be exported via OTLP')
          }
        } catch (error) {
          console.log(`[OTEL] Error configuring OTLP metrics exporter: ${error}`)
          logger.warn(`error=<${error}> | failed to configure OTLP metrics exporter`)
        }
      }
      
      // Create MeterProvider with the resource and readers
      const resource = getOtelResource()
      this._meterProvider = new MeterProvider({
        resource,
        readers: metricReaders,
      })
      
      // Set as global meter provider
      metricsApi.setGlobalMeterProvider(this._meterProvider)
      
      console.log('[OTEL] Strands Meter configured')
      logger.warn('strands_meter=<configured> | meter provider set as global')
    } catch (error) {
      console.log(`[OTEL] Error configuring meter: ${error}`)
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
      logger.warn('flushing telemetry to exporters')
      await this._tracerProvider.forceFlush()
      logger.warn('spans flushed successfully')
      
      // Also flush metrics if meter provider is configured
      if (this._meterProvider) {
        await this._meterProvider.forceFlush()
        logger.warn('metrics flushed successfully')
      }
    } catch (error) {
      logger.warn(`error=<${error}> | failed to flush telemetry`)
      throw error
    }
  }
}
