/**
 * OpenTelemetry telemetry support for Strands Agents SDK.
 */

import { trace, type Tracer } from '@opentelemetry/api'
import { telemetryConfig } from './config.js'

const SERVICE_NAME = 'strands-agents'

/**
 * Telemetry namespace for Strands Agents SDK.
 *
 * @example
 * ```typescript
 * import { telemetry } from '@strands-agents/sdk'
 *
 * // Configure telemetry (registers global tracer provider)
 * telemetry.config
 *   .setupOtlpExporter()
 *   .setupConsoleExporter()
 *
 * // Get tracer from global API - respects user's provider if they set one up
 * const tracer = telemetry.tracer
 * ```
 */
export const telemetry = {
  config: telemetryConfig,

  /**
   * Get the tracer from the global OpenTelemetry API.
   *
   * Always retrieves the tracer from the globally registered tracer provider,
   * ensuring we respect any user-configured provider rather than storing our own.
   */
  get tracer(): Tracer {
    return trace.getTracer(SERVICE_NAME)
  },
}
