/**
 * Type definitions for OpenTelemetry telemetry support.
 */

import type { AttributeValue } from '@opentelemetry/api'
import type { Message } from '../types/messages.js'
import type { Usage, Metrics } from '../models/streaming.js'
import type { ToolUse, ToolResult } from '../tools/types.js'

// Re-export for convenience
export type { Usage, Metrics, ToolUse, ToolResult }

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
 * Options for ending a model invocation span.
 */
export interface EndModelSpanOptions {
  usage?: Usage | undefined
  metrics?: Metrics | undefined
  error?: Error | undefined
  output?: unknown
  stopReason?: string | undefined
}

/**
 * Options for starting an agent span.
 */
export interface StartAgentSpanOptions {
  messages: Message[]
  agentName: string
  agentId?: string
  modelId?: string
  tools?: unknown[]
  customTraceAttributes?: Record<string, AttributeValue>
  toolsConfig?: Record<string, unknown>
  systemPrompt?: unknown
}

/**
 * Options for starting a model invocation span.
 */
export interface StartModelInvokeSpanOptions {
  messages: Message[]
  modelId?: string
  customTraceAttributes?: Record<string, AttributeValue>
}

/**
 * Options for starting a tool call span.
 */
export interface StartToolCallSpanOptions {
  tool: ToolUse
  customTraceAttributes?: Record<string, AttributeValue>
}

/**
 * Options for starting an event loop cycle span.
 */
export interface StartEventLoopCycleSpanOptions {
  cycleId: string
  messages: Message[]
  customTraceAttributes?: Record<string, AttributeValue>
}
