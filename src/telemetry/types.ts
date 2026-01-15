/**
 * Type definitions for OpenTelemetry telemetry support.
 */

import type { Span, SpanStatusCode } from '@opentelemetry/api'

/**
 * Telemetry configuration options.
 */
export interface TelemetryConfig {
  /**
   * Enable telemetry collection.
   * Defaults to true if OTEL_EXPORTER_OTLP_ENDPOINT is set.
   */
  enabled?: boolean

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
