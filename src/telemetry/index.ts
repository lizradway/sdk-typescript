/**
 * OpenTelemetry telemetry support for Strands Agents SDK.
 */

import { trace, type Tracer } from '@opentelemetry/api'
import { setupTracer, SERVICE_NAME } from './config.js'

export type { TracerConfig } from './config.js'

/**
 * Telemetry namespace for Strands Agents SDK.
 *
 * @example
 * ```typescript
 * import { telemetry } from '@strands-agents/sdk'
 *
 * // Configure telemetry
 * const provider = telemetry.setupTracer({
 *   exporters: { otlp: true, console: true }
 * })
 *
 * // Get tracer from global API
 * const tracer = telemetry.tracer
 * ```
 */
export const telemetry = {
  setupTracer,

  /**
   * Get the tracer from the global OpenTelemetry API.
   */
  get tracer(): Tracer {
    return trace.getTracer(SERVICE_NAME)
  },
}
