/**
 * Adapter that wires an ITracer implementation to the hooks system.
 *
 * This module provides a HookProvider that delegates to an ITracer implementation,
 * allowing users to provide custom tracing backends without understanding hooks.
 *
 * @example
 * ```typescript
 * import { ITracer, TracerHookAdapter, Agent } from '@strands-agents/sdk'
 *
 * class MyTracer implements ITracer {
 *   startAgentSpan(params) { return myBackend.startSpan('agent', params) }
 *   endAgentSpan(span, params) { myBackend.endSpan(span, params) }
 *   // ... other methods
 * }
 *
 * const agent = new Agent({
 *   hooks: [new TracerHookAdapter(new MyTracer())]
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
  type AccumulatedUsage,
} from '../hooks/events.js'
import type { ITracer, TracerSpanHandle } from './tracer-interface.js'
import type { Span } from '@opentelemetry/api'

/**
 * Configuration options for TracerHookAdapter.
 */
export interface TracerHookAdapterConfig {
  /**
   * Whether to create cycle spans for each event loop iteration.
   * When true (default), creates a span hierarchy: Agent \> Cycle \> Model/Tool
   * When false, creates a flat hierarchy: Agent \> Model/Tool
   */
  enableCycleSpans?: boolean
}

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
 * Adapter that wires an ITracer implementation to the agent's hook system.
 *
 * This allows users to implement a simple ITracer interface for custom
 * tracing backends without needing to understand the hooks system.
 *
 * @example
 * ```typescript
 * // Implement ITracer with your custom backend
 * class DatadogTracer implements ITracer {
 *   startAgentSpan(params) {
 *     return dd.startSpan('strands.agent.invoke', {
 *       tags: {
 *         'agent.name': params.agentName,
 *         'model.id': params.modelId,
 *       }
 *     })
 *   }
 *
 *   endAgentSpan(span, params) {
 *     if (params.error) {
 *       span.setTag('error', true)
 *       span.setTag('error.message', params.error.message)
 *     }
 *     if (params.usage) {
 *       span.setTag('tokens.total', params.usage.totalTokens)
 *     }
 *     span.finish()
 *   }
 *
 *   // Implement other methods as needed...
 * }
 *
 * // Use with agent
 * const agent = new Agent({
 *   model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
 *   hooks: [new TracerHookAdapter(new DatadogTracer())]
 * })
 * ```
 */
export class TracerHookAdapter implements HookProvider {
  private readonly _tracer: ITracer
  private readonly _enableCycleSpans: boolean

  // Span state
  private _agentSpan: TracerSpanHandle | undefined
  private _cycleSpan: TracerSpanHandle | undefined
  private _cycleCount: number = 0
  private _modelSpan: TracerSpanHandle | undefined
  private readonly _toolSpans: Map<string, TracerSpanHandle> = new Map()
  private _accumulatedUsage: AccumulatedUsage = createEmptyUsage()

  /**
   * Creates a new TracerHookAdapter.
   *
   * @param tracer - The ITracer implementation to delegate to
   * @param config - Optional configuration options
   */
  constructor(tracer: ITracer, config?: TracerHookAdapterConfig) {
    this._tracer = tracer
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
    if (this._enableCycleSpans) {
      registry.addCallback(AfterToolsEvent, this._onAfterTools)
    }
  }

  /**
   * Handle BeforeInvocationEvent - start agent span.
   */
  private _onBeforeInvocation = (event: BeforeInvocationEvent): void => {
    // Reset state for new invocation
    this._accumulatedUsage = createEmptyUsage()
    this._toolSpans.clear()
    this._modelSpan = undefined
    this._cycleSpan = undefined
    this._cycleCount = 0

    if (!this._tracer.startAgentSpan) {
      return
    }

    // Get model ID from agent
    const modelConfig = event.agent.model.getConfig()
    const modelId = modelConfig.modelId || event.agent.model.constructor.name

    this._agentSpan = this._tracer.startAgentSpan({
      agentName: event.agent.name,
      agentId: event.agent.agentId,
      modelId,
      inputMessages: event.inputMessages,
      tools: event.agent.tools,
      systemPrompt: event.agent.systemPrompt,
    })
  }

  /**
   * Handle AfterInvocationEvent - end agent span.
   */
  private _onAfterInvocation = (event: AfterInvocationEvent): void => {
    if (!this._agentSpan || !this._tracer.endAgentSpan) {
      return
    }

    // Use accumulated usage from event if provided, otherwise use our tracked usage
    const usage = event.accumulatedUsage ?? this._accumulatedUsage

    this._tracer.endAgentSpan(this._agentSpan, {
      response: event.result?.message,
      stopReason: event.result?.stopReason,
      error: event.error,
      usage,
    })

    this._agentSpan = undefined
  }

  /**
   * Handle BeforeModelCallEvent - start cycle span (if needed) and model span.
   */
  private _onBeforeModelCall = (event: BeforeModelCallEvent): void => {
    // Start a new cycle span if cycle spans are enabled and we don't have one
    if (this._enableCycleSpans && !this._cycleSpan && this._tracer.startCycleSpan) {
      this._cycleCount++
      const cycleId = `cycle-${this._cycleCount}`

      this._cycleSpan = this._tracer.startCycleSpan({
        cycleId,
        messages: event.agent.messages,
        parentSpan: this._agentSpan,
      })
    }

    if (!this._tracer.startModelSpan) {
      return
    }

    // Get model ID from agent
    const modelConfig = event.agent.model.getConfig()
    const modelId = modelConfig.modelId || event.agent.model.constructor.name

    // Start model span as child of cycle span (if enabled) or agent span
    const parentSpan = this._enableCycleSpans ? (this._cycleSpan ?? this._agentSpan) : this._agentSpan

    this._modelSpan = this._tracer.startModelSpan({
      modelId,
      messages: event.agent.messages,
      parentSpan,
    })
  }

  /**
   * Handle AfterModelCallEvent - end model span and accumulate usage.
   */
  private _onAfterModelCall = (event: AfterModelCallEvent): void => {
    // Accumulate usage if provided
    if (event.usage) {
      this._accumulatedUsage.inputTokens += event.usage.inputTokens
      this._accumulatedUsage.outputTokens += event.usage.outputTokens
      this._accumulatedUsage.totalTokens += event.usage.totalTokens
      this._accumulatedUsage.cacheReadInputTokens += event.usage.cacheReadInputTokens ?? 0
      this._accumulatedUsage.cacheWriteInputTokens += event.usage.cacheWriteInputTokens ?? 0
    }

    // End model span
    if (this._modelSpan && this._tracer.endModelSpan) {
      this._tracer.endModelSpan(this._modelSpan, {
        response: event.stopData?.message,
        stopReason: event.stopData?.stopReason,
        error: event.error,
        usage: event.usage,
        metrics: event.metrics,
      })
      this._modelSpan = undefined
    }

    // If cycle spans are enabled and stopReason is not 'toolUse', end cycle span
    if (this._enableCycleSpans && event.stopData?.stopReason !== 'toolUse' && this._cycleSpan) {
      if (this._tracer.endCycleSpan) {
        this._tracer.endCycleSpan(this._cycleSpan, {
          response: event.stopData?.message,
        })
      }
      this._cycleSpan = undefined
    }
  }

  /**
   * Handle BeforeToolCallEvent - start tool span.
   */
  private _onBeforeToolCall = (event: BeforeToolCallEvent): void => {
    if (!this._tracer.startToolSpan) {
      return
    }

    // Use cycle span as parent if enabled, otherwise use agent span
    const parentSpan = this._enableCycleSpans ? (this._cycleSpan ?? this._agentSpan) : this._agentSpan

    const toolSpan = this._tracer.startToolSpan({
      toolName: event.toolUse.name,
      toolUseId: event.toolUse.toolUseId,
      input: event.toolUse.input,
      parentSpan,
    })

    if (toolSpan !== undefined) {
      this._toolSpans.set(event.toolUse.toolUseId, toolSpan)

      // If the span is an OTEL Span, set it as active for context propagation
      if (toolSpan && typeof toolSpan === 'object' && 'spanContext' in toolSpan) {
        event.setActiveSpan(toolSpan as Span)
      }
    }
  }

  /**
   * Handle AfterToolCallEvent - end tool span.
   */
  private _onAfterToolCall = (event: AfterToolCallEvent): void => {
    const toolSpan = this._toolSpans.get(event.toolUse.toolUseId)
    if (!toolSpan || !this._tracer.endToolSpan) {
      return
    }

    this._tracer.endToolSpan(toolSpan, {
      result: event.result,
      error: event.error,
    })

    this._toolSpans.delete(event.toolUse.toolUseId)
  }

  /**
   * Handle AfterToolsEvent - end cycle span after all tools complete.
   */
  private _onAfterTools = (event: AfterToolsEvent): void => {
    if (this._cycleSpan && this._tracer.endCycleSpan) {
      this._tracer.endCycleSpan(this._cycleSpan, {
        toolResultMessage: event.message,
      })
      this._cycleSpan = undefined
    }
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
