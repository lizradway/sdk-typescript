/**
 * Type definitions for OpenTelemetry telemetry support.
 */

import type { Span, SpanStatusCode } from '@opentelemetry/api'

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
 * Token usage statistics for a model invocation.
 * Tracks input, output, and total tokens, plus cache-related metrics.
 */
export interface Usage {
  /**
   * Number of tokens in the input (prompt).
   */
  inputTokens: number

  /**
   * Number of tokens in the output (completion).
   */
  outputTokens: number

  /**
   * Total number of tokens (input + output).
   */
  totalTokens: number

  /**
   * Number of input tokens read from cache.
   * This can reduce latency and cost.
   */
  cacheReadInputTokens?: number

  /**
   * Number of input tokens written to cache.
   * These tokens can be reused in future requests.
   */
  cacheWriteInputTokens?: number
}

/**
 * Performance metrics for a model invocation.
 */
export interface Metrics {
  /**
   * Time to first byte/token in milliseconds.
   */
  timeToFirstByteMs?: number

  /**
   * Total latency in milliseconds.
   */
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

/**
 * Span status information.
 */
export interface SpanStatus {
  code: SpanStatusCode
  message?: string
}

/**
 * Content block types for mapping to OTEL format.
 */
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | InterruptResponseBlock | UnknownBlock

/**
 * Text content block.
 */
export interface TextBlock {
  type: 'text'
  text: string
}

/**
 * Tool use content block.
 */
export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

/**
 * Tool result content block.
 */
export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: string | unknown[]
  is_error?: boolean
}

/**
 * Interrupt response content block.
 */
export interface InterruptResponseBlock {
  type: 'interrupt_response'
  content: unknown
}

/**
 * Unknown content block.
 */
export interface UnknownBlock {
  type: string
  [key: string]: unknown
}

/**
 * OTEL parts format for content blocks.
 */
export interface OtelPart {
  type: string
  [key: string]: unknown
}

/**
 * Span wrapper for telemetry operations.
 */
export type TracerSpan = Span | null

/**
 * Options for configuring the OTLP exporter.
 */
export interface OtlpExporterOptions {
  /**
   * The OTLP endpoint URL (e.g., http://localhost:4317).
   * Falls back to OTEL_EXPORTER_OTLP_ENDPOINT environment variable if not provided.
   */
  endpoint?: string

  /**
   * Headers to include in OTLP requests (e.g., Authorization).
   * Falls back to OTEL_EXPORTER_OTLP_HEADERS environment variable if not provided.
   */
  headers?: Record<string, string>
}

/**
 * Options for configuring the meter (metrics).
 */
export interface MeterOptions {
  /**
   * Enable console metrics exporter for debugging.
   * Defaults to false.
   */
  console?: boolean

  /**
   * Enable OTLP metrics exporter.
   * Defaults to false.
   */
  otlp?: boolean

  /**
   * The OTLP endpoint URL for metrics.
   * Falls back to OTEL_EXPORTER_OTLP_ENDPOINT environment variable if not provided.
   */
  endpoint?: string

  /**
   * Headers to include in OTLP metrics requests.
   * Falls back to OTEL_EXPORTER_OTLP_HEADERS environment variable if not provided.
   */
  headers?: Record<string, string>
}
