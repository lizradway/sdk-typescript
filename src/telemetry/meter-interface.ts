/**
 * Meter interface for custom metrics implementations.
 *
 * This module provides an interface that users can implement to provide
 * custom metrics backends (Datadog, New Relic, Prometheus, custom solutions, etc.)
 * without needing to understand the OpenTelemetry metrics API.
 *
 * @example
 * ```typescript
 * import { IMeter, MeterHookAdapter, Agent } from '@strands-agents/sdk'
 *
 * class DatadogMeter implements IMeter {
 *   recordModelCall(params) {
 *     statsd.histogram('strands.model.tokens', params.usage.totalTokens)
 *     statsd.histogram('strands.model.latency', params.latencyMs)
 *   }
 *   recordToolExecution(params) {
 *     statsd.increment('strands.tool.calls', { tool: params.toolName })
 *     if (!params.success) statsd.increment('strands.tool.errors')
 *   }
 *   // ... implement other methods
 * }
 *
 * const agent = new Agent({
 *   hooks: [new MeterHookAdapter(new DatadogMeter())]
 * })
 * ```
 */

import type { Usage } from './types.js'

/**
 * Parameters for recording a model call.
 */
export interface RecordModelCallParams {
  /** The model ID that was called */
  modelId: string
  /** Token usage from the model call */
  usage: Usage
  /** Latency in milliseconds */
  latencyMs: number
  /** Time to first token in milliseconds (optional) */
  timeToFirstTokenMs?: number | undefined
  /** Whether the call was successful */
  success: boolean
  /** Error message if the call failed */
  error?: string | undefined
  /** Custom attributes to include */
  attributes?: Record<string, string | number | boolean> | undefined
}

/**
 * Parameters for recording a tool execution.
 */
export interface RecordToolExecutionParams {
  /** The name of the tool */
  toolName: string
  /** The unique ID for this tool use */
  toolUseId: string
  /** Duration of the tool execution in seconds */
  durationSeconds: number
  /** Whether the tool execution was successful */
  success: boolean
  /** Error message if the tool failed */
  error?: string | undefined
  /** Custom attributes to include */
  attributes?: Record<string, string | number | boolean> | undefined
}

/**
 * Parameters for recording an agent invocation.
 */
export interface RecordAgentInvocationParams {
  /** The name of the agent */
  agentName: string
  /** The unique identifier of the agent instance */
  agentId: string
  /** The model ID used */
  modelId: string
  /** Total duration of the invocation in seconds */
  durationSeconds: number
  /** Number of event loop cycles */
  cycleCount: number
  /** Accumulated token usage across all model calls */
  usage: Usage
  /** Whether the invocation was successful */
  success: boolean
  /** Error message if the invocation failed */
  error?: string | undefined
  /** Custom attributes to include */
  attributes?: Record<string, string | number | boolean> | undefined
}

/**
 * Parameters for recording an event loop cycle.
 */
export interface RecordCycleParams {
  /** The cycle identifier (e.g., "cycle-1") */
  cycleId: string
  /** Duration of the cycle in seconds */
  durationSeconds: number
  /** Token usage during this cycle */
  usage?: Usage | undefined
  /** Custom attributes to include */
  attributes?: Record<string, string | number | boolean> | undefined
}

/**
 * Interface for custom metrics implementations.
 *
 * Implement this interface to provide custom metrics backends.
 * The MeterHookAdapter will wire your implementation to the agent's
 * hook system automatically.
 *
 * All methods are optional - implement only what you need.
 * Unimplemented methods will be no-ops.
 */
export interface IMeter {
  /**
   * Record metrics for a model call.
   * Called after each model provider call completes.
   *
   * @param params - Parameters including model ID, usage, latency, and success status
   */
  recordModelCall?(params: RecordModelCallParams): void

  /**
   * Record metrics for a tool execution.
   * Called after each tool execution completes.
   *
   * @param params - Parameters including tool name, duration, and success status
   */
  recordToolExecution?(params: RecordToolExecutionParams): void

  /**
   * Record metrics for an agent invocation.
   * Called when agent.invoke() or agent.stream() completes.
   *
   * @param params - Parameters including agent info, duration, cycle count, and usage
   */
  recordAgentInvocation?(params: RecordAgentInvocationParams): void

  /**
   * Record metrics for an event loop cycle.
   * Called when a cycle completes (if cycle tracking is enabled).
   *
   * @param params - Parameters including cycle ID, duration, and usage
   */
  recordCycle?(params: RecordCycleParams): void
}
