/**
 * OpenTelemetry telemetry support for Strands Agents SDK.
 *
 * This module provides:
 * - `setupTracer()`: Configures a NodeTracerProvider with OTLP/console exporters
 * - `Tracer`: Class with agent-specific span methods (startAgentSpan, startToolCallSpan, etc.)
 *
 * The `Tracer` class uses the global OpenTelemetry API internally,
 * so it works with any TracerProvider - whether configured by `setupTracer()`
 * or by your own OpenTelemetry setup.
 *
 * @example Basic setup
 * ```typescript
 * import { telemetry } from '@strands-agents/sdk'
 *
 * // Configure telemetry with OTLP exporter
 * telemetry.setupTracer({ exporters: { otlp: true } })
 * ```
 *
 * @example Using your own OpenTelemetry provider
 * ```typescript
 * import { telemetry } from '@strands-agents/sdk'
 * import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
 *
 * // Set up your own provider
 * const provider = new NodeTracerProvider()
 * provider.register()
 *
 * // Tracer automatically uses your provider via the global OTel API
 * const tracer = new telemetry.Tracer()
 * ```
 */

export { setupTracer } from './config.js'
export type { TracerConfig } from './config.js'
export { Tracer } from './tracer.js'
