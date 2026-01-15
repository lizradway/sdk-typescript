/**
 * OpenTelemetry integration.
 *
 * This module provides tracing capabilities using OpenTelemetry,
 * enabling trace data to be sent to OTLP endpoints.
 */

import { context, SpanStatusCode, SpanKind, trace } from '@opentelemetry/api'
import type { Span, Tracer as OtelTracer } from '@opentelemetry/api'
import type { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { logger } from '../logging/index.js'
import { initializeTracerProvider } from './config.js'
import type {
  TelemetryConfig,
  AttributeValue,
  Usage,
  Metrics,
  ToolUse,
  ToolResult,
  TracerSpan,
} from './types.js'
import type { Message } from '../types/messages.js'

/**
 * Custom JSON encoder that handles non-serializable types.
 */
class JSONEncoder {
  /**
   * Recursively encode objects, preserving structure and only replacing unserializable values.
   * Uses a local WeakSet per encode call to track circular references without memory buildup.
   */
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

  /**
   * Process any value, handling containers recursively.
   * Limits recursion depth to prevent stack overflow and memory issues.
   */
  private _processValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
    // Limit recursion depth to prevent memory issues
    if (depth > 50) {
      return '<max depth reached>'
    }

    if (value === null) {
      return null
    }

    if (value === undefined) {
      return undefined
    }

    if (value instanceof Date) {
      return value.toISOString()
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      }
    }

    if (value instanceof Map) {
      if (seen.has(value)) {
        return '<replaced>'
      }
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
      if (seen.has(value)) {
        return '<replaced>'
      }
      seen.add(value)
      return {
        __type__: 'Set',
        value: Array.from(value).map((item) => this._processValue(item, seen, depth + 1)),
      }
    }

    if (value instanceof RegExp) {
      return {
        __type__: 'RegExp',
        source: value.source,
        flags: value.flags,
      }
    }

    if (typeof value === 'bigint') {
      return {
        __type__: 'BigInt',
        value: value.toString(),
      }
    }

    if (typeof value === 'symbol') {
      return {
        __type__: 'Symbol',
        value: value.toString(),
      }
    }

    if (typeof value === 'function') {
      return {
        __type__: 'Function',
        name: (value as unknown as Record<string, unknown>).name ?? 'anonymous',
      }
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      if (seen.has(value as object)) {
        return '<replaced>'
      }

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
      if (seen.has(value)) {
        return '<replaced>'
      }
      seen.add(value)
      return value.map((item) => this._processValue(item, seen, depth + 1))
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
}

// Global encoder instance
const _encoder = new JSONEncoder()

/**
 * Tracer manages OpenTelemetry spans for agent operations.
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

    // Log warning when using experimental conventions
    if (this._useLatestConventions) {
      logger.warn(
        'semconv=<gen_ai_latest_experimental> | using experimental GenAI semantic conventions | ' +
        'these conventions are subject to change and may break in future releases'
      )
      console.warn(
        '[OTEL] Warning: Using experimental GenAI semantic conventions (gen_ai_latest_experimental). ' +
        'These conventions are subject to change and may require updates to your telemetry queries and dashboards.'
      )
    }

    // Initialize tracer provider and get tracer from it
    this._tracerProvider = initializeTracerProvider()
    this._tracer = this._tracerProvider.getTracer('strands-agents')
    logger.warn('tracer=<created> | tracer instance obtained from provider')
  }

  /**
   * Parse the OTEL_SEMCONV_STABILITY_OPT_IN environment variable.
   * Splits on commas and trims whitespace from each value.
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

  /**
   * Start an agent invocation span.
   */
  startAgentSpan(
    messages: Message[],
    agentName: string,
    _agentId?: string,
    modelId?: string,
    tools?: unknown[],
    customTraceAttributes?: Record<string, AttributeValue>,
    toolsConfig?: Record<string, unknown>,
    systemPrompt?: unknown,
  ): TracerSpan {
    try {
      const spanName = `invoke_agent ${agentName}`
      const attributes = this._getCommonAttributes('invoke_agent')
      attributes['gen_ai.agent.name'] = agentName
      // Set 'name' attribute for Langfuse trace-level name
      attributes['name'] = spanName

      if (modelId) {
        attributes['gen_ai.request.model'] = modelId
      }

      if (tools && tools.length > 0) {
        attributes['gen_ai.agent.tools'] = serialize(tools)
      }

      if (this._includeToolDefinitions && toolsConfig) {
        try {
          attributes['gen_ai.tool.definitions'] = serialize(toolsConfig)
        } catch (error) {
          logger.warn(`error=<${error}> | failed to serialize tool definitions`)
        }
      }

      // Capture system prompt if provided
      if (systemPrompt !== undefined) {
        try {
          attributes['system_prompt'] = serialize(systemPrompt)
        } catch (error) {
          logger.warn(`error=<${error}> | failed to serialize system prompt`)
        }
      }

      const mergedAttributes = this._mergeAttributes(attributes, customTraceAttributes)
      const span = this._startSpan(spanName, undefined, mergedAttributes, SpanKind.INTERNAL)

      if (span) {
        this._addEventMessages(span, messages)
      }

      return span
    } catch (error) {
      logger.warn(`error=<${error}> | failed to start agent span`)
      return null
    }
  }

  /**
   * Add token usage to accumulated totals.
   * Called after each model invocation to accumulate tokens across the agent loop.
   */
  accumulateTokenUsage(usage?: Usage): void {
    if (!usage) return
    // This method is called from agent.ts to accumulate token usage
    // The actual accumulation happens in agent.ts, this is just a marker method
  }

  /**
   * End an agent invocation span.
   */
  endAgentSpan(
    span: TracerSpan,
    response?: unknown,
    error?: Error,
    accumulatedUsage?: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
      cacheReadInputTokens: number
      cacheWriteInputTokens: number
    },
    stopReason?: string,
  ): void {
    if (!span) return

    try {
      const attributes: Record<string, AttributeValue> = {}

      // Add accumulated token usage if provided
      if (accumulatedUsage) {
        attributes['gen_ai.usage.prompt_tokens'] = accumulatedUsage.inputTokens
        attributes['gen_ai.usage.input_tokens'] = accumulatedUsage.inputTokens
        attributes['gen_ai.usage.completion_tokens'] = accumulatedUsage.outputTokens
        attributes['gen_ai.usage.output_tokens'] = accumulatedUsage.outputTokens
        attributes['gen_ai.usage.total_tokens'] = accumulatedUsage.totalTokens

        // Add cache token usage if available
        if (accumulatedUsage.cacheReadInputTokens > 0) {
          attributes['gen_ai.usage.cache_read_input_tokens'] = accumulatedUsage.cacheReadInputTokens
        }
        if (accumulatedUsage.cacheWriteInputTokens > 0) {
          attributes['gen_ai.usage.cache_write_input_tokens'] = accumulatedUsage.cacheWriteInputTokens
        }
      }

      // Add response as event (matching Python SDK pattern)
      if (response !== undefined && response !== null) {
        try {
          // Extract text content from response for the message
          let messageText = ''
          const finishReason = stopReason || 'end_turn'
          
          if (typeof response === 'object') {
            const respObj = response as Record<string, unknown>
            // Check if it's a Message-like object with content
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
                {
                  role: 'assistant',
                  parts: [{ type: 'text', content: messageText }],
                  finish_reason: finishReason,
                },
              ]),
            })
          } else {
            this._addEvent(span, 'gen_ai.choice', {
              message: messageText,
              finish_reason: finishReason,
            })
          }
        } catch (err) {
          logger.warn(`error=<${err}> | failed to add response event to agent span`)
        }
      }

      if (error) {
        this._endSpan(span, attributes, error)
      } else {
        this._endSpan(span, attributes)
      }
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end agent span`)
    }
  }

  /**
   * End a span with error status (convenience method).
   */
  endSpanWithError(span: TracerSpan, errorMessage: string, exception?: Error): void {
    if (!span) return

    const error = exception || new Error(errorMessage)
    this._endSpan(span, {}, error)
  }

  /**
   * Add optional usage and metrics attributes if they have values.
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
   * Start a model invocation span.
   */
  startModelInvokeSpan(
    messages: Message[],
    parentSpan?: TracerSpan,
    modelId?: string,
    customTraceAttributes?: Record<string, AttributeValue>,
  ): TracerSpan {
    try {
      const attributes = this._getCommonAttributes('chat')

      if (modelId) {
        attributes['gen_ai.request.model'] = modelId
      }

      const mergedAttributes = this._mergeAttributes(attributes, customTraceAttributes)
      const span = this._startSpan('chat', parentSpan ?? undefined, mergedAttributes, SpanKind.INTERNAL)

      if (span) {
        this._addEventMessages(span, messages)
      }

      return span
    } catch (error) {
      logger.warn(`error=<${error}> | failed to start model invoke span`)
      return null
    }
  }

  /**
   * End a model invocation span.
   */
  endModelInvokeSpan(
    span: TracerSpan,
    _message?: Message,
    usage?: Usage,
    metrics?: Metrics,
    _stopReason?: string,
    error?: Error,
    _input?: unknown,
    output?: unknown,
    outputStopReason?: string,
  ): void {
    if (!span) return

    try {
      // Add output as event (matching Python SDK pattern)
      if (output !== undefined && output && typeof output === 'object' && 'content' in output && 'role' in output) {
        const msgObj = output as Record<string, unknown>
        if (this._useLatestConventions) {
          this._addEvent(span, 'gen_ai.client.inference.operation.details', {
            'gen_ai.output.messages': serialize([
              {
                role: msgObj.role,
                parts: this._mapContentBlocksToOtelParts(msgObj.content as unknown[]),
                finish_reason: outputStopReason || 'unknown',
              },
            ]),
          })
        } else {
          // Format content blocks to match addInputOutput format (for Langfuse compatibility)
          const contentBlocks: unknown[] = []
          const content = msgObj.content
          if (Array.isArray(content)) {
            content.forEach((block: unknown) => {
              if (block && typeof block === 'object') {
                const blockObj = block as Record<string, unknown>
                // Map content block types to simple format (matching addInputOutput)
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
            finish_reason: outputStopReason || 'unknown',
            message: serialize(contentBlocks),
          })
        }
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

      if (error) {
        this._endSpan(span, attributes, error)
      } else {
        this._endSpan(span, attributes)
      }
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end model invoke span`)
    }
  }

  /**
   * Start a tool call span.
   */
  startToolCallSpan(
    tool: ToolUse,
    parentSpan?: TracerSpan,
    customTraceAttributes?: Record<string, AttributeValue>,
  ): TracerSpan {
    try {
      const attributes = this._getCommonAttributes('execute_tool')
      attributes['gen_ai.tool.name'] = tool.name
      attributes['gen_ai.tool.call.id'] = tool.toolUseId

      const mergedAttributes = this._mergeAttributes(attributes, customTraceAttributes)
      const span = this._startSpan(`execute_tool ${tool.name}`, parentSpan ?? undefined, mergedAttributes, SpanKind.INTERNAL)

      if (span) {
        if (this._useLatestConventions) {
          this._addEvent(span, 'gen_ai.client.inference.operation.details', {
            'gen_ai.input.messages': serialize([
              {
                role: 'tool',
                parts: [
                  {
                    type: 'tool_call',
                    name: tool.name,
                    id: tool.toolUseId,
                    arguments: tool.input,
                  },
                ],
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
      }

      return span
    } catch (error) {
      logger.warn(`error=<${error}> | failed to start tool call span`)
      return null
    }
  }

  /**
   * End a tool call span.
   */
  endToolCallSpan(span: TracerSpan, toolResult?: ToolResult, error?: Error): void {
    if (!span) return

    try {
      const attributes: Record<string, AttributeValue> = {}

      if (toolResult) {
        const status = toolResult.status
        const statusStr = typeof status === 'string' ? status : String(status)
        attributes['gen_ai.tool.status'] = statusStr

        if (this._useLatestConventions) {
          this._addEvent(span, 'gen_ai.client.inference.operation.details', {
            'gen_ai.output.messages': serialize([
              {
                role: 'tool',
                parts: [
                  {
                    type: 'tool_call_response',
                    id: toolResult.toolUseId,
                    response: toolResult.content,
                  },
                ],
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

      if (error) {
        this._endSpan(span, attributes, error)
      } else {
        this._endSpan(span, attributes)
      }
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end tool call span`)
    }
  }

  /**
   * Start an event loop cycle span.
   */
  startEventLoopCycleSpan(
    cycleId: string,
    messages: Message[],
    parentSpan?: TracerSpan,
    customTraceAttributes?: Record<string, AttributeValue>,
  ): TracerSpan {
    try {
      const attributes: Record<string, AttributeValue> = {
        'event_loop.cycle_id': cycleId,
      }

      const mergedAttributes = this._mergeAttributes(attributes, customTraceAttributes)
      const span = this._startSpan('execute_event_loop_cycle', parentSpan ?? undefined, mergedAttributes)

      if (span) {
        this._addEventMessages(span, messages)
      }

      return span
    } catch (error) {
      logger.warn(`error=<${error}> | failed to start event loop cycle span`)
      return null
    }
  }

  /**
   * End an event loop cycle span.
   */
  endEventLoopCycleSpan(
    span: TracerSpan,
    message?: Message,
    toolResultMessage?: Message,
    error?: Error,
  ): void {
    if (!span) return

    try {
      const attributes: Record<string, AttributeValue> = {}

      // Add assistant message output if provided (final response from model)
      if (message && message.content) {
        if (this._useLatestConventions) {
          this._addEvent(span, 'gen_ai.client.inference.operation.details', {
            'gen_ai.output.messages': serialize([
              {
                role: message.role || 'assistant',
                parts: this._mapContentBlocksToOtelParts(message.content as unknown[]),
              },
            ]),
          })
        } else {
          this._addEvent(span, 'gen_ai.assistant.message', {
            content: serialize(message.content),
          })
        }
      }

      // Add tool result output if provided (tools completed)
      if (toolResultMessage && toolResultMessage.content) {
        if (this._useLatestConventions) {
          this._addEvent(span, 'gen_ai.client.inference.operation.details', {
            'gen_ai.output.messages': serialize([
              {
                role: 'tool',
                parts: this._mapContentBlocksToOtelParts(toolResultMessage.content as unknown[]),
              },
            ]),
          })
        } else {
          this._addEvent(span, 'gen_ai.tool.message', {
            role: 'tool',
            content: serialize(toolResultMessage.content),
          })
        }
      }

      if (error) {
        this._endSpan(span, attributes, error)
      } else {
        this._endSpan(span, attributes)
      }
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end event loop cycle span`)
    }
  }

  /**
   * Start a span with the given name and attributes.
   * Follows the Python SDK pattern: passes context as third parameter to startSpan().
   */
  private _startSpan(
    spanName: string,
    parentSpan?: Span,
    attributes?: Record<string, AttributeValue>,
    spanKind?: SpanKind,
  ): Span | null {
    try {
      // Create span options
      const options: {
        attributes?: Record<string, AttributeValue | undefined>
        kind?: SpanKind
      } = {}

      if (attributes) {
        // Filter out undefined/null values
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

      // Create the span with parent context if provided
      // This matches the Python SDK pattern: trace_api.set_span_in_context(parent_span)
      let spanContext: import('@opentelemetry/api').Context | undefined
      if (parentSpan && parentSpan.isRecording()) {
        spanContext = trace.setSpan(context.active(), parentSpan)
      }

      // Pass context as third parameter to startSpan() - this is the key to trace ID inheritance
      const span = this._tracer.startSpan(spanName, options, spanContext)

      // Set start time
      const startTime = new Date().toISOString()
      try {
        span.setAttribute('gen_ai.event.start_time', startTime)
      } catch (err) {
        logger.warn(`error=<${err}> | failed to set start time attribute`)
      }

      return span
    } catch (error) {
      logger.warn(`error=<${error}> | failed to start span`)
      return null
    }
  }

  /**
   * End a span with the given attributes and optional error.
   */
  private _endSpan(span: Span, attributes?: Record<string, AttributeValue>, error?: Error): void {
    try {
      // Set end time
      const endTime = new Date().toISOString()
      const endAttributes: Record<string, AttributeValue> = {
        'gen_ai.event.end_time': endTime,
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

      // Force flush to ensure spans are exported immediately (matching Python SDK)
      try {
        this._tracerProvider.forceFlush()
      } catch (e) {
        logger.warn(`error=<${e}> | failed to force flush tracer provider`)
      }
    } catch (err) {
      logger.warn(`error=<${err}> | failed to end span`)
    }
  }

  /**
   * Set attributes on a span.
   */
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
      logger.warn(`event=<${eventName}> | failed to add event`)
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
            parts: this._mapContentBlocksToOtelParts(message.content),
          })
        }
        this._addEvent(span, 'gen_ai.client.inference.operation.details', {
          'gen_ai.input.messages': serialize(inputMessages),
        })
      } else {
        for (const message of messages) {
          const eventName = this._getEventNameForMessage(message)
          this._addEvent(span, eventName, {
            content: serialize(message.content),
          })
        }
      }
    } catch (err) {
      logger.warn(`error=<${err}> | failed to add message events`)
    }
  }

  /**
   * Get the event name for a message based on its type.
   */
  private _getEventNameForMessage(message: Message): string {
    try {
      // Check if this is a tool result message
      if (message.role === 'user' && Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block && typeof block === 'object' && 'type' in block && block.type === 'toolResultBlock') {
            return 'gen_ai.tool.message'
          }
        }
      }

      // Default based on role
      if (message.role === 'user') {
        return 'gen_ai.user.message'
      } else if (message.role === 'assistant') {
        return 'gen_ai.assistant.message'
      }

      return 'gen_ai.message'
    } catch (err) {
      logger.warn(`error=<${err}> | failed to determine event name for message`)
      return 'gen_ai.message'
    }
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
   * Map content blocks to OTEL parts format.
   */
  private _mapContentBlocksToOtelParts(contentBlocks: unknown[]): Record<string, unknown>[] {
    try {
      return contentBlocks.map((block) => {
        if (!block || typeof block !== 'object') {
          return { type: 'unknown' }
        }

        const blockObj = block as Record<string, unknown>

        if (blockObj.type === 'textBlock') {
          return {
            type: 'text',
            content: blockObj.text,
          }
        } else if (blockObj.type === 'toolUseBlock') {
          return {
            type: 'tool_call',
            name: blockObj.name,
            id: blockObj.toolUseId,
            arguments: blockObj.input,
          }
        } else if (blockObj.type === 'toolResultBlock') {
          return {
            type: 'tool_call_response',
            id: blockObj.toolUseId,
            response: blockObj.content,
          }
        } else if (blockObj.type === 'interruptResponseBlock') {
          return {
            type: 'interrupt_response',
            id: blockObj.interruptId,
            response: blockObj.response,
          }
        }

        return blockObj as Record<string, unknown>
      })
    } catch (err) {
      logger.warn(`error=<${err}> | failed to map content blocks`)
      return []
    }
  }
}

/**
 * Serialize objects to JSON strings for inclusion in spans.
 * Handles circular references and special types using a custom encoder.
 */
export function serialize(value: unknown): string {
  return _encoder.encode(value)
}

/**
 * Map content blocks to OTEL parts format.
 */
export function mapContentBlocksToOtelParts(contentBlocks: unknown[]): Record<string, unknown>[] {
  const tracer = new Tracer()
  return tracer['_mapContentBlocksToOtelParts'](contentBlocks)
}

// Global tracer instance for singleton access
let _globalTracerInstance: Tracer | null = null

/**
 * Get or create the global tracer instance.
 * Returns the same instance on subsequent calls.
 */
export function getTracer(): Tracer {
  if (!_globalTracerInstance) {
    _globalTracerInstance = new Tracer()
  }
  return _globalTracerInstance
}
