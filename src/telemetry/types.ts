/**
 * Type definitions for OpenTelemetry telemetry support.
 */

import type { AttributeValue } from '@opentelemetry/api'
import type { Message } from '../types/messages.js'
import type { Usage, Metrics } from '../models/streaming.js'

// Re-export for convenience
export type { Usage, Metrics }

/**
 * Options for ending an agent span.
 */
export interface EndAgentSpanOptions {
  response?: unknown
  error?: Error
  accumulatedUsage?: Usage
  stopReason?: string
}

/**
 * Options for ending a model invocation span.
 */
export interface EndModelSpanOptions {
  usage?: Usage
  metrics?: Metrics
  error?: Error
  /** Message-like object with 'content' and 'role' properties. */
  output?: unknown
  stopReason?: string
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
  traceAttributes?: Record<string, AttributeValue>
  toolsConfig?: Record<string, unknown>
  systemPrompt?: unknown
}
