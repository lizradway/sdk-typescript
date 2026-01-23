/**
 * OpenTelemetry configuration and setup utilities for Strands agents.
 *
 * This module provides centralized configuration and initialization functionality
 * for OpenTelemetry components and other telemetry infrastructure shared across Strands applications.
 */

import { context as apiContext, propagation } from '@opentelemetry/api'
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
import { Resource } from '@opentelemetry/resources'
import { NodeTracerProvider, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node'
import { SimpleSpanProcessor, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { CompositePropagator } from '@opentelemetry/core'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { W3CBaggagePropagator } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { logger } from '../logging/index.js'

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** Global tracer provider instance */
let _tracerProvider: NodeTracerProvider | null = null

/** Flag indicating telemetry has been initialized */
let _telemetryInitialized = false

/** Flag indicating provider has been registered */
let _providerRegistered = false

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Options for configuring the OTLP exporter.
 */
export interface OtlpExporterOptions {
  /**
   * OTLP endpoint URL. Falls back to OTEL_EXPORTER_OTLP_ENDPOINT env var.
   */
  endpoint?: string
  /**
   * Headers to include in OTLP requests (e.g., for authentication).
   * Falls back to OTEL_EXPORTER_OTLP_HEADERS env var.
   */
  headers?: Record<string, string>
}

/**
 * Interface for the StrandsTelemetry singleton object.
 */
export interface StrandsTelemetry {
  /**
   * Set up OTLP exporter for the tracer provider.
   * @param options - OTLP exporter configuration options
   * @returns This object for method chaining
   */
  setupOtlpExporter(options?: OtlpExporterOptions): StrandsTelemetry
  /**
   * Set up console exporter for the tracer provider.
   * @returns This object for method chaining
   */
  setupConsoleExporter(): StrandsTelemetry
  /**
   * Flush all pending spans and shut down the tracer provider.
   * Call this before your application exits to ensure all traces are exported.
   */
  shutdown(): Promise<void>
}

// ---------------------------------------------------------------------------
// Internal helper functions
// ---------------------------------------------------------------------------

/**
 * Get or create the OpenTelemetry resource with service information.
 * Reads from standard OTEL environment variables with sensible defaults.
 */
function getOtelResource(): Resource {
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
function parseOtlpHeadersFromEnv(): Record<string, string> {
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

/**
 * Build an OTLP URL by appending the path suffix if not already present.
 */
function buildOtlpUrl(endpoint: string, pathSuffix: string): string {
  const baseUrl = endpoint.replace(/\/$/, '')
  if (baseUrl.endsWith(pathSuffix)) {
    return baseUrl
  }
  return baseUrl + pathSuffix
}

/**
 * Get the global StrandsTelemetry singleton.
 * Agents use this to check if telemetry has been configured.
 *
 * @returns The strandsTelemetry singleton, or null if not initialized
 */
export function getGlobalTelemetry(): StrandsTelemetry | null {
  return _telemetryInitialized ? strandsTelemetry : null
}

/**
 * Check if global telemetry is enabled.
 * Returns true if any strandsTelemetry setup method has been called.
 *
 * @returns True if telemetry is enabled globally
 */
export function isTelemetryEnabled(): boolean {
  return _telemetryInitialized
}

// ---------------------------------------------------------------------------
// Internal functions (exported for use by other telemetry modules)
// ---------------------------------------------------------------------------

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

  // Note: register() is called after span processors are added in setupOtlpExporter/setupConsoleExporter

  return _tracerProvider
}

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

/**
 * Reset tracer provider and global telemetry.
 * @internal - For testing only
 */
export function _resetTracerProvider(): void {
  _tracerProvider = null
  _telemetryInitialized = false
  _providerRegistered = false
}

// ---------------------------------------------------------------------------
// StrandsTelemetry singleton
// ---------------------------------------------------------------------------

/**
 * Initialize the singleton telemetry instance.
 * Called automatically on first method call.
 */
function initializeSingleton(): NodeTracerProvider {
  _telemetryInitialized = true
  return initializeTracerProvider()
}

/**
 * OpenTelemetry configuration and setup for Strands applications.
 *
 * A singleton object that initializes a tracer provider with text map propagators
 * and registers itself as the global telemetry instance. Agents automatically
 * pick up this global instance for tracing.
 *
 * Trace exporters (console, OTLP) can be set up individually using dedicated methods
 * that support method chaining for convenient configuration.
 *
 * @example
 * ```typescript
 * import { Agent, strandsTelemetry } from '@strands-agents/sdk'
 *
 * // Initialize telemetry - registers global hook provider
 * strandsTelemetry
 *   .setupOtlpExporter()     // Optional: Export traces to OTLP endpoint
 *   .setupConsoleExporter()  // Optional: Log spans to console
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
export const strandsTelemetry: StrandsTelemetry = {
  setupOtlpExporter(options: OtlpExporterOptions = {}): StrandsTelemetry {
    const tracerProvider = initializeSingleton()
    const otlpEndpoint = options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    if (!otlpEndpoint) {
      logger.warn('otlp_endpoint=<not set> | skipping otlp exporter configuration')
      return this
    }

    try {
      const headers = options.headers ?? parseOtlpHeadersFromEnv()
      const tracesUrl = buildOtlpUrl(otlpEndpoint, '/v1/traces')
      
      const exporter = new OTLPTraceExporter({ url: tracesUrl, headers })
      const batchProcessor = new BatchSpanProcessor(exporter)
      tracerProvider.addSpanProcessor(batchProcessor)
      
      // Register provider after adding processors (only once)
      if (!_providerRegistered) {
        tracerProvider.register()
        _providerRegistered = true
        
        // Auto-flush on process exit for short-lived scripts
        process.on('beforeExit', () => {
          if (_tracerProvider) {
            _tracerProvider.forceFlush()
          }
        })
      }
    } catch (error) {
      logger.warn(`error=<${error}> | failed to configure otlp exporter`)
    }
    return this
  },

  setupConsoleExporter(): StrandsTelemetry {
    const tracerProvider = initializeSingleton()
    try {
      const consoleExporter = new ConsoleSpanExporter()
      tracerProvider.addSpanProcessor(new SimpleSpanProcessor(consoleExporter))
    } catch (error) {
      logger.warn(`error=<${error}> | failed to configure console exporter`)
    }
    return this
  },

  async shutdown(): Promise<void> {
    if (_tracerProvider) {
      await _tracerProvider.forceFlush()
      await _tracerProvider.shutdown()
    }
  },
}
