/**
 * Type definitions for OpenTelemetry telemetry support.
 */

/**
 * Telemetry configuration options for the Tracer.
 */
export interface TelemetryConfig {
  /**
   * Custom trace attributes to include in all spans.
   */
  customTraceAttributes?: Record<string, AttributeValue>
}

/**
 * OpenTelemetry attribute value types.
 * Must match OpenTelemetry API's AttributeValue type.
 */
export type AttributeValue = 
  | string 
  | number 
  | boolean 
  | Array<null | undefined | string> 
  | Array<null | undefined | number> 
  | Array<null | undefined | boolean>

/**
 * Usage information from model calls.
 */
export interface Usage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadInputTokens?: number
  cacheWriteInputTokens?: number
}

/**
 * Metrics from model calls.
 */
export interface Metrics {
  timeToFirstByteMs?: number
  latencyMs?: number
}

/**
 * Tool use information for tracing.
 */
export interface ToolUse {
  name: string
  toolUseId: string
  input: unknown
}

/**
 * Tool result information for tracing.
 */
export interface ToolResult {
  toolUseId: string
  status: 'success' | 'error'
  content: unknown
}
