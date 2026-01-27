/**
 * OpenTelemetry configuration and setup utilities for Strands agents.
 *
 * This module provides centralized configuration and initialization functionality
 * for OpenTelemetry components and other telemetry infrastructure shared across Strands applications.
 *
 * Note: This module uses NodeTracerProvider and AsyncHooksContextManager, which are
 * Node.js-specific. It works with Node.js and Bun runtimes but is not compatible
 * with browser environments.
 */

import { context as apiContext, propagation } from '@opentelemetry/api'
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
import { Resource } from '@opentelemetry/resources'
import { NodeTracerProvider, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node'
import { SimpleSpanProcessor, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { CompositePropagator, W3CTraceContextPropagator, W3CBaggagePropagator } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { logger } from '../logging/index.js'

/**
 * Options for configuring the OTLP exporter.
 */
export interface OtlpExporterOptions {
  /**
   * OTLP endpoint URL. Falls back to OTEL_EXPORTER_OTLP_ENDPOINT env var.
   * Must be a valid HTTP/HTTPS URL (e.g., 'http://localhost:4318').
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
 *
 * If no exporter is configured, the tracer provider is still initialized but
 * spans will not be exported anywhere. This is useful for testing or when
 * tracing is disabled.
 *
 * Setup methods are safe to call multiple times - each call adds an additional
 * exporter. The tracer provider is initialized lazily on first setup call.
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
 * // Initialize telemetry - registers global tracer provider
 * strandsTelemetry
 *   .setupOtlpExporter()     // Optional: Export traces to OTLP endpoint
 *   .setupConsoleExporter()  // Optional: Log spans to console
 *
 * // Create agent - automatically picks up global telemetry
 * const agent = new Agent({
 *   model,
 *   tools: [weather_tool],
 *   traceAttributes: {
 *     'session.id': 'abc-1234',
 *     'user.id': 'user@example.com',
 *   },
 * })
 * ```
 */
export const strandsTelemetry: StrandsTelemetry = {
  setupOtlpExporter(options: OtlpExporterOptions = {}): StrandsTelemetry {
    const tracerProvider = initializeTracerProvider()

    try {
      // Only pass explicit options if provided - OTEL SDK handles env vars automatically
      const exporterConfig: { url?: string; headers?: Record<string, string> } = {}
      if (options.endpoint) exporterConfig.url = options.endpoint
      if (options.headers) exporterConfig.headers = options.headers

      const exporter = new OTLPTraceExporter(exporterConfig)
      const batchProcessor = new BatchSpanProcessor(exporter)
      registerProviderWithProcessor(tracerProvider, batchProcessor)
    } catch (error) {
      logger.warn(`error=<${error}> | failed to configure otlp exporter`)
    }
    return this
  },

  setupConsoleExporter(): StrandsTelemetry {
    const tracerProvider = initializeTracerProvider()
    try {
      const consoleExporter = new ConsoleSpanExporter()
      const simpleProcessor = new SimpleSpanProcessor(consoleExporter)
      registerProviderWithProcessor(tracerProvider, simpleProcessor)
    } catch (error) {
      logger.warn(`error=<${error}> | failed to configure console exporter`)
    }
    return this
  },
}

/**
 * Initialize the tracer provider. Safe to call multiple times - returns the existing
 * provider if already initialized. Sets up AsyncHooksContextManager for context
 * propagation across async boundaries and configures W3C trace context propagators
 * for distributed tracing.
 */
function initializeTracerProvider(): NodeTracerProvider {
  if (_tracerProvider) {
    return _tracerProvider
  }

  const contextManager = new AsyncHooksContextManager()
  contextManager.enable()
  apiContext.setGlobalContextManager(contextManager)

  const resource = getOtelResource()
  _tracerProvider = new NodeTracerProvider({ resource })

  const propagator = new CompositePropagator({
    propagators: [new W3CBaggagePropagator(), new W3CTraceContextPropagator()],
  })
  propagation.setGlobalPropagator(propagator)

  return _tracerProvider
}

/**
 * Register a span processor and ensure the provider is registered globally.
 * On first registration, also sets up a beforeExit handler to auto-flush
 * pending spans - important for short-lived scripts that exit before
 * the BatchSpanProcessor's scheduled export.
 */
function registerProviderWithProcessor(tracerProvider: NodeTracerProvider, processor: SpanProcessor): void {
  tracerProvider.addSpanProcessor(processor)

  if (!_providerRegistered) {
    tracerProvider.register()
    _providerRegistered = true

    process.on('beforeExit', () => {
      if (_tracerProvider) {
        _tracerProvider.forceFlush().catch((err) => {
          logger.warn(`error=<${err}> | failed to flush tracer provider on exit`)
        })
      }
    })
  }
}

function getOtelResource(): Resource {
  const serviceName = process.env.OTEL_SERVICE_NAME || DEFAULT_SERVICE_NAME
  const serviceNamespace = process.env.OTEL_SERVICE_NAMESPACE || DEFAULT_SERVICE_NAMESPACE
  const deploymentEnvironment = process.env.OTEL_DEPLOYMENT_ENVIRONMENT || DEFAULT_DEPLOYMENT_ENVIRONMENT

  return new Resource({
    'service.name': serviceName,
    'service.namespace': serviceNamespace,
    'deployment.environment': deploymentEnvironment,
    'telemetry.sdk.name': 'opentelemetry',
    'telemetry.sdk.language': 'typescript',
  })
}

const DEFAULT_SERVICE_NAME = 'strands-agents'
const DEFAULT_SERVICE_NAMESPACE = 'strands'
const DEFAULT_DEPLOYMENT_ENVIRONMENT = 'development'

let _tracerProvider: NodeTracerProvider | null = null
let _providerRegistered = false
