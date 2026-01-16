import type { AgentData } from '../types/agent.js'
import type { ContentBlock, Message, ToolResultBlock } from '../types/messages.js'
import type { Tool, TracingContext } from '../tools/tool.js'
import type { JSONValue } from '../types/json.js'
import type { ModelStreamEvent } from '../models/streaming.js'
import type { Span } from '@opentelemetry/api'
import type { Usage, Metrics } from '../telemetry/types.js'

/**
 * Base class for all hook events.
 * Hook events are emitted at specific points in the agent lifecycle.
 */
export abstract class HookEvent {
  /**
   * @internal
   * Check if callbacks should be reversed for this event.
   * Used by HookRegistry for callback ordering.
   */
  _shouldReverseCallbacks(): boolean {
    return false
  }
}

/**
 * Event triggered at the beginning of a new agent request.
 * Fired before any model inference or tool execution occurs.
 */
export class BeforeInvocationEvent extends HookEvent {
  readonly type = 'beforeInvocationEvent' as const
  readonly agent: AgentData
  /**
   * The normalized input messages for this invocation.
   * Useful for telemetry to capture the input.
   */
  readonly inputMessages: Message[]

  constructor(data: { agent: AgentData; inputMessages?: Message[] }) {
    super()
    this.agent = data.agent
    this.inputMessages = data.inputMessages ?? []
  }
}

/**
 * Event triggered at the end of an agent request.
 * Fired after all processing completes, regardless of success or error.
 * Uses reverse callback ordering for proper cleanup semantics.
 */
export class AfterInvocationEvent extends HookEvent {
  readonly type = 'afterInvocationEvent' as const
  readonly agent: AgentData
  /**
   * The result of the invocation, if successful.
   */
  readonly result?: { message: Message; stopReason: string }
  /**
   * Accumulated token usage across all model calls in this invocation.
   */
  readonly accumulatedUsage?: Usage
  /**
   * Error that occurred during invocation, if any.
   */
  readonly error?: Error

  constructor(data: {
    agent: AgentData
    result?: { message: Message; stopReason: string }
    accumulatedUsage?: Usage
    error?: Error
  }) {
    super()
    this.agent = data.agent
    if (data.result !== undefined) {
      this.result = data.result
    }
    if (data.accumulatedUsage !== undefined) {
      this.accumulatedUsage = data.accumulatedUsage
    }
    if (data.error !== undefined) {
      this.error = data.error
    }
  }

  override _shouldReverseCallbacks(): boolean {
    return true
  }
}

/**
 * Event triggered when the framework adds a message to the conversation history.
 * Fired during the agent loop execution for framework-generated messages.
 * Does not fire for initial messages from AgentConfig or user input messages.
 */
export class MessageAddedEvent extends HookEvent {
  readonly type = 'messageAddedEvent' as const
  readonly agent: AgentData
  readonly message: Message

  constructor(data: { agent: AgentData; message: Message }) {
    super()
    this.agent = data.agent
    this.message = data.message
  }
}

/**
 * Event triggered just before a tool is executed.
 * Fired after tool lookup but before execution begins.
 */
export class BeforeToolCallEvent extends HookEvent {
  readonly type = 'beforeToolCallEvent' as const
  readonly agent: AgentData
  readonly toolUse: {
    name: string
    toolUseId: string
    input: JSONValue
  }
  readonly tool: Tool | undefined
  /**
   * Parent span for telemetry hierarchy.
   * Hook providers can use this to create child spans.
   */
  readonly parentSpan?: Span

  /**
   * Span set by telemetry hook provider for context propagation.
   * The agent will use this span as the active context during tool execution.
   * @internal
   */
  _activeSpan?: Span

  /**
   * Tracing context set by telemetry hook provider.
   * The agent will pass this to tools via ToolContext.tracing.
   * @internal
   */
  _tracingContext?: TracingContext

  constructor(data: {
    agent: AgentData
    toolUse: { name: string; toolUseId: string; input: JSONValue }
    tool: Tool | undefined
    parentSpan?: Span
  }) {
    super()
    this.agent = data.agent
    this.toolUse = data.toolUse
    this.tool = data.tool
    if (data.parentSpan !== undefined) {
      this.parentSpan = data.parentSpan
    }
  }

  /**
   * Set the span that should be active during tool execution.
   * Called by telemetry hooks to enable trace context propagation to MCP tools.
   * Also extracts and stores the tracing context for tools to use.
   */
  setActiveSpan(span: Span): void {
    this._activeSpan = span
    
    // Extract tracing context from the span for tools to use
    const spanContext = span.spanContext()
    const traceFlags = spanContext.traceFlags
    const traceparent = `00-${spanContext.traceId}-${spanContext.spanId}-${traceFlags.toString(16).padStart(2, '0')}`
    
    this._tracingContext = {
      traceparent,
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      traceFlags,
      // tracestate is not directly available from SpanContext, would need TraceState API
    }
  }
}

/**
 * Event triggered after a tool execution completes.
 * Fired after tool execution finishes, whether successful or failed.
 * Uses reverse callback ordering for proper cleanup semantics.
 */
export class AfterToolCallEvent extends HookEvent {
  readonly type = 'afterToolCallEvent' as const
  readonly agent: AgentData
  readonly toolUse: {
    name: string
    toolUseId: string
    input: JSONValue
  }
  readonly tool: Tool | undefined
  readonly result: ToolResultBlock
  readonly error?: Error

  constructor(data: {
    agent: AgentData
    toolUse: { name: string; toolUseId: string; input: JSONValue }
    tool: Tool | undefined
    result: ToolResultBlock
    error?: Error
  }) {
    super()
    this.agent = data.agent
    this.toolUse = data.toolUse
    this.tool = data.tool
    this.result = data.result
    if (data.error !== undefined) {
      this.error = data.error
    }
  }

  override _shouldReverseCallbacks(): boolean {
    return true
  }
}

/**
 * Event triggered just before the model is invoked.
 * Fired before sending messages to the model for inference.
 */
export class BeforeModelCallEvent extends HookEvent {
  readonly type = 'beforeModelCallEvent' as const
  readonly agent: AgentData

  constructor(data: { agent: AgentData }) {
    super()
    this.agent = data.agent
  }
}

/**
 * Response from a model invocation containing the message and stop reason.
 */
export interface ModelStopData {
  /**
   * The message returned by the model.
   */
  readonly message: Message
  /**
   * The reason the model stopped generating.
   */
  readonly stopReason: string
}

/**
 * Event triggered after the model invocation completes.
 * Fired after the model finishes generating a response, whether successful or failed.
 * Uses reverse callback ordering for proper cleanup semantics.
 *
 * Note: stopData may be undefined if an error occurs before the model completes.
 */
export class AfterModelCallEvent extends HookEvent {
  readonly type = 'afterModelCallEvent' as const
  readonly agent: AgentData
  readonly stopData?: ModelStopData
  readonly error?: Error
  /**
   * Token usage from this model call.
   */
  readonly usage?: Usage
  /**
   * Performance metrics from this model call.
   */
  readonly metrics?: Metrics

  /**
   * Optional flag that can be set by hook callbacks to request a retry of the model call.
   * Only valid when an error is present. When set to true, the agent will retry the model invocation.
   * Typically used after reducing context size in response to a ContextWindowOverflowError.
   */
  retryModelCall?: boolean

  constructor(data: {
    agent: AgentData
    stopData?: ModelStopData
    error?: Error
    usage?: Usage
    metrics?: Metrics
  }) {
    super()
    this.agent = data.agent
    if (data.stopData !== undefined) {
      this.stopData = data.stopData
    }
    if (data.error !== undefined) {
      this.error = data.error
    }
    if (data.usage !== undefined) {
      this.usage = data.usage
    }
    if (data.metrics !== undefined) {
      this.metrics = data.metrics
    }
  }

  override _shouldReverseCallbacks(): boolean {
    return true
  }
}

/**
 * Event triggered for each streaming event from the model.
 * Allows hooks to observe individual streaming events during model inference.
 * Provides read-only access to streaming events.
 *
 * Currently private pending https://github.com/strands-agents/sdk-typescript/issues/288
 */
export class ModelStreamEventHook extends HookEvent {
  readonly type = 'modelStreamEventHook' as const
  readonly agent: AgentData
  readonly event: ModelStreamEvent | ContentBlock

  constructor(data: { agent: AgentData; event: ModelStreamEvent | ContentBlock }) {
    super()
    this.agent = data.agent
    this.event = data.event
  }
}

/**
 * Event triggered before executing tools.
 * Fired when the model returns tool use blocks that need to be executed.
 */
export class BeforeToolsEvent extends HookEvent {
  readonly type = 'beforeToolsEvent' as const
  readonly agent: AgentData
  readonly message: Message

  constructor(data: { agent: AgentData; message: Message }) {
    super()
    this.agent = data.agent
    this.message = data.message
  }
}

/**
 * Event triggered after all tools complete execution.
 * Fired after tool results are collected and ready to be added to conversation.
 * Uses reverse callback ordering for proper cleanup semantics.
 */
export class AfterToolsEvent extends HookEvent {
  readonly type = 'afterToolsEvent' as const
  readonly agent: AgentData
  readonly message: Message

  constructor(data: { agent: AgentData; message: Message }) {
    super()
    this.agent = data.agent
    this.message = data.message
  }

  override _shouldReverseCallbacks(): boolean {
    return true
  }
}
