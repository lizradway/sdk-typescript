/**
 * Tracer interface for custom telemetry implementations.
 *
 * This module provides an interface that users can implement to provide
 * custom tracing backends (Datadog, New Relic, custom solutions, etc.)
 * without needing to understand the hooks system.
 *
 * @example
 * ```typescript
 * import { ITracer, TracerHookAdapter, Agent } from '@strands-agents/sdk'
 *
 * class DatadogTracer implements ITracer {
 *   startAgentSpan(params) {
 *     return dd.startSpan('agent.invoke', { tags: params })
 *   }
 *   endAgentSpan(span, params) {
 *     if (params.error) span.setError(params.error)
 *     span.finish()
 *   }
 *   // ... implement other methods
 * }
 *
 * const agent = new Agent({
 *   hooks: [new TracerHookAdapter(new DatadogTracer())]
 * })
 * ```
 */

import type { Message, ToolResultBlock } from '../types/messages.js'
import type { Tool } from '../tools/tool.js'
import type { JSONValue } from '../types/json.js'

/**
 * Generic span type that tracers return.
 * Can be any object that the tracer implementation uses to track spans.
 */
export type TracerSpanHandle = unknown

/**
 * Parameters for starting an agent span.
 */
export interface StartAgentSpanParams {
  /** The name of the agent */
  agentName: string
  /** The unique identifier of the agent instance */
  agentId: string
  /** The model ID being used */
  modelId: string
  /** The input messages for this invocation */
  inputMessages: Message[]
  /** The tools available to the agent */
  tools: Tool[]
  /** The system prompt (if configured) */
  systemPrompt?: unknown
}

/**
 * Parameters for ending an agent span.
 */
export interface EndAgentSpanParams {
  /** The final response message (if successful) */
  response?: Message | undefined
  /** The stop reason from the model */
  stopReason?: string | undefined
  /** Error that occurred during invocation (if any) */
  error?: Error | undefined
  /** Accumulated token usage across all model calls */
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cacheReadInputTokens?: number
    cacheWriteInputTokens?: number
  }
}

/**
 * Parameters for starting a model span.
 */
export interface StartModelSpanParams {
  /** The model ID being called */
  modelId: string
  /** The messages being sent to the model */
  messages: Message[]
  /** Parent span handle (agent or cycle span) */
  parentSpan?: TracerSpanHandle
}

/**
 * Parameters for ending a model span.
 */
export interface EndModelSpanParams {
  /** The response message from the model */
  response?: Message | undefined
  /** The stop reason from the model */
  stopReason?: string | undefined
  /** Error that occurred during model call (if any) */
  error?: Error | undefined
  /** Token usage from this model call */
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cacheReadInputTokens?: number
    cacheWriteInputTokens?: number
  } | undefined
  /** Performance metrics from this model call */
  metrics?: {
    timeToFirstByteMs?: number
    latencyMs?: number
  } | undefined
}

/**
 * Parameters for starting a tool span.
 */
export interface StartToolSpanParams {
  /** The name of the tool being called */
  toolName: string
  /** The unique ID for this tool use */
  toolUseId: string
  /** The input parameters for the tool */
  input: JSONValue
  /** Parent span handle (agent or cycle span) */
  parentSpan?: TracerSpanHandle
}

/**
 * Parameters for ending a tool span.
 */
export interface EndToolSpanParams {
  /** The result from the tool execution */
  result: ToolResultBlock
  /** Error that occurred during tool execution (if any) */
  error?: Error | undefined
}

/**
 * Parameters for starting a cycle span.
 */
export interface StartCycleSpanParams {
  /** The cycle identifier (e.g., "cycle-1") */
  cycleId: string
  /** The messages at the start of this cycle */
  messages: Message[]
  /** Parent span handle (agent span) */
  parentSpan?: TracerSpanHandle
}

/**
 * Parameters for ending a cycle span.
 */
export interface EndCycleSpanParams {
  /** The assistant response message (if cycle ended with model response) */
  response?: Message | undefined
  /** The tool result message (if cycle ended with tool execution) */
  toolResultMessage?: Message | undefined
  /** Error that occurred during the cycle (if any) */
  error?: Error | undefined
}

/**
 * Interface for custom tracer implementations.
 *
 * Implement this interface to provide custom tracing backends.
 * The TracerHookAdapter will wire your implementation to the agent's
 * hook system automatically.
 *
 * All methods are optional - implement only what you need.
 * Unimplemented methods will be no-ops.
 */
export interface ITracer {
  /**
   * Start a span for an agent invocation.
   * Called at the beginning of agent.invoke() or agent.stream().
   *
   * @param params - Parameters including agent info, model ID, and input messages
   * @returns A span handle to pass to endAgentSpan, or undefined to skip tracing
   */
  startAgentSpan?(params: StartAgentSpanParams): TracerSpanHandle | undefined

  /**
   * End an agent invocation span.
   * Called when agent.invoke() or agent.stream() completes.
   *
   * @param span - The span handle returned by startAgentSpan
   * @param params - Parameters including response, error, and usage
   */
  endAgentSpan?(span: TracerSpanHandle, params: EndAgentSpanParams): void

  /**
   * Start a span for a model call.
   * Called before each call to the model provider.
   *
   * @param params - Parameters including model ID and messages
   * @returns A span handle to pass to endModelSpan, or undefined to skip tracing
   */
  startModelSpan?(params: StartModelSpanParams): TracerSpanHandle | undefined

  /**
   * End a model call span.
   * Called after the model provider returns.
   *
   * @param span - The span handle returned by startModelSpan
   * @param params - Parameters including response, error, and usage
   */
  endModelSpan?(span: TracerSpanHandle, params: EndModelSpanParams): void

  /**
   * Start a span for a tool execution.
   * Called before each tool is executed.
   *
   * @param params - Parameters including tool name, ID, and input
   * @returns A span handle to pass to endToolSpan, or undefined to skip tracing
   */
  startToolSpan?(params: StartToolSpanParams): TracerSpanHandle | undefined

  /**
   * End a tool execution span.
   * Called after tool execution completes.
   *
   * @param span - The span handle returned by startToolSpan
   * @param params - Parameters including result and error
   */
  endToolSpan?(span: TracerSpanHandle, params: EndToolSpanParams): void

  /**
   * Start a span for an event loop cycle.
   * Called at the start of each agent loop iteration.
   * Only called if cycle spans are enabled.
   *
   * @param params - Parameters including cycle ID and messages
   * @returns A span handle to pass to endCycleSpan, or undefined to skip tracing
   */
  startCycleSpan?(params: StartCycleSpanParams): TracerSpanHandle | undefined

  /**
   * End an event loop cycle span.
   * Called when a cycle completes (either with model response or after tools).
   * Only called if cycle spans are enabled.
   *
   * @param span - The span handle returned by startCycleSpan
   * @param params - Parameters including response and error
   */
  endCycleSpan?(span: TracerSpanHandle, params: EndCycleSpanParams): void
}
