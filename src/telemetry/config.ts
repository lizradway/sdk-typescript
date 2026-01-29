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
import { CompositePropagator, W3CTraceContextPropagator, W3CBaggagePropagator } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { logger } from '../logging/index.js'

export const SERVICE_NAME = 'strands-agents'

const DEFAULT_SERVICE_NAMESPACE = 'strands'
const DEFAULT_DEPLOYMENT_ENVIRONMENT = 'development'

/**
 * Configuration options for setting up the tracer.
 */
export interface TracerConfig {
  /**
   * Custom NodeTracerProvider instance. If not provided, one will be
   * created with default configuration.
   */
  provider?: NodeTracerProvider

  /**
   * Exporter configuration.
   */
  exporters?: {
    /**
     * Enable OTLP exporter. Uses OTEL_EXPORTER_OTLP_ENDPOINT and
     * OTEL_EXPORTER_OTLP_HEADERS env vars automatically.
     */
    otlp?: boolean
    /**
     * Enable console exporter for debugging.
     */
    console?: boolean
  }
}

let _provider: NodeTracerProvider | null = null

/**
 * Set up the tracer provider with the given configuration.
 *
 * @param config - Tracer configuration options
 * @returns The configured NodeTracerProvider
 *
 * @example
 * ```typescript
 * import { telemetry } from '@strands-agents/sdk'
 *
 * // Simple setup with defaults
 * const provider = telemetry.setupTracer({
 *   exporters: { otlp: true }
 * })
 *
 * // Custom provider
 * telemetry.setupTracer({
 *   provider: new NodeTracerProvider({ resource: myResource }),
 *   exporters: { otlp: true, console: true }
 * })
 * ```
 */
export function setupTracer(config: TracerConfig = {}): NodeTracerProvider {
  if (_provider) {
    logger.warn('tracer provider already initialized, returning existing provider')
    return _provider
  }

  // Set up context manager
  const contextManager = new AsyncHooksContextManager()
  contextManager.enable()
  apiContext.setGlobalContextManager(contextManager)

  // Use provided provider or create default
  _provider = config.provider ?? new NodeTracerProvider({ resource: getOtelResource() })

  // Set up propagators
  const propagator = new CompositePropagator({
    propagators: [new W3CBaggagePropagator(), new W3CTraceContextPropagator()],
  })
  propagation.setGlobalPropagator(propagator)

  // Add exporters if requested
  if (config.exporters?.otlp) addOtlpExporter(_provider)
  if (config.exporters?.console) addConsoleExporter(_provider)

  _provider.register()

  process.once('beforeExit', () => {
    if (_provider) {
      _provider.forceFlush().catch((err: unknown) => {
        logger.warn(`error=<${err}> | failed to flush tracer provider on exit`)
      })
    }
  })

  return _provider
}

function addOtlpExporter(provider: NodeTracerProvider): void {
  try {
    provider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter()))
  } catch (error) {
    logger.warn(`error=<${error}> | failed to configure otlp exporter`)
  }
}

function addConsoleExporter(provider: NodeTracerProvider): void {
  try {
    provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()))
  } catch (error) {
    logger.warn(`error=<${error}> | failed to configure console exporter`)
  }
}

function getOtelResource(): Resource {
  const serviceName = process.env.OTEL_SERVICE_NAME || SERVICE_NAME
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

/**
 * Reset the telemetry state (for testing only).
 * @internal
 */
export function _resetTelemetryState(): void {
  _provider = null
}
