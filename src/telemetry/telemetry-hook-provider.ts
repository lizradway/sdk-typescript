/**
 * Hook-based telemetry provider for Strands Agents SDK.
 *
 * This module provides a HookProvider implementation that enables
 * OpenTelemetry tracing through the hooks system.
 *
 * @internal This class is used internally by the Agent when telemetryConfig is enabled.
 * Users should configure telemetry via AgentConfig.telemetryConfig, not by using this class directly.
 */

import type { Span } from '@opentelemetry/api'
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
  type AccumulatedUsage,
} from '../hooks/events.js'
import { Tracer } from './tracer.js'
import type { TelemetryConfig, TracerSpan } from './types.js'
import { logger } from '../logging/index.js'

/**
 * Creates an empty accumulated usage object.
 */
function createEmptyUsage(): AccumulatedUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
  }
}

/**
 * Internal hook-based telemetry provider that creates OpenTelemetry spans
 * for agent lifecycle events.
 *
 * This provider is automatically created and registered by the Agent when
 * telemetryConfig.enabled is true. Users should not instantiate this class directly.
 *
 * @internal
 */
export class TelemetryHookProvider implements HookProvider {
  private readonly _tracer: Tracer
  private readonly _debug: boolean
  private readonly _enableCycleSpans: boolean
  private _agentSpan: TracerSpan = null
  private _cycleSpan: TracerSpan = null
  private _cycleCount: number = 0
  private _modelSpan: TracerSpan = null
  private readonly _toolSpans: Map<string, Span> = new Map()
  private _accumulatedUsage: AccumulatedUsage = createEmptyUsage()

  /**
   * Creates a new TelemetryHookProvider.
   *
   * @param config - Telemetry configuration options
   * @internal
   */
  constructor(config?: TelemetryConfig & { debug?: boolean }) {
    this._tracer = new Tracer(config)
    this._debug = config?.debug ?? false
    this._enableCycleSpans = config?.enableCycleSpans ?? true
  }

  /**
   * Register telemetry callbacks with the hook registry.
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
    
    // Only register AfterToolsEvent if cycle spans are enabled
    // (used to end cycle span after tools complete)
    if (this._enableCycleSpans) {
      registry.addCallback(AfterToolsEvent, this._onAfterTools)
    }
  }

  /**
   * Handle BeforeInvocationEvent - start agent span.
   */
  private _onBeforeInvocation = (event: BeforeInvocationEvent): void => {
    this._log(`Starting agent span for ${event.agent.name}`)

    // Reset state for new invocation
    this._accumulatedUsage = createEmptyUsage()
    this._toolSpans.clear()
    this._modelSpan = null
    this._cycleSpan = null
    this._cycleCount = 0

    // Get model ID from agent
    const modelConfig = event.agent.model.getConfig()
    const modelId = modelConfig.modelId || event.agent.model.constructor.name

    // Start agent span with system prompt
    this._agentSpan = this._tracer.startAgentSpan(
      event.inputMessages,
      event.agent.name,
      event.agent.agentId,
      modelId,
      event.agent.tools,
      undefined, // customTraceAttributes
      undefined, // toolsConfig
      event.agent.systemPrompt, // systemPrompt
    )

    this._log(`Agent span started: ${this._getSpanInfo(this._agentSpan)}`)
  }

  /**
   * Handle AfterInvocationEvent - end agent span.
   */
  private _onAfterInvocation = (event: AfterInvocationEvent): void => {
    this._log(`Ending agent span for ${event.agent.name}`)

    if (!this._agentSpan) {
      logger.warn('telemetry=<hook> | no agent span to end')
      return
    }

    // Use accumulated usage from event if provided, otherwise use our tracked usage
    const usage = event.accumulatedUsage ?? this._accumulatedUsage

    this._tracer.endAgentSpan(
      this._agentSpan,
      event.result?.message,
      event.error,
      usage,
      event.result?.stopReason,
    )

    this._log(`Agent span ended: ${this._getSpanInfo(this._agentSpan)}`)
    this._agentSpan = null
  }

  /**
   * Handle BeforeModelCallEvent - start cycle span (if needed) and model span.
   * 
   * Cycle spans are inferred: a new cycle starts with each model call.
   * When enableCycleSpans is false, model spans are direct children of the agent span.
   */
  private _onBeforeModelCall = (event: BeforeModelCallEvent): void => {
    // Start a new cycle span if cycle spans are enabled and we don't have one
    // (first model call, or after tools completed which ends the previous cycle)
    if (this._enableCycleSpans && !this._cycleSpan) {
      this._cycleCount++
      const cycleId = `cycle-${this._cycleCount}`
      this._log(`Starting cycle span: ${cycleId}`)
      
      this._cycleSpan = this._tracer.startEventLoopCycleSpan(
        cycleId,
        event.agent.messages,
        this._agentSpan,
      )
      
      this._log(`Cycle span started: ${this._getSpanInfo(this._cycleSpan)}`)
    }

    this._log(`Starting model span`)

    // Get model ID from agent
    const modelConfig = event.agent.model.getConfig()
    const modelId = modelConfig.modelId || event.agent.model.constructor.name

    // Start model span as child of cycle span (if enabled) or agent span
    const parentSpan = this._enableCycleSpans ? (this._cycleSpan ?? this._agentSpan) : this._agentSpan
    this._modelSpan = this._tracer.startModelInvokeSpan(
      event.agent.messages,
      parentSpan,
      modelId,
    )

    this._log(`Model span started: ${this._getSpanInfo(this._modelSpan)}`)
  }

  /**
   * Handle AfterModelCallEvent - end model span and accumulate usage.
   * If stopReason is not 'toolUse', also end the cycle span (final response).
   */
  private _onAfterModelCall = (event: AfterModelCallEvent): void => {
    this._log(`Ending model span`)

    if (!this._modelSpan) {
      logger.warn('telemetry=<hook> | no model span to end')
      return
    }

    // Accumulate usage if provided
    if (event.usage) {
      this._accumulatedUsage.inputTokens += event.usage.inputTokens
      this._accumulatedUsage.outputTokens += event.usage.outputTokens
      this._accumulatedUsage.totalTokens += event.usage.totalTokens
      this._accumulatedUsage.cacheReadInputTokens += event.usage.cacheReadInputTokens ?? 0
      this._accumulatedUsage.cacheWriteInputTokens += event.usage.cacheWriteInputTokens ?? 0

      this._log(`Accumulated usage: input=${this._accumulatedUsage.inputTokens}, output=${this._accumulatedUsage.outputTokens}`)
    }

    // End model span
    this._tracer.endModelInvokeSpan(
      this._modelSpan,
      event.stopData?.message,
      event.usage,
      event.metrics,
      event.stopData?.stopReason,
      event.error,
      event.agent.messages,
      event.stopData?.message,
      event.stopData?.stopReason,
    )

    this._log(`Model span ended: ${this._getSpanInfo(this._modelSpan)}`)
    this._modelSpan = null

    // If cycle spans are enabled and stopReason is not 'toolUse', this is the final response - end cycle span
    if (this._enableCycleSpans && event.stopData?.stopReason !== 'toolUse' && this._cycleSpan) {
      this._log(`Ending cycle span (final response): cycle-${this._cycleCount}`)
      this._tracer.endEventLoopCycleSpan(this._cycleSpan, event.stopData?.message)
      this._cycleSpan = null
    }
  }

  /**
   * Handle BeforeToolCallEvent - start tool span and set active context.
   */
  private _onBeforeToolCall = (event: BeforeToolCallEvent): void => {
    this._log(`Starting tool span for ${event.toolUse.name}`)

    // Use cycle span as parent if enabled (tools are part of the current cycle)
    // Otherwise use agent span directly (flat hierarchy)
    const parentSpan = this._enableCycleSpans ? (this._cycleSpan ?? this._agentSpan) : this._agentSpan

    // Start tool span
    const toolSpan = this._tracer.startToolCallSpan(
      event.toolUse,
      parentSpan,
    )

    if (toolSpan) {
      this._toolSpans.set(event.toolUse.toolUseId, toolSpan)

      // Set the span as active for context propagation
      // This enables MCP tools to inherit the trace context
      event.setActiveSpan(toolSpan)

      this._log(`Tool span started: ${this._getSpanInfo(toolSpan)}`)
    }
  }

  /**
   * Handle AfterToolCallEvent - end tool span.
   */
  private _onAfterToolCall = (event: AfterToolCallEvent): void => {
    this._log(`Ending tool span for ${event.toolUse.name}`)

    const toolSpan = this._toolSpans.get(event.toolUse.toolUseId)
    if (!toolSpan) {
      logger.warn(`telemetry=<hook>, tool=<${event.toolUse.name}> | no tool span to end`)
      return
    }

    // End tool span
    this._tracer.endToolCallSpan(
      toolSpan,
      {
        toolUseId: event.result.toolUseId,
        status: event.result.status,
        content: event.result.content,
      },
      event.error,
    )

    this._toolSpans.delete(event.toolUse.toolUseId)
    this._log(`Tool span ended for ${event.toolUse.name}`)
  }

  /**
   * Handle AfterToolsEvent - end cycle span after all tools complete.
   * The next model call will start a new cycle.
   */
  private _onAfterTools = (event: AfterToolsEvent): void => {
    if (this._cycleSpan) {
      this._log(`Ending cycle span (tools completed): cycle-${this._cycleCount}`)
      // Pass the tool result message to the cycle span
      this._tracer.endEventLoopCycleSpan(this._cycleSpan, undefined, event.message)
      this._cycleSpan = null
    }
  }

  /**
   * Log a debug message if debug mode is enabled.
   */
  private _log(message: string): void {
    if (this._debug) {
      console.log(`[TelemetryHook] ${message}`)
    }
  }

  /**
   * Get span info for logging.
   */
  private _getSpanInfo(span: TracerSpan): string {
    if (!span) return 'null'
    try {
      const ctx = span.spanContext()
      return `traceId=${ctx.traceId}, spanId=${ctx.spanId}`
    } catch {
      return 'unknown'
    }
  }

  /**
   * Get the current agent span (for testing/debugging).
   * @internal
   */
  get agentSpan(): TracerSpan {
    return this._agentSpan
  }

  /**
   * Get the current cycle span (for testing/debugging).
   * @internal
   */
  get cycleSpan(): TracerSpan {
    return this._cycleSpan
  }

  /**
   * Get the current model span (for testing/debugging).
   * @internal
   */
  get modelSpan(): TracerSpan {
    return this._modelSpan
  }

  /**
   * Get the accumulated usage (for testing/debugging).
   * @internal
   */
  get accumulatedUsage(): AccumulatedUsage {
    return { ...this._accumulatedUsage }
  }

  /**
   * Check if cycle spans are enabled (for testing/debugging).
   * @internal
   */
  get enableCycleSpans(): boolean {
    return this._enableCycleSpans
  }
}
