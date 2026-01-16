/**
 * OpenTelemetry integration.
 *
 * This module provides tracing capabilities using OpenTelemetry,
 * enabling trace data to be sent to OTLP endpoints.
 *
 * Uses startActiveSpan for automatic context propagation - child spans
 * automatically parent to the current active span without manual tracking.
 */

import { context, SpanStatusCode, SpanKind, trace } from '@opentelemetry/api'
import type { Span, Tracer as OtelTracer, Context } from '@opentelemetry/api'
import type { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { logger } from '../logging/index.js'
import { initializeTracerProvider } from './config.js'
import type { AttributeValue, Usage, Metrics } from './types.js'
import type { Message } from '../types/messages.js'
import type {
  BeforeInvocationEvent,
  AfterInvocationEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
} from '../hooks/events.js'
import type {
  ITracer,
  TracerSpanHandle,
  StartSpanEvent,
  EndSpanEvent,
  StartSpanContext,
  EndSpanContext,
} from './tracer-interface.js'
import { getModelId } from './utils.js'

/**
 * Handle returned by startSpan that includes both the span and its context.
 * This allows proper context propagation when ending spans.
 */
export interface ActiveSpanHandle {
  span: Span
  context: Context
}


/**
 * Custom JSON encoder that handles non-serializable types.
 */
class JSONEncoder {
  encode(obj: unknown): string {
    try {
      const seen = new WeakSet<object>()
      const processed = this._processValue(obj, seen, 0)
      const result = JSON.stringify(processed)
      return result ?? 'undefined'
    } catch (error) {
      logger.warn(`error=<${error}> | failed to encode value, returning empty object`)
      return '{}'
    }
  }

  private _processValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
    if (depth > 50) return '<max depth reached>'
    if (value === null) return null
    if (value === undefined) return undefined
    if (value instanceof Date) return value.toISOString()
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }

    if (value instanceof Map) {
      if (seen.has(value)) return '<replaced>'
      seen.add(value)
      return {
        __type__: 'Map',
        value: Array.from(value.entries()).map(([k, v]) => [
          this._processValue(k, seen, depth + 1),
          this._processValue(v, seen, depth + 1),
        ]),
      }
    }

    if (value instanceof Set) {
      if (seen.has(value)) return '<replaced>'
      seen.add(value)
      return { __type__: 'Set', value: Array.from(value).map((item) => this._processValue(item, seen, depth + 1)) }
    }

    if (value instanceof RegExp) return { __type__: 'RegExp', source: value.source, flags: value.flags }
    if (typeof value === 'bigint') return { __type__: 'BigInt', value: value.toString() }
    if (typeof value === 'symbol') return { __type__: 'Symbol', value: value.toString() }
    if (typeof value === 'function') {
      return { __type__: 'Function', name: (value as unknown as Record<string, unknown>).name ?? 'anonymous' }
    }


    if (typeof value === 'object' && !Array.isArray(value)) {
      if (seen.has(value as object)) return '<replaced>'
      seen.add(value as object)
      const obj = value as Record<string, unknown>
      if (typeof obj.toJSON === 'function') {
        try {
          return this._processValue(obj.toJSON(), seen, depth + 1)
        } catch (err) {
          logger.warn(`error=<${err}> | failed to call toJSON method`)
        }
      }
      if (typeof obj.toString === 'function' && obj.toString !== Object.prototype.toString) {
        try {
          return obj.toString()
        } catch (err) {
          logger.warn(`error=<${err}> | failed to call toString method`)
        }
      }
      const processed: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(obj)) {
        processed[key] = this._processValue(val, seen, depth + 1)
      }
      return processed
    }

    if (Array.isArray(value)) {
      if (seen.has(value)) return '<replaced>'
      seen.add(value)
      return value.map((item) => this._processValue(item, seen, depth + 1))
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value

    try {
      JSON.stringify(value)
      return value
    } catch {
      return '<replaced>'
    }
  }
}

const _encoder = new JSONEncoder()


/**
 * Tracer manages OpenTelemetry spans for agent operations.
 * Implements ITracer interface for use with TracerHookAdapter.
 *
 * Maintains a context stack to ensure proper parent-child relationships
 * between spans across async boundaries.
 */
export class Tracer implements ITracer {
  private readonly _tracer: OtelTracer
  private readonly _tracerProvider: NodeTracerProvider
  private readonly _useLatestConventions: boolean
  
  // Context stack for proper span parenting across async boundaries
  private _contextStack: Context[] = []

  constructor() {
    const optInValues = this._parseSemconvOptIn()
    this._useLatestConventions = optInValues.has('gen_ai_latest_experimental')

    if (this._useLatestConventions) {
      logger.warn(
        'semconv=<gen_ai_latest_experimental> | using experimental GenAI semantic conventions | ' +
          'these conventions are subject to change and may break in future releases',
      )
      console.warn(
        '[OTEL] Warning: Using experimental GenAI semantic conventions (gen_ai_latest_experimental). ' +
          'These conventions are subject to change and may require updates to your telemetry queries and dashboards.',
      )
    }

    this._tracerProvider = initializeTracerProvider()
    this._tracer = this._tracerProvider.getTracer('strands-agents')
    logger.warn('tracer=<created> | tracer instance obtained from provider')
  }

  private _parseSemconvOptIn(): Set<string> {
    const optInEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN ?? ''
    return new Set(
      optInEnv
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    )
  }
  
  /**
   * Get the current context for span creation.
   * Uses the top of the context stack if available, otherwise the active context.
   */
  private _getCurrentContext(): Context {
    return this._contextStack.length > 0 
      ? this._contextStack[this._contextStack.length - 1]! 
      : context.active()
  }
  
  /**
   * Push a new context onto the stack.
   */
  private _pushContext(ctx: Context): void {
    this._contextStack.push(ctx)
  }
  
  /**
   * Pop a context from the stack.
   */
  private _popContext(): void {
    this._contextStack.pop()
  }


  // ============================================================================
  // ITracer Interface Methods
  // ============================================================================

  startSpan(event: StartSpanEvent, ctx?: StartSpanContext): TracerSpanHandle | undefined {
    switch (event.type) {
      case 'beforeInvocationEvent':
        return this._startAgentSpan(event, ctx)
      case 'beforeModelCallEvent':
        return this._startModelSpan(event)
      case 'beforeToolCallEvent':
        return this._startToolSpan(event)
      default:
        logger.warn(`event_type=<${(event as { type: string }).type}> | unknown start span event type`)
        return undefined
    }
  }

  endSpan(handle: TracerSpanHandle, event: EndSpanEvent, ctx?: EndSpanContext): void {
    if (!handle) return

    const { span } = handle as ActiveSpanHandle

    switch (event.type) {
      case 'afterInvocationEvent':
        this._endAgentSpan(span, event, ctx)
        break
      case 'afterModelCallEvent':
        this._endModelSpan(span, event)
        break
      case 'afterToolCallEvent':
        this._endToolSpan(span, event)
        break
      default:
        logger.warn(`event_type=<${(event as { type: string }).type}> | unknown end span event type`)
    }
  }


  // ============================================================================
  // Internal Cycle Span Methods (used by TracerHookAdapter)
  // ============================================================================

  /**
   * Start a cycle span for internal use by TracerHookAdapter.
   * Not part of the ITracer interface - cycle spans are managed internally.
   * @internal
   */
  startCycleSpan(event: BeforeModelCallEvent, cycleId: string): ActiveSpanHandle | undefined {
    try {
      const attributes: Record<string, AttributeValue> = { 'event_loop.cycle_id': cycleId }
      const mergedAttributes = this._mergeAttributes(attributes)
      const handle = this._createActiveSpan('execute_event_loop_cycle', mergedAttributes)

      if (handle) {
        this._addEventMessages(handle.span, event.agent.messages)
      }

      return handle
    } catch (error) {
      logger.warn(`error=<${error}> | failed to start cycle span`)
      return undefined
    }
  }

  /**
   * End a cycle span for internal use by TracerHookAdapter.
   * Not part of the ITracer interface - cycle spans are managed internally.
   * @internal
   */
  endCycleSpan(handle: ActiveSpanHandle, event: AfterModelCallEvent | { type: 'afterToolsEvent'; message?: { content?: unknown[] } }): void {
    if (!handle) return

    try {
      const { span } = handle
      const attributes: Record<string, AttributeValue> = {}

      if (event.type === 'afterModelCallEvent' && event.stopData?.message?.content) {
        const response = event.stopData.message
        if (this._useLatestConventions) {
          this._addEvent(span, 'gen_ai.client.inference.operation.details', {
            'gen_ai.output.messages': serialize([
              { role: response.role || 'assistant', parts: mapContentBlocksToOtelParts(response.content as unknown[]) },
            ]),
          })
        } else {
          this._addEvent(span, 'gen_ai.assistant.message', { content: serialize(response.content) })
        }
      }

      if (event.type === 'afterToolsEvent' && event.message?.content) {
        if (this._useLatestConventions) {
          this._addEvent(span, 'gen_ai.client.inference.operation.details', {
            'gen_ai.output.messages': serialize([
              { role: 'tool', parts: mapContentBlocksToOtelParts(event.message.content as unknown[]) },
            ]),
          })
        } else {
          this._addEvent(span, 'gen_ai.tool.message', { role: 'tool', content: serialize(event.message.content) })
        }
      }

      this._closeSpan(span, attributes)
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end cycle span`)
    }
  }


  // ============================================================================
  // Private Span Creation Methods
  // ============================================================================

  private _startAgentSpan(event: BeforeInvocationEvent, ctx?: StartSpanContext): ActiveSpanHandle | undefined {
    try {
      const agentName = event.agent.name
      const spanName = `invoke_agent ${agentName}`
      const attributes = this._getCommonAttributes('invoke_agent')
      attributes['gen_ai.agent.name'] = agentName
      attributes['name'] = spanName

      const modelId = getModelId(event.agent)
      if (modelId) {
        attributes['gen_ai.request.model'] = modelId
      }

      if (event.agent.tools && event.agent.tools.length > 0) {
        attributes['gen_ai.agent.tools'] = serialize(event.agent.tools)
      }

      if (event.agent.systemPrompt !== undefined) {
        try {
          attributes['system_prompt'] = serialize(event.agent.systemPrompt)
        } catch (error) {
          logger.warn(`error=<${error}> | failed to serialize system prompt`)
        }
      }

      const customAttrs = ctx?.customTraceAttributes ?? event.agent.customTraceAttributes
      const mergedAttributes = this._mergeAttributes(attributes, customAttrs)
      const handle = this._createActiveSpan(spanName, mergedAttributes, SpanKind.INTERNAL)

      if (handle) {
        this._addEventMessages(handle.span, event.inputMessages)
      }

      return handle
    } catch (error) {
      logger.warn(`error=<${error}> | failed to start agent span`)
      return undefined
    }
  }


  private _endAgentSpan(span: Span, event: AfterInvocationEvent, ctx?: EndSpanContext): void {
    try {
      const attributes: Record<string, AttributeValue> = {}

      const usage = ctx?.accumulatedUsage ?? event.accumulatedUsage
      if (usage) {
        attributes['gen_ai.usage.prompt_tokens'] = usage.inputTokens
        attributes['gen_ai.usage.input_tokens'] = usage.inputTokens
        attributes['gen_ai.usage.completion_tokens'] = usage.outputTokens
        attributes['gen_ai.usage.output_tokens'] = usage.outputTokens
        attributes['gen_ai.usage.total_tokens'] = usage.totalTokens

        if (usage.cacheReadInputTokens !== undefined && usage.cacheReadInputTokens > 0) {
          attributes['gen_ai.usage.cache_read_input_tokens'] = usage.cacheReadInputTokens
        }
        if (usage.cacheWriteInputTokens !== undefined && usage.cacheWriteInputTokens > 0) {
          attributes['gen_ai.usage.cache_write_input_tokens'] = usage.cacheWriteInputTokens
        }
      }

      if (event.result?.message) {
        try {
          let messageText = ''
          const finishReason = event.result.stopReason || 'end_turn'
          const response = event.result.message

          if (typeof response === 'object' && 'content' in response && Array.isArray(response.content)) {
            const textParts: string[] = []
            for (const block of response.content) {
              if (block && typeof block === 'object' && 'type' in block && block.type === 'textBlock' && 'text' in block) {
                textParts.push(String(block.text))
              }
            }
            messageText = textParts.join('\n')
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
        } catch (err) {
          logger.warn(`error=<${err}> | failed to add response event to agent span`)
        }
      }

      this._closeSpan(span, attributes, event.error)
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end agent span`)
    }
  }


  private _startModelSpan(event: BeforeModelCallEvent): ActiveSpanHandle | undefined {
    try {
      const attributes = this._getCommonAttributes('chat')

      const modelId = getModelId(event.agent)
      if (modelId) {
        attributes['gen_ai.request.model'] = modelId
      }

      const mergedAttributes = this._mergeAttributes(attributes)
      const handle = this._createActiveSpan('chat', mergedAttributes, SpanKind.INTERNAL)

      if (handle) {
        this._addEventMessages(handle.span, event.agent.messages)
      }

      return handle
    } catch (error) {
      logger.warn(`error=<${error}> | failed to start model span`)
      return undefined
    }
  }

  private _endModelSpan(span: Span, event: AfterModelCallEvent): void {
    try {
      if (event.stopData?.message) {
        const msgObj = event.stopData.message as unknown as Record<string, unknown>
        if (this._useLatestConventions) {
          this._addEvent(span, 'gen_ai.client.inference.operation.details', {
            'gen_ai.output.messages': serialize([
              {
                role: msgObj.role,
                parts: mapContentBlocksToOtelParts(msgObj.content as unknown[]),
                finish_reason: event.stopData.stopReason || 'unknown',
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
                  contentBlocks.push({ type: 'toolUse', name: blockObj.name, toolUseId: blockObj.toolUseId, input: blockObj.input })
                } else if (blockObj.type === 'toolResultBlock') {
                  contentBlocks.push({ type: 'toolResult', toolUseId: blockObj.toolUseId, content: blockObj.content })
                }
              }
            })
          }
          this._addEvent(span, 'gen_ai.choice', { finish_reason: event.stopData.stopReason || 'unknown', message: serialize(contentBlocks) })
        }
      }

      const attributes: Record<string, AttributeValue> = {}

      if (event.usage) {
        attributes['gen_ai.usage.prompt_tokens'] = event.usage.inputTokens
        attributes['gen_ai.usage.input_tokens'] = event.usage.inputTokens
        attributes['gen_ai.usage.completion_tokens'] = event.usage.outputTokens
        attributes['gen_ai.usage.output_tokens'] = event.usage.outputTokens
        attributes['gen_ai.usage.total_tokens'] = event.usage.totalTokens

        if (event.metrics) {
          this._addOptionalUsageAndMetricsAttributes(attributes, event.usage, event.metrics)
        }
      }

      this._closeSpan(span, attributes, event.error)
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end model span`)
    }
  }


  private _startToolSpan(event: BeforeToolCallEvent): ActiveSpanHandle | undefined {
    try {
      const attributes = this._getCommonAttributes('execute_tool')
      attributes['gen_ai.tool.name'] = event.toolUse.name
      attributes['gen_ai.tool.call.id'] = event.toolUse.toolUseId

      const mergedAttributes = this._mergeAttributes(attributes)
      const handle = this._createActiveSpan(`execute_tool ${event.toolUse.name}`, mergedAttributes, SpanKind.INTERNAL)

      if (handle) {
        if (this._useLatestConventions) {
          this._addEvent(handle.span, 'gen_ai.client.inference.operation.details', {
            'gen_ai.input.messages': serialize([
              { role: 'tool', parts: [{ type: 'tool_call', name: event.toolUse.name, id: event.toolUse.toolUseId, arguments: event.toolUse.input }] },
            ]),
          })
        } else {
          this._addEvent(handle.span, 'gen_ai.tool.message', { role: 'tool', content: serialize(event.toolUse.input), id: event.toolUse.toolUseId })
        }
      }

      return handle
    } catch (error) {
      logger.warn(`error=<${error}> | failed to start tool span`)
      return undefined
    }
  }

  private _endToolSpan(span: Span, event: AfterToolCallEvent): void {
    try {
      const attributes: Record<string, AttributeValue> = {}

      if (event.result) {
        const statusStr = typeof event.result.status === 'string' ? event.result.status : String(event.result.status)
        attributes['gen_ai.tool.status'] = statusStr

        if (this._useLatestConventions) {
          this._addEvent(span, 'gen_ai.client.inference.operation.details', {
            'gen_ai.output.messages': serialize([
              { role: 'tool', parts: [{ type: 'tool_call_response', id: event.result.toolUseId, response: event.result.content }] },
            ]),
          })
        } else {
          this._addEvent(span, 'gen_ai.choice', { message: serialize(event.result.content), id: event.result.toolUseId })
        }
      }

      this._closeSpan(span, attributes, event.error)
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end tool span`)
    }
  }


  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private _addOptionalUsageAndMetricsAttributes(attributes: Record<string, AttributeValue>, usage: Usage, metrics: Metrics): void {
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
   * Create a span and set it as the current span in context.
   * Child spans will automatically parent to this span.
   * Returns both the span and its context for proper context management.
   */
  private _createActiveSpan(spanName: string, attributes?: Record<string, AttributeValue>, spanKind?: SpanKind): ActiveSpanHandle | undefined {
    try {
      const options: { attributes?: Record<string, AttributeValue | undefined>; kind?: SpanKind } = {}

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

      // Start span in the current context - it will parent to any active span
      const parentContext = this._getCurrentContext()
      const span = this._tracer.startSpan(spanName, options, parentContext)

      try {
        span.setAttribute('gen_ai.event.start_time', new Date().toISOString())
      } catch (err) {
        logger.warn(`error=<${err}> | failed to set start time attribute`)
      }

      // Create a new context with this span as the active span
      const spanContext = trace.setSpan(parentContext, span)
      
      // Push this context onto the stack so child spans parent to it
      this._pushContext(spanContext)

      return {
        span,
        context: spanContext,
      }
    } catch (error) {
      logger.warn(`error=<${error}> | failed to start span`)
      return undefined
    }
  }


  private _closeSpan(span: Span | null, attributes?: Record<string, AttributeValue>, error?: Error): void {
    if (!span) return

    try {
      const endAttributes: Record<string, AttributeValue> = { 'gen_ai.event.end_time': new Date().toISOString() }
      if (attributes) Object.assign(endAttributes, attributes)

      this._setAttributes(span, endAttributes)

      if (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
        span.recordException(error)
      } else {
        span.setStatus({ code: SpanStatusCode.OK })
      }

      span.end()
      
      // Pop the context from the stack
      this._popContext()
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end span`)
    }
  }

  private _setAttributes(span: Span, attributes: Record<string, AttributeValue>): void {
    try {
      for (const [key, value] of Object.entries(attributes)) {
        if (value !== undefined && value !== null) {
          try {
            span.setAttribute(key, value)
          } catch {
            logger.warn(`key=<${key}> | failed to set attribute`)
          }
        }
      }
    } catch (_err) {
      logger.warn(`error=<${_err}> | failed to set attributes`)
    }
  }

  private _addEvent(span: Span | null, eventName: string, eventAttributes?: Record<string, AttributeValue>): void {
    if (!span) return
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
      logger.warn(`event=<${eventName}> | failed to add event`)
    }
  }


  private _getCommonAttributes(operationName: string): Record<string, AttributeValue> {
    const attributes: Record<string, AttributeValue> = { 'gen_ai.operation.name': operationName }
    if (this._useLatestConventions) {
      attributes['gen_ai.provider.name'] = 'strands-agents'
    } else {
      attributes['gen_ai.system'] = 'strands-agents'
    }
    return attributes
  }

  private _addEventMessages(span: Span, messages: Message[]): void {
    try {
      if (!Array.isArray(messages)) return

      if (this._useLatestConventions) {
        const inputMessages: unknown[] = []
        for (const message of messages) {
          inputMessages.push({ role: message.role, parts: mapContentBlocksToOtelParts(message.content) })
        }
        this._addEvent(span, 'gen_ai.client.inference.operation.details', { 'gen_ai.input.messages': serialize(inputMessages) })
      } else {
        for (const message of messages) {
          const eventName = this._getEventNameForMessage(message)
          this._addEvent(span, eventName, { content: serialize(message.content) })
        }
      }
    } catch (err) {
      logger.warn(`error=<${err}> | failed to add message events`)
    }
  }

  private _getEventNameForMessage(message: Message): string {
    try {
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
    } catch (err) {
      logger.warn(`error=<${err}> | failed to determine event name for message`)
      return 'gen_ai.message'
    }
  }


  private _mergeAttributes(
    standardAttributes: Record<string, AttributeValue>,
    customAttributes?: Record<string, unknown>,
  ): Record<string, AttributeValue> {
    if (!customAttributes) {
      return standardAttributes
    }
    const validCustomAttributes: Record<string, AttributeValue> = {}
    for (const [key, value] of Object.entries(customAttributes)) {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        Array.isArray(value)
      ) {
        validCustomAttributes[key] = value as AttributeValue
      }
    }
    return { ...standardAttributes, ...validCustomAttributes }
  }
}

/**
 * Map content blocks to OTEL parts format.
 */
export function mapContentBlocksToOtelParts(contentBlocks: unknown[]): Record<string, unknown>[] {
  try {
    return contentBlocks.map((block) => {
      if (!block || typeof block !== 'object') return { type: 'unknown' }

      const blockObj = block as Record<string, unknown>

      if (blockObj.type === 'textBlock') return { type: 'text', content: blockObj.text }
      if (blockObj.type === 'toolUseBlock') return { type: 'tool_call', name: blockObj.name, id: blockObj.toolUseId, arguments: blockObj.input }
      if (blockObj.type === 'toolResultBlock') return { type: 'tool_call_response', id: blockObj.toolUseId, response: blockObj.content }
      if (blockObj.type === 'interruptResponseBlock') return { type: 'interrupt_response', id: blockObj.interruptId, response: blockObj.response }

      return blockObj as Record<string, unknown>
    })
  } catch (err) {
    logger.warn(`error=<${err}> | failed to map content blocks`)
    return []
  }
}

/**
 * Serialize objects to JSON strings for inclusion in spans.
 */
export function serialize(value: unknown): string {
  return _encoder.encode(value)
}

let _globalTracerInstance: Tracer | null = null

/**
 * Get or create the global tracer instance.
 */
export function getTracer(): Tracer {
  if (!_globalTracerInstance) {
    _globalTracerInstance = new Tracer()
  }
  return _globalTracerInstance
}
