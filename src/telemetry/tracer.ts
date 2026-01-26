/**
 * OpenTelemetry integration.
 *
 * This module provides tracing capabilities using OpenTelemetry,
 * enabling trace data to be sent to OTLP endpoints.
 *
 * Uses OpenTelemetry's startActiveSpan for automatic context propagation.
 * Child spans automatically parent to the current active span.
 */

import { context, SpanStatusCode, SpanKind, trace } from '@opentelemetry/api'
import type { Span, Tracer as OtelTracer, SpanOptions, AttributeValue } from '@opentelemetry/api'
import type { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { logger } from '../logging/index.js'
import { initializeTracerProvider, isTelemetryEnabled } from './config.js'
import type {
  TelemetryConfig,
  EndModelSpanOptions,
  StartAgentSpanOptions,
  StartModelInvokeSpanOptions,
  StartToolCallSpanOptions,
  StartEventLoopCycleSpanOptions,
  Usage,
  Metrics,
  ToolResult,
} from './types.js'
import type { Message } from '../types/messages.js'

// Re-export types for external use
export type {
  TelemetryConfig,
  EndModelSpanOptions,
  StartAgentSpanOptions,
  StartModelInvokeSpanOptions,
  StartToolCallSpanOptions,
  StartEventLoopCycleSpanOptions,
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum recursion depth for JSON encoding to prevent stack overflow. */
const MAX_JSON_ENCODE_DEPTH = 50

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

// Global context stack shared across all Tracer instances.
// This ensures proper parent-child relationships when spans are created
// from different Tracer instances across async generator boundaries.
// OpenTelemetry's async local storage doesn't persist across yields,
// so we maintain our own stack.
let _globalContextStack: import('@opentelemetry/api').Context[] = []


/**
 * Reset the global context stack (for testing only).
 * @internal
 */
export function _resetContextStack(): void {
  _globalContextStack = []
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get or create a global tracer instance.
 * Only creates a tracer if telemetry is enabled globally.
 *
 * @returns A Tracer instance, or throws if telemetry is not enabled
 */
export function getTracer(): Tracer {
  if (!isTelemetryEnabled()) {
    throw new Error('Telemetry is not enabled. Initialize StrandsTelemetry first.')
  }
  return new Tracer()
}

/**
 * Tracer manages OpenTelemetry spans for agent operations.
 *
 * Maintains a context stack to ensure proper parent-child relationships
 * between spans across async generator boundaries. OpenTelemetry's async
 * local storage doesn't persist across yields, so we maintain our own stack.
 */
export class Tracer {
  private readonly _tracer: OtelTracer
  private readonly _tracerProvider: NodeTracerProvider
  private readonly _useLatestConventions: boolean
  private readonly _includeToolDefinitions: boolean
  private readonly _customTraceAttributes: Record<string, AttributeValue>

  /**
   * Initialize the tracer with OpenTelemetry configuration.
   * Reads OTEL_SEMCONV_STABILITY_OPT_IN to determine convention version.
   * Initializes the global tracer provider if not already done.
   */
  constructor(config?: TelemetryConfig) {
    this._customTraceAttributes = config?.customTraceAttributes ?? {}

    // Read semantic convention version from environment
    const optInValues = this._parseSemconvOptIn()
    this._useLatestConventions = optInValues.has('gen_ai_latest_experimental')
    this._includeToolDefinitions = optInValues.has('gen_ai_tool_definitions')

    // Initialize tracer provider and get tracer from it
    this._tracerProvider = initializeTracerProvider()
    this._tracer = this._tracerProvider.getTracer('strands-agents')
  }


  // ---------------------------------------------------------------------------
  // Public methods - Agent spans
  // ---------------------------------------------------------------------------

  /**
   * Start an agent invocation span as the active span.
   * Child spans will automatically parent to this span.
   */
  startAgentSpan(options: StartAgentSpanOptions): Span {
    const {
      messages,
      agentName,
      agentId,
      modelId,
      tools,
      customTraceAttributes,
      toolsConfig,
      systemPrompt,
    } = options

    try {
      const spanName = `invoke_agent ${agentName}`
      const attributes = this._getCommonAttributes('invoke_agent')
      attributes['gen_ai.agent.name'] = agentName
      attributes['name'] = spanName

      if (agentId) {
        attributes['gen_ai.agent.id'] = agentId
      }

      if (modelId) {
        attributes['gen_ai.request.model'] = modelId
      }

      if (tools && tools.length > 0) {
        const toolNames = tools.map((t) => {
          if (typeof t === 'object' && t !== null) {
            const tool = t as Record<string, unknown>
            if (typeof tool.name === 'string') return tool.name
            if (tool._functionTool && typeof (tool._functionTool as Record<string, unknown>).name === 'string') {
              return (tool._functionTool as Record<string, unknown>).name
            }
          }
          return 'unknown'
        })
        attributes['gen_ai.agent.tools'] = serialize(toolNames)
      }

      if (this._includeToolDefinitions && toolsConfig) {
        try {
          attributes['gen_ai.tool.definitions'] = serialize(toolsConfig)
        } catch {
          // Skip tool definitions on serialization error
        }
      }

      if (systemPrompt !== undefined) {
        try {
          attributes['system_prompt'] = serialize(systemPrompt)
        } catch {
          // Skip system prompt on serialization error
        }
      }

      const mergedAttributes = this._mergeAttributes(attributes, customTraceAttributes)
      const span = this._createActiveSpan(spanName, mergedAttributes, SpanKind.INTERNAL)

      this._addEventMessages(span, messages)

      return span
    } catch (error) {
      logger.warn(`error=<${error}> | failed to start agent span`)
      throw error
    }
  }

  /**
   * End an agent invocation span.
   */
  endAgentSpan(
    span: Span | null,
    response?: unknown,
    error?: Error,
    accumulatedUsage?: Usage,
    stopReason?: string,
  ): void {
    if (!span) return

    try {
      const attributes: Record<string, AttributeValue> = {}

      if (accumulatedUsage) {
        attributes['gen_ai.usage.prompt_tokens'] = accumulatedUsage.inputTokens
        attributes['gen_ai.usage.input_tokens'] = accumulatedUsage.inputTokens
        attributes['gen_ai.usage.completion_tokens'] = accumulatedUsage.outputTokens
        attributes['gen_ai.usage.output_tokens'] = accumulatedUsage.outputTokens
        attributes['gen_ai.usage.total_tokens'] = accumulatedUsage.totalTokens

        if ((accumulatedUsage.cacheReadInputTokens ?? 0) > 0) {
          attributes['gen_ai.usage.cache_read_input_tokens'] = accumulatedUsage.cacheReadInputTokens!
        }
        if ((accumulatedUsage.cacheWriteInputTokens ?? 0) > 0) {
          attributes['gen_ai.usage.cache_write_input_tokens'] = accumulatedUsage.cacheWriteInputTokens!
        }
      }

      if (response !== undefined && response !== null) {
        this._addResponseEvent(span, response, stopReason)
      }

      this._closeSpan(span, attributes, error)
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end agent span`)
    }
  }


  // ---------------------------------------------------------------------------
  // Public methods - Model spans
  // ---------------------------------------------------------------------------

  /**
   * Start a model invocation span as the active span.
   */
  startModelInvokeSpan(options: StartModelInvokeSpanOptions): Span {
    const { messages, modelId, customTraceAttributes } = options

    try {
      const attributes = this._getCommonAttributes('chat')

      if (modelId) {
        attributes['gen_ai.request.model'] = modelId
      }

      const mergedAttributes = this._mergeAttributes(attributes, customTraceAttributes)
      const span = this._createActiveSpan('chat', mergedAttributes, SpanKind.INTERNAL)

      this._addEventMessages(span, messages)

      return span
    } catch (error) {
      logger.warn(`error=<${error}> | failed to start model invoke span`)
      throw error
    }
  }

  /**
   * End a model invocation span.
   */
  endModelInvokeSpan(span: Span | null, options: EndModelSpanOptions = {}): void {
    if (!span) return

    const { usage, metrics, error, output, stopReason } = options

    try {
      if (output !== undefined && output && typeof output === 'object' && 'content' in output && 'role' in output) {
        this._addOutputEvent(span, output as Record<string, unknown>, stopReason)
      }

      const attributes: Record<string, AttributeValue> = {}

      if (usage) {
        attributes['gen_ai.usage.prompt_tokens'] = usage.inputTokens
        attributes['gen_ai.usage.input_tokens'] = usage.inputTokens
        attributes['gen_ai.usage.completion_tokens'] = usage.outputTokens
        attributes['gen_ai.usage.output_tokens'] = usage.outputTokens
        attributes['gen_ai.usage.total_tokens'] = usage.totalTokens

        if (metrics) {
          this._addOptionalUsageAndMetricsAttributes(attributes, usage, metrics)
        }
      }

      this._closeSpan(span, attributes, error)
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end model invoke span`)
    }
  }


  // ---------------------------------------------------------------------------
  // Public methods - Tool spans
  // ---------------------------------------------------------------------------

  /**
   * Start a tool call span as the active span.
   */
  startToolCallSpan(options: StartToolCallSpanOptions): Span {
    const { tool, customTraceAttributes } = options

    try {
      const attributes = this._getCommonAttributes('execute_tool')
      attributes['gen_ai.tool.name'] = tool.name
      attributes['gen_ai.tool.call.id'] = tool.toolUseId

      const mergedAttributes = this._mergeAttributes(attributes, customTraceAttributes)
      const span = this._createActiveSpan(`execute_tool ${tool.name}`, mergedAttributes, SpanKind.INTERNAL)

      if (this._useLatestConventions) {
        this._addEvent(span, 'gen_ai.client.inference.operation.details', {
          'gen_ai.input.messages': serialize([
            {
              role: 'tool',
              parts: [{ type: 'tool_call', name: tool.name, id: tool.toolUseId, arguments: tool.input }],
            },
          ]),
        })
      } else {
        this._addEvent(span, 'gen_ai.tool.message', {
          role: 'tool',
          content: serialize(tool.input),
          id: tool.toolUseId,
        })
      }

      return span
    } catch (error) {
      logger.warn(`error=<${error}> | failed to start tool call span`)
      throw error
    }
  }

  /**
   * End a tool call span.
   */
  endToolCallSpan(span: Span | null, toolResult?: ToolResult, error?: Error): void {
    if (!span) return

    try {
      const attributes: Record<string, AttributeValue> = {}

      if (toolResult) {
        const statusStr = typeof toolResult.status === 'string' ? toolResult.status : String(toolResult.status)
        attributes['gen_ai.tool.status'] = statusStr

        if (this._useLatestConventions) {
          this._addEvent(span, 'gen_ai.client.inference.operation.details', {
            'gen_ai.output.messages': serialize([
              {
                role: 'tool',
                parts: [{ type: 'tool_call_response', id: toolResult.toolUseId, response: toolResult.content }],
              },
            ]),
          })
        } else {
          this._addEvent(span, 'gen_ai.choice', {
            message: serialize(toolResult.content),
            id: toolResult.toolUseId,
          })
        }
      }

      this._closeSpan(span, attributes, error)
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end tool call span`)
    }
  }


  // ---------------------------------------------------------------------------
  // Public methods - Event loop cycle spans
  // ---------------------------------------------------------------------------

  /**
   * Start an event loop cycle span as the active span.
   */
  startEventLoopCycleSpan(options: StartEventLoopCycleSpanOptions): Span {
    const { cycleId, messages, customTraceAttributes } = options

    try {
      const attributes: Record<string, AttributeValue> = { 'event_loop.cycle_id': cycleId }
      const mergedAttributes = this._mergeAttributes(attributes, customTraceAttributes)
      const span = this._createActiveSpan('execute_event_loop_cycle', mergedAttributes)

      this._addEventMessages(span, messages)

      return span
    } catch (error) {
      logger.warn(`error=<${error}> | failed to start event loop cycle span`)
      throw error
    }
  }

  /**
   * End an event loop cycle span.
   */
  endEventLoopCycleSpan(span: Span, error?: Error): void {
    try {
      this._closeSpan(span, {}, error)
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end event loop cycle span`)
    }
  }


  // ---------------------------------------------------------------------------
  // Private methods - Context management
  // ---------------------------------------------------------------------------

  /**
   * Get the current context for span creation.
   * Returns the top of our context stack, or falls back to the active OpenTelemetry context.
   */
  private _getCurrentContext(): import('@opentelemetry/api').Context {
    return _globalContextStack.at(-1) ?? context.active()
  }

  /**
   * Push a new context onto the stack.
   */
  private _pushContext(ctx: import('@opentelemetry/api').Context): void {
    _globalContextStack.push(ctx)
  }

  /**
   * Pop a context from the stack.
   */
  private _popContext(): void {
    _globalContextStack.pop()
  }

  /**
   * Parse the OTEL_SEMCONV_STABILITY_OPT_IN environment variable.
   */
  private _parseSemconvOptIn(): Set<string> {
    const optInEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN ?? ''
    return new Set(
      optInEnv
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    )
  }


  // ---------------------------------------------------------------------------
  // Private methods - Span lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Create a span and push its context onto the stack.
   * Child spans will automatically parent to this span.
   *
   * For async generators, call the corresponding endXxxSpan() method
   * to close the span and pop the context.
   */
  private _createActiveSpan(
    spanName: string,
    attributes?: Record<string, AttributeValue>,
    spanKind?: SpanKind,
  ): Span {
    const options: SpanOptions = {}

    if (attributes) {
      const otelAttributes: Record<string, AttributeValue | undefined> = {}
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined && value !== null) {
          otelAttributes[key] = value
        }
      }
      options.attributes = otelAttributes
    }

    if (spanKind !== undefined) {
      options.kind = spanKind
    }

    // Create span with current context from our stack
    const parentContext = this._getCurrentContext()
    const span = this._tracer.startSpan(spanName, options, parentContext)

    try {
      span.setAttribute('gen_ai.event.start_time', new Date().toISOString())
    } catch {
      // Ignore attribute setting errors
    }

    // Push the new span's context onto our stack
    const spanContext = trace.setSpan(parentContext, span)
    this._pushContext(spanContext)

    return span
  }

  /**
   * Close a span with the given attributes and optional error.
   * Pops the context from the stack.
   */
  private _closeSpan(span: Span, attributes?: Record<string, AttributeValue>, error?: Error): void {
    try {
      const endAttributes: Record<string, AttributeValue> = {
        'gen_ai.event.end_time': new Date().toISOString(),
      }

      if (attributes) {
        Object.assign(endAttributes, attributes)
      }

      this._setAttributes(span, endAttributes)

      if (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
        span.recordException(error)
      } else {
        span.setStatus({ code: SpanStatusCode.OK })
      }

      span.end()
    } finally {
      // Always pop context, even if an error occurred
      this._popContext()
    }
  }


  // ---------------------------------------------------------------------------
  // Private methods - Attributes and events
  // ---------------------------------------------------------------------------

  /**
   * Set attributes on a span.
   */
  private _setAttributes(span: Span, attributes: Record<string, AttributeValue>): void {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined && value !== null) {
        try {
          span.setAttribute(key, value)
        } catch {
          // Ignore individual attribute errors
        }
      }
    }
  }

  /**
   * Add an event to a span.
   */
  private _addEvent(span: Span, eventName: string, eventAttributes?: Record<string, AttributeValue>): void {
    try {
      if (eventAttributes) {
        const otelAttributes: Record<string, AttributeValue | undefined> = {}
        for (const [key, value] of Object.entries(eventAttributes)) {
          if (value !== undefined && value !== null) {
            otelAttributes[key] = value
          }
        }
        span.addEvent(eventName, otelAttributes)
      } else {
        span.addEvent(eventName)
      }
    } catch {
      // Ignore event adding errors
    }
  }

  /**
   * Get common attributes based on semantic convention version.
   */
  private _getCommonAttributes(operationName: string): Record<string, AttributeValue> {
    const attributes: Record<string, AttributeValue> = {
      'gen_ai.operation.name': operationName,
    }

    if (this._useLatestConventions) {
      attributes['gen_ai.provider.name'] = 'strands-agents'
    } else {
      attributes['gen_ai.system'] = 'strands-agents'
    }

    return attributes
  }

  /**
   * Merge custom attributes with standard attributes.
   */
  private _mergeAttributes(
    standardAttributes: Record<string, AttributeValue>,
    customAttributes?: Record<string, AttributeValue>,
  ): Record<string, AttributeValue> {
    const merged = { ...standardAttributes, ...this._customTraceAttributes }
    if (customAttributes) {
      Object.assign(merged, customAttributes)
    }
    return merged
  }


  /**
   * Add message events to a span.
   */
  private _addEventMessages(span: Span, messages: Message[]): void {
    try {
      if (!Array.isArray(messages)) return

      if (this._useLatestConventions) {
        const inputMessages: unknown[] = []
        for (const message of messages) {
          inputMessages.push({
            role: message.role,
            parts: mapContentBlocksToOtelParts(message.content),
          })
        }
        this._addEvent(span, 'gen_ai.client.inference.operation.details', {
          'gen_ai.input.messages': serialize(inputMessages),
        })
      } else {
        for (const message of messages) {
          const eventName = this._getEventNameForMessage(message)
          this._addEvent(span, eventName, { content: serialize(message.content) })
        }
      }
    } catch {
      // Ignore message event errors
    }
  }

  /**
   * Get the event name for a message based on its type.
   */
  private _getEventNameForMessage(message: Message): string {
    if (message.role === 'user' && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block && typeof block === 'object' && 'type' in block && block.type === 'toolResultBlock') {
          return 'gen_ai.tool.message'
        }
      }
    }

    if (message.role === 'user') return 'gen_ai.user.message'
    if (message.role === 'assistant') return 'gen_ai.assistant.message'
    return 'gen_ai.message'
  }

  /**
   * Add optional usage and metrics attributes.
   */
  private _addOptionalUsageAndMetricsAttributes(
    attributes: Record<string, AttributeValue>,
    usage: Usage,
    metrics: Metrics,
  ): void {
    if (usage.cacheReadInputTokens !== undefined) {
      attributes['gen_ai.usage.cache_read_input_tokens'] = usage.cacheReadInputTokens
    }
    if (usage.cacheWriteInputTokens !== undefined) {
      attributes['gen_ai.usage.cache_write_input_tokens'] = usage.cacheWriteInputTokens
    }
    if (metrics.timeToFirstByteMs !== undefined && metrics.timeToFirstByteMs > 0) {
      attributes['gen_ai.server.time_to_first_token'] = metrics.timeToFirstByteMs
    }
    if (metrics.latencyMs !== undefined && metrics.latencyMs > 0) {
      attributes['gen_ai.server.request.duration'] = metrics.latencyMs
    }
  }


  /**
   * Add response event to a span.
   */
  private _addResponseEvent(span: Span, response: unknown, stopReason?: string): void {
    try {
      let messageText = ''
      const finishReason = stopReason || 'end_turn'

      if (typeof response === 'object' && response !== null) {
        const respObj = response as Record<string, unknown>
        if ('content' in respObj && Array.isArray(respObj.content)) {
          const textParts: string[] = []
          for (const block of respObj.content) {
            if (block && typeof block === 'object' && 'type' in block) {
              if (block.type === 'textBlock' && 'text' in block) {
                textParts.push(String(block.text))
              }
            }
          }
          messageText = textParts.join('\n')
        }
      } else if (typeof response === 'string') {
        messageText = response
      }

      if (this._useLatestConventions) {
        this._addEvent(span, 'gen_ai.client.inference.operation.details', {
          'gen_ai.output.messages': serialize([
            { role: 'assistant', parts: [{ type: 'text', content: messageText }], finish_reason: finishReason },
          ]),
        })
      } else {
        this._addEvent(span, 'gen_ai.choice', { message: messageText, finish_reason: finishReason })
      }
    } catch {
      // Ignore response event errors
    }
  }

  /**
   * Add output event to a span for model invocation.
   */
  private _addOutputEvent(span: Span, msgObj: Record<string, unknown>, stopReason?: string): void {
    if (this._useLatestConventions) {
      this._addEvent(span, 'gen_ai.client.inference.operation.details', {
        'gen_ai.output.messages': serialize([
          {
            role: msgObj.role,
            parts: mapContentBlocksToOtelParts(msgObj.content as unknown[]),
            finish_reason: stopReason || 'unknown',
          },
        ]),
      })
    } else {
      const contentBlocks: unknown[] = []
      const content = msgObj.content
      if (Array.isArray(content)) {
        content.forEach((block: unknown) => {
          if (block && typeof block === 'object') {
            const blockObj = block as Record<string, unknown>
            if (blockObj.type === 'textBlock' && 'text' in blockObj) {
              contentBlocks.push({ text: blockObj.text })
            } else if (blockObj.type === 'toolUseBlock') {
              contentBlocks.push({
                type: 'toolUse',
                name: blockObj.name,
                toolUseId: blockObj.toolUseId,
                input: blockObj.input,
              })
            } else if (blockObj.type === 'toolResultBlock') {
              contentBlocks.push({
                type: 'toolResult',
                toolUseId: blockObj.toolUseId,
                content: blockObj.content,
              })
            }
          }
        })
      }

      this._addEvent(span, 'gen_ai.choice', {
        finish_reason: stopReason || 'unknown',
        message: serialize(contentBlocks),
      })
    }
  }
}


// ---------------------------------------------------------------------------
// Helper functions - Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize objects to JSON strings for inclusion in spans.
 * Handles circular references and special types.
 */
export function serialize(value: unknown): string {
  try {
    const seen = new WeakSet<object>()
    const processed = processValue(value, seen, 0)
    const result = JSON.stringify(processed)
    return result ?? 'undefined'
  } catch (error) {
    logger.warn(`error=<${error}> | failed to encode value, returning empty object`)
    return '{}'
  }
}

/**
 * Process any value, handling containers recursively.
 */
function processValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  // Limit recursion depth to prevent memory issues
  if (depth > MAX_JSON_ENCODE_DEPTH) {
    return '<max depth reached>'
  }

  if (value === null) return null
  if (value === undefined) return undefined

  if (value instanceof Date) return value.toISOString()

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }

  if (value instanceof Map) {
    if (seen.has(value)) return '<replaced>'
    seen.add(value)
    return {
      __type__: 'Map',
      value: Array.from(value.entries()).map(([k, v]) => [
        processValue(k, seen, depth + 1),
        processValue(v, seen, depth + 1),
      ]),
    }
  }

  if (value instanceof Set) {
    if (seen.has(value)) return '<replaced>'
    seen.add(value)
    return {
      __type__: 'Set',
      value: Array.from(value).map((item) => processValue(item, seen, depth + 1)),
    }
  }

  if (value instanceof RegExp) {
    return { __type__: 'RegExp', source: value.source, flags: value.flags }
  }

  if (typeof value === 'bigint') {
    return { __type__: 'BigInt', value: value.toString() }
  }

  if (typeof value === 'symbol') {
    return { __type__: 'Symbol', value: value.toString() }
  }

  if (typeof value === 'function') {
    return { __type__: 'Function', name: (value as unknown as Record<string, unknown>).name ?? 'anonymous' }
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    if (seen.has(value as object)) return '<replaced>'
    seen.add(value as object)

    const obj = value as Record<string, unknown>

    if (typeof obj.toJSON === 'function') {
      try {
        return processValue(obj.toJSON(), seen, depth + 1)
      } catch {
        // Fall through to default object handling
      }
    }

    if (typeof obj.toString === 'function' && obj.toString !== Object.prototype.toString) {
      try {
        return obj.toString()
      } catch {
        // Fall through to default object handling
      }
    }

    const processed: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj)) {
      processed[key] = processValue(val, seen, depth + 1)
    }
    return processed
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return '<replaced>'
    seen.add(value)
    return value.map((item) => processValue(item, seen, depth + 1))
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  try {
    JSON.stringify(value)
    return value
  } catch {
    return '<replaced>'
  }
}


/**
 * Map content blocks to OTEL parts format.
 */
export function mapContentBlocksToOtelParts(contentBlocks: unknown[]): Record<string, unknown>[] {
  try {
    return contentBlocks.map((block) => {
      if (!block || typeof block !== 'object') {
        return { type: 'unknown' }
      }

      const blockObj = block as Record<string, unknown>

      if (blockObj.type === 'textBlock') {
        return { type: 'text', content: blockObj.text }
      } else if (blockObj.type === 'toolUseBlock') {
        return { type: 'tool_call', name: blockObj.name, id: blockObj.toolUseId, arguments: blockObj.input }
      } else if (blockObj.type === 'toolResultBlock') {
        return { type: 'tool_call_response', id: blockObj.toolUseId, response: blockObj.content }
      } else if (blockObj.type === 'interruptResponseBlock') {
        return { type: 'interrupt_response', id: blockObj.interruptId, response: blockObj.response }
      }

      return blockObj as Record<string, unknown>
    })
  } catch (err) {
    logger.warn(`error=<${err}> | failed to map content blocks`)
    return []
  }
}
