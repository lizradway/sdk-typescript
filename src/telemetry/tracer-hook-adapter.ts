/**
 * Adapter that wires an ITracer implementation to the hooks system.
 *
 * This module provides a HookProvider that delegates to an ITracer implementation,
 * allowing users to provide custom tracing backends without understanding hooks.
 *
 * The default Tracer uses startActiveSpan for automatic context propagation -
 * child spans automatically parent to the current active span.
 *
 * @example
 * ```typescript
 * import { ITracer, TracerHookAdapter, Agent } from '@strands-agents/sdk'
 *
 * class MyTracer implements ITracer {
 *   startSpan(event) {
 *     switch (event.type) {
 *       case 'beforeInvocationEvent':
 *         return myBackend.startSpan('agent', { name: event.agent.name })
 *       case 'beforeModelCallEvent':
 *         return myBackend.startSpan('model')
 *       case 'beforeToolCallEvent':
 *         return myBackend.startSpan('tool', { name: event.toolUse.name })
 *     }
 *   }
 *   endSpan(span, event) {
 *     if ('error' in event && event.error) myBackend.setError(span, event.error)
 *     myBackend.endSpan(span)
 *   }
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
} from '../hooks/events.js'
import type { ITracer, TracerSpanHandle } from './tracer-interface.js'
import type { Tracer, ActiveSpanHandle } from './tracer.js'
import type { Span } from '@opentelemetry/api'
import type { Usage } from './types.js'
import { createEmptyUsage, accumulateUsage } from './utils.js'
import { logger } from '../logging/index.js'


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
 * Adapter that wires an ITracer implementation to the agent's hook system.
 *
 * This allows users to implement a simple ITracer interface for custom
 * tracing backends without needing to understand the hooks system.
 *
 * The default Tracer uses startActiveSpan for automatic context propagation.
 * Child spans automatically parent to the current active span without
 * manual tracking.
 *
 * Cycle spans are handled internally by this adapter when using the default
 * Tracer implementation. Custom ITracer implementations do not need to
 * implement cycle span methods.
 */
export class TracerHookAdapter implements HookProvider {
  private readonly _tracer: ITracer
  private readonly _enableCycleSpans: boolean

  // Span state - stored for ending spans later
  protected _agentSpan: TracerSpanHandle | undefined
  protected _cycleSpan: ActiveSpanHandle | undefined
  protected _cycleCount: number = 0
  protected _modelSpan: TracerSpanHandle | undefined
  protected readonly _toolSpans: Map<string, TracerSpanHandle> = new Map()
  private _accumulatedUsage: Usage = createEmptyUsage()

  constructor(tracer: ITracer, config?: TracerHookAdapterConfig) {
    this._tracer = tracer
    this._enableCycleSpans = config?.enableCycleSpans ?? true

    // Warn if startSpan is implemented but endSpan is not - this will corrupt trace structure
    if (this._tracer.startSpan && !this._tracer.endSpan) {
      logger.warn(
        'tracer_config=<incomplete> | startSpan is implemented but endSpan is not | ' +
          'this will corrupt trace structure - spans will not be closed properly'
      )
      console.warn(
        '[Telemetry] Warning: Your ITracer implements startSpan but not endSpan. ' +
          'This will corrupt the trace structure. You MUST implement endSpan to close spans properly.'
      )
    }
  }

  registerCallbacks(registry: HookRegistry): void {
    registry.addCallback(BeforeInvocationEvent, this._onBeforeInvocation)
    registry.addCallback(AfterInvocationEvent, this._onAfterInvocation)
    registry.addCallback(BeforeModelCallEvent, this._onBeforeModelCall)
    registry.addCallback(AfterModelCallEvent, this._onAfterModelCall)
    registry.addCallback(BeforeToolCallEvent, this._onBeforeToolCall)
    registry.addCallback(AfterToolCallEvent, this._onAfterToolCall)

    if (this._enableCycleSpans) {
      registry.addCallback(AfterToolsEvent, this._onAfterTools)
    }
  }


  private _onBeforeInvocation = (event: BeforeInvocationEvent): void => {
    this._accumulatedUsage = createEmptyUsage()
    this._toolSpans.clear()
    this._modelSpan = undefined
    this._cycleSpan = undefined
    this._cycleCount = 0

    if (!this._tracer.startSpan) return

    // Start agent span - becomes the current span in context
    this._agentSpan = this._tracer.startSpan(event)
  }

  private _onAfterInvocation = (event: AfterInvocationEvent): void => {
    if (!this._agentSpan || !this._tracer.endSpan) return

    const usage = event.accumulatedUsage ?? this._accumulatedUsage

    this._tracer.endSpan(this._agentSpan, event, { accumulatedUsage: usage })
    this._agentSpan = undefined
  }

  private _onBeforeModelCall = (event: BeforeModelCallEvent): void => {
    // Start cycle span if needed - only works with the default Tracer implementation
    if (this._enableCycleSpans && !this._cycleSpan) {
      const tracerWithCycleSpan = this._tracer as Tracer
      if (typeof tracerWithCycleSpan.startCycleSpan === 'function') {
        this._cycleCount++
        this._cycleSpan = tracerWithCycleSpan.startCycleSpan(event, `cycle-${this._cycleCount}`)
      }
    }

    if (!this._tracer.startSpan) return

    // Start model span - auto-parents to cycle span (or agent span) via context
    this._modelSpan = this._tracer.startSpan(event)
  }

  private _onAfterModelCall = (event: AfterModelCallEvent): void => {
    if (event.usage) {
      accumulateUsage(this._accumulatedUsage, event.usage)
    }

    if (this._modelSpan && this._tracer.endSpan) {
      this._tracer.endSpan(this._modelSpan, event)
      this._modelSpan = undefined
    }

    // End cycle span if not continuing to tools
    if (this._enableCycleSpans && event.stopData?.stopReason !== 'toolUse' && this._cycleSpan) {
      const tracerWithCycleSpan = this._tracer as Tracer
      if (typeof tracerWithCycleSpan.endCycleSpan === 'function') {
        tracerWithCycleSpan.endCycleSpan(this._cycleSpan, event)
      }
      this._cycleSpan = undefined
    }
  }


  private _onBeforeToolCall = (event: BeforeToolCallEvent): void => {
    if (!this._tracer.startSpan) return

    // Start tool span - auto-parents to cycle span (or agent span) via context
    const toolSpan = this._tracer.startSpan(event)

    if (toolSpan !== undefined) {
      this._toolSpans.set(event.toolUse.toolUseId, toolSpan)

      // If the span handle contains an OTEL Span, set it as active for MCP context propagation
      if (toolSpan && typeof toolSpan === 'object' && 'span' in toolSpan) {
        const handle = toolSpan as { span: Span; context?: import('@opentelemetry/api').Context }
        if (handle.span && typeof handle.span === 'object' && 'spanContext' in handle.span) {
          // Pass both span and context for proper child span parenting
          event.setActiveSpan(handle.span, handle.context)
        }
      }
    }
  }

  private _onAfterToolCall = (event: AfterToolCallEvent): void => {
    const toolSpan = this._toolSpans.get(event.toolUse.toolUseId)
    if (!toolSpan || !this._tracer.endSpan) return

    this._tracer.endSpan(toolSpan, event)
    this._toolSpans.delete(event.toolUse.toolUseId)
  }

  private _onAfterTools = (event: AfterToolsEvent): void => {
    if (this._cycleSpan) {
      const tracerWithCycleSpan = this._tracer as Tracer
      if (typeof tracerWithCycleSpan.endCycleSpan === 'function') {
        tracerWithCycleSpan.endCycleSpan(this._cycleSpan, event)
      }
      this._cycleSpan = undefined
    }
  }

  /**
   * Get the accumulated usage (for testing/debugging).
   * @internal
   */
  get accumulatedUsage(): Usage {
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
