/**
 * Tracer interface for custom telemetry implementations.
 *
 * This module provides an interface that users can implement to provide
 * custom tracing backends (Datadog, New Relic, custom solutions, etc.)
 * without needing to understand the hooks system.
 *
 * The default Tracer implementation uses OpenTelemetry's startActiveSpan
 * for automatic context propagation - child spans automatically parent
 * to the current active span without manual tracking.
 *
 * @example
 * ```typescript
 * import { ITracer, TracerHookAdapter, Agent } from '@strands-agents/sdk'
 *
 * class DatadogTracer implements ITracer {
 *   startSpan(event) {
 *     switch (event.type) {
 *       case 'beforeInvocationEvent':
 *         return dd.startSpan('agent.invoke', { tags: { agent: event.agent.name } })
 *       case 'beforeModelCallEvent':
 *         return dd.startSpan('model.call')
 *       case 'beforeToolCallEvent':
 *         return dd.startSpan('tool.call', { tags: { tool: event.toolUse.name } })
 *     }
 *   }
 *   endSpan(span, event) {
 *     if ('error' in event && event.error) span.setError(event.error)
 *     span.finish()
 *   }
 * }
 *
 * const agent = new Agent({
 *   hooks: [new TracerHookAdapter(new DatadogTracer())]
 * })
 * ```
 */

import type {
  BeforeInvocationEvent,
  AfterInvocationEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
} from '../hooks/events.js'


/**
 * Generic span type that tracers return.
 * Can be any object that the tracer implementation uses to track spans.
 * For OpenTelemetry tracers using startActiveSpan, this includes both
 * the span and its context for proper context propagation.
 */
export type TracerSpanHandle = unknown

/**
 * Union type for events that start a span.
 */
export type StartSpanEvent = BeforeInvocationEvent | BeforeModelCallEvent | BeforeToolCallEvent

/**
 * Union type for events that end a span.
 */
export type EndSpanEvent = AfterInvocationEvent | AfterModelCallEvent | AfterToolCallEvent

/**
 * Context passed to startSpan for additional information not in the event.
 */
export interface StartSpanContext {
  /** Custom trace attributes (for agent spans) */
  customTraceAttributes?: Record<string, unknown>
  /** Cycle ID when this is a cycle span (internal use) */
  cycleId?: string
}

/**
 * Context passed to endSpan for additional information not in the event.
 */
export interface EndSpanContext {
  /** Accumulated usage across all model calls (for agent spans) */
  accumulatedUsage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cacheReadInputTokens?: number
    cacheWriteInputTokens?: number
  }
}


/**
 * Interface for custom tracer implementations.
 *
 * Implement this interface to provide custom tracing backends.
 * The TracerHookAdapter will wire your implementation to the agent's
 * hook system automatically.
 *
 * The default implementation uses OpenTelemetry's startActiveSpan for
 * automatic context propagation. Child spans automatically parent to
 * the current active span without manual tracking.
 *
 * IMPORTANT: If you implement startSpan, you MUST also implement endSpan.
 * Failing to close spans will corrupt the trace structure and cause
 * incorrect parent-child relationships. For OpenTelemetry implementations,
 * consider using startActiveSpan which automatically manages span lifecycle.
 */
export interface ITracer {
  /**
   * Start a span based on a hook event.
   * Uses event.type to determine span name and attributes.
   *
   * For OpenTelemetry implementations, this should use startActiveSpan
   * to set the span as the current span in context. Child spans will
   * automatically parent to it.
   *
   * IMPORTANT: If you implement this method, you MUST also implement endSpan
   * to properly close spans and maintain correct trace structure.
   *
   * @param event - The hook event that triggered span creation
   * @param context - Additional context not available in the event
   * @returns A span handle to pass to endSpan, or undefined to skip tracing
   */
  startSpan?(event: StartSpanEvent, context?: StartSpanContext): TracerSpanHandle | undefined

  /**
   * End a span based on a hook event.
   * Uses event.type to add final attributes and close the span.
   *
   * IMPORTANT: This method MUST be implemented if startSpan is implemented.
   * Failing to close spans will corrupt the trace structure.
   *
   * @param span - The span handle returned by startSpan
   * @param event - The hook event that triggered span completion
   * @param context - Additional context not available in the event
   */
  endSpan?(span: TracerSpanHandle, event: EndSpanEvent, context?: EndSpanContext): void
}
