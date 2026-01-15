/**
 * Adapter that wires an IMeter implementation to the hooks system.
 *
 * This module provides a HookProvider that delegates to an IMeter implementation,
 * allowing users to provide custom metrics backends without understanding hooks.
 *
 * @example
 * ```typescript
 * import { IMeter, MeterHookAdapter, Agent } from '@strands-agents/sdk'
 *
 * class MyMeter implements IMeter {
 *   recordModelCall(params) { myBackend.recordMetric('model.call', params) }
 *   recordToolExecution(params) { myBackend.recordMetric('tool.exec', params) }
 *   // ... other methods
 * }
 *
 * const agent = new Agent({
 *   hooks: [new MeterHookAdapter(new MyMeter())]
 * })
 * ```
 */

import type { HookProvider } from '../hooks/types.js'
import type { HookRegistry } from '../hooks/registry.js'
import {
  BeforeInvocationEvent,
  AfterInvocationEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  AfterToolsEvent,
} from '../hooks/events.js'
import type { IMeter, TokenUsage } from './meter-interface.js'

/**
 * Configuration options for MeterHookAdapter.
 */
export interface MeterHookAdapterConfig {
  /**
   * Whether to record cycle metrics.
   * When true (default), records metrics for each event loop cycle.
   * When false, only records agent, model, and tool metrics.
   */
  enableCycleMetrics?: boolean
}

/**
 * Creates an empty token usage object.
 */
function createEmptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
  }
}

/**
 * Adapter that wires an IMeter implementation to the agent's hook system.
 *
 * This allows users to implement a simple IMeter interface for custom
 * metrics backends without needing to understand the hooks system.
 *
 * @example
 * ```typescript
 * // Implement IMeter with your custom backend
 * class PrometheusMeter implements IMeter {
 *   recordModelCall(params) {
 *     modelTokensHistogram.observe(params.usage.totalTokens)
 *     modelLatencyHistogram.observe(params.latencyMs)
 *     if (!params.success) modelErrorsCounter.inc()
 *   }
 *
 *   recordToolExecution(params) {
 *     toolCallsCounter.inc({ tool: params.toolName })
 *     toolDurationHistogram.observe(params.durationSeconds)
 *     if (!params.success) toolErrorsCounter.inc({ tool: params.toolName })
 *   }
 *
 *   recordAgentInvocation(params) {
 *     agentInvocationsCounter.inc()
 *     agentDurationHistogram.observe(params.durationSeconds)
 *     agentTokensHistogram.observe(params.usage.totalTokens)
 *   }
 * }
 *
 * // Use with agent
 * const agent = new Agent({
 *   model: 'us.amazon.nova-lite-v1:0',
 *   hooks: [new MeterHookAdapter(new PrometheusMeter())]
 * })
 * ```
 */
export class MeterHookAdapter implements HookProvider {
  private readonly _meter: IMeter
  private readonly _enableCycleMetrics: boolean

  // Timing state
  private _invocationStartTime: number = 0
  private _modelCallStartTime: number = 0
  private _cycleStartTime: number = 0
  private _cycleCount: number = 0
  private readonly _toolStartTimes: Map<string, number> = new Map()

  // Accumulated state
  private _accumulatedUsage: TokenUsage = createEmptyUsage()
  private _cycleUsage: TokenUsage = createEmptyUsage()

  // Agent info (captured at invocation start)
  private _agentName: string = ''
  private _agentId: string = ''
  private _modelId: string = ''

  /**
   * Creates a new MeterHookAdapter.
   *
   * @param meter - The IMeter implementation to delegate to
   * @param config - Optional configuration options
   */
  constructor(meter: IMeter, config?: MeterHookAdapterConfig) {
    this._meter = meter
    this._enableCycleMetrics = config?.enableCycleMetrics ?? true
  }

  /**
   * Register metrics callbacks with the hook registry.
   *
   * @param registry - The hook registry to register callbacks with
   */
  registerCallbacks(registry: HookRegistry): void {
    // Agent lifecycle
    registry.addCallback(BeforeInvocationEvent, this._onBeforeInvocation)
    registry.addCallback(AfterInvocationEvent, this._onAfterInvocation)

    // Model lifecycle
    registry.addCallback(BeforeModelCallEvent, this._onBeforeModelCall)
    registry.addCallback(AfterModelCallEvent, this._onAfterModelCall)

    // Tool lifecycle
    registry.addCallback(BeforeToolCallEvent, this._onBeforeToolCall)
    registry.addCallback(AfterToolCallEvent, this._onAfterToolCall)

    // Cycle lifecycle (only if enabled)
    if (this._enableCycleMetrics) {
      registry.addCallback(AfterToolsEvent, this._onAfterTools)
    }
  }

  /**
   * Handle BeforeInvocationEvent - start timing agent invocation.
   */
  private _onBeforeInvocation = (event: BeforeInvocationEvent): void => {
    // Reset state for new invocation
    this._invocationStartTime = Date.now()
    this._accumulatedUsage = createEmptyUsage()
    this._cycleUsage = createEmptyUsage()
    this._toolStartTimes.clear()
    this._cycleCount = 0
    this._cycleStartTime = 0

    // Capture agent info
    this._agentName = event.agent.name
    this._agentId = event.agent.agentId
    const modelConfig = event.agent.model.getConfig()
    this._modelId = modelConfig.modelId || event.agent.model.constructor.name
  }

  /**
   * Handle AfterInvocationEvent - record agent invocation metrics.
   */
  private _onAfterInvocation = (event: AfterInvocationEvent): void => {
    if (!this._meter.recordAgentInvocation) {
      return
    }

    const durationSeconds = (Date.now() - this._invocationStartTime) / 1000
    const usage = event.accumulatedUsage ?? this._accumulatedUsage

    this._meter.recordAgentInvocation({
      agentName: this._agentName,
      agentId: this._agentId,
      modelId: this._modelId,
      durationSeconds,
      cycleCount: this._cycleCount,
      usage,
      success: !event.error,
      error: event.error?.message,
    })
  }

  /**
   * Handle BeforeModelCallEvent - start timing model call and cycle.
   */
  private _onBeforeModelCall = (_event: BeforeModelCallEvent): void => {
    this._modelCallStartTime = Date.now()

    // Start new cycle if we don't have one
    if (this._enableCycleMetrics && this._cycleStartTime === 0) {
      this._cycleCount++
      this._cycleStartTime = Date.now()
      this._cycleUsage = createEmptyUsage()
    }
  }

  /**
   * Handle AfterModelCallEvent - record model call metrics.
   */
  private _onAfterModelCall = (event: AfterModelCallEvent): void => {
    // Accumulate usage
    if (event.usage) {
      this._accumulatedUsage.inputTokens += event.usage.inputTokens
      this._accumulatedUsage.outputTokens += event.usage.outputTokens
      this._accumulatedUsage.totalTokens += event.usage.totalTokens
      this._accumulatedUsage.cacheReadInputTokens =
        (this._accumulatedUsage.cacheReadInputTokens ?? 0) + (event.usage.cacheReadInputTokens ?? 0)
      this._accumulatedUsage.cacheWriteInputTokens =
        (this._accumulatedUsage.cacheWriteInputTokens ?? 0) + (event.usage.cacheWriteInputTokens ?? 0)

      // Also accumulate to cycle usage
      if (this._enableCycleMetrics) {
        this._cycleUsage.inputTokens += event.usage.inputTokens
        this._cycleUsage.outputTokens += event.usage.outputTokens
        this._cycleUsage.totalTokens += event.usage.totalTokens
        this._cycleUsage.cacheReadInputTokens =
          (this._cycleUsage.cacheReadInputTokens ?? 0) + (event.usage.cacheReadInputTokens ?? 0)
        this._cycleUsage.cacheWriteInputTokens =
          (this._cycleUsage.cacheWriteInputTokens ?? 0) + (event.usage.cacheWriteInputTokens ?? 0)
      }
    }

    // Record model call metrics
    if (this._meter.recordModelCall && event.usage) {
      const latencyMs = event.metrics?.latencyMs ?? Date.now() - this._modelCallStartTime

      this._meter.recordModelCall({
        modelId: this._modelId,
        usage: event.usage,
        latencyMs,
        timeToFirstTokenMs: event.metrics?.timeToFirstByteMs,
        success: !event.error,
        error: event.error?.message,
      })
    }

    // End cycle if not continuing to tools
    if (this._enableCycleMetrics && event.stopData?.stopReason !== 'toolUse' && this._cycleStartTime > 0) {
      this._recordCycleMetrics()
    }
  }

  /**
   * Handle BeforeToolCallEvent - start timing tool execution.
   */
  private _onBeforeToolCall = (event: BeforeToolCallEvent): void => {
    this._toolStartTimes.set(event.toolUse.toolUseId, Date.now())
  }

  /**
   * Handle AfterToolCallEvent - record tool execution metrics.
   */
  private _onAfterToolCall = (event: AfterToolCallEvent): void => {
    if (!this._meter.recordToolExecution) {
      return
    }

    const startTime = this._toolStartTimes.get(event.toolUse.toolUseId)
    if (startTime === undefined) {
      return
    }

    const durationSeconds = (Date.now() - startTime) / 1000
    this._toolStartTimes.delete(event.toolUse.toolUseId)

    this._meter.recordToolExecution({
      toolName: event.toolUse.name,
      toolUseId: event.toolUse.toolUseId,
      durationSeconds,
      success: event.result.status === 'success',
      error: event.error?.message,
    })
  }

  /**
   * Handle AfterToolsEvent - record cycle metrics after tools complete.
   */
  private _onAfterTools = (_event: AfterToolsEvent): void => {
    if (this._cycleStartTime > 0) {
      this._recordCycleMetrics()
    }
  }

  /**
   * Record cycle metrics and reset cycle state.
   */
  private _recordCycleMetrics(): void {
    if (!this._meter.recordCycle) {
      this._cycleStartTime = 0
      return
    }

    const durationSeconds = (Date.now() - this._cycleStartTime) / 1000

    this._meter.recordCycle({
      cycleId: `cycle-${this._cycleCount}`,
      durationSeconds,
      usage: this._cycleUsage,
    })

    // Reset cycle state for next cycle
    this._cycleStartTime = 0
    this._cycleUsage = createEmptyUsage()
  }

  /**
   * Check if cycle metrics are enabled (for testing/debugging).
   * @internal
   */
  get enableCycleMetrics(): boolean {
    return this._enableCycleMetrics
  }

  /**
   * Get the accumulated usage (for testing/debugging).
   * @internal
   */
  get accumulatedUsage(): TokenUsage {
    return { ...this._accumulatedUsage }
  }
}
