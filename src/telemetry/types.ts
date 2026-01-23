/**
 * Type definitions for OpenTelemetry telemetry support.
 */

import type { AttributeValue } from '@opentelemetry/api'

/**
 * Telemetry configuration options for the Tracer.
 */
export interface TelemetryConfig {
  /**
   * Custom trace attributes to include in all spans.
   */
  customTraceAttributes?: Record<string, AttributeValue> | undefined
}

/**
 * Token usage statistics for a model invocation.
 */
export interface Usage {
  /** Number of tokens in the input (prompt). */
  inputTokens: number
  /** Number of tokens in the output (completion). */
  outputTokens: number
  /** Total number of tokens (input + output). */
  totalTokens: number
  /** Number of input tokens read from cache. */
  cacheReadInputTokens?: number
  /** Number of input tokens written to cache. */
  cacheWriteInputTokens?: number
}

/**
 * Performance metrics for a model invocation.
 */
export interface Metrics {
  /** Time to first byte/token in milliseconds. */
  timeToFirstByteMs?: number
  /** Total latency in milliseconds. */
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
