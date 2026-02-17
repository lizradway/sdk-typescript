import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Span, SpanContext, SpanStatus } from '@opentelemetry/api'
import type { SpanAttributes, SpanAttributeValue } from '@opentelemetry/api'
import type { TimeInput } from '@opentelemetry/api'
import type { Exception } from '@opentelemetry/api'
import type { Link } from '@opentelemetry/api'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { Tracer } from '../tracer.js'
import { Message, TextBlock, ToolResultBlock, ToolUseBlock } from '../../types/messages.js'

// Mock the OTel API — vi.mock is hoisted, so the top-level `trace` import receives the mock
vi.mock('@opentelemetry/api', async () => {
  const actual = await vi.importActual<typeof import('@opentelemetry/api')>('@opentelemetry/api')
  return {
    ...actual,
    context: { active: vi.fn(() => ({})) },
    trace: {
      getTracer: vi.fn(),
      setSpan: vi.fn(),
    },
  }
})

/**
 * Concrete mock implementing the Span interface.
 * Chainable methods return `this` to satisfy the `Span` contract.
 */
class MockSpan implements Span {
  readonly calls = {
    setAttribute: [] as Array<{ key: string; value: SpanAttributeValue }>,
    setAttributes: [] as Array<{ attributes: SpanAttributes }>,
    addEvent: [] as Array<{
      name: string
      attributes: SpanAttributes | TimeInput | undefined
      startTime: TimeInput | undefined
    }>,
    setStatus: [] as Array<{ status: SpanStatus }>,
    updateName: [] as Array<{ name: string }>,
    end: [] as Array<{ endTime: TimeInput | undefined }>,
    recordException: [] as Array<{ exception: Exception; time: TimeInput | undefined }>,
  }

  spanContext(): SpanContext {
    return { traceId: 'trace-1', spanId: 'span-1', traceFlags: 1 }
  }

  setAttribute(key: string, value: SpanAttributeValue): this {
    this.calls.setAttribute.push({ key, value })
    return this
  }

  setAttributes(attributes: SpanAttributes): this {
    this.calls.setAttributes.push({ attributes })
    return this
  }

  addEvent(name: string, attributesOrStartTime?: SpanAttributes | TimeInput, startTime?: TimeInput): this {
    this.calls.addEvent.push({ name, attributes: attributesOrStartTime, startTime })
    return this
  }

  addLink(_link: Link): this {
    return this
  }

  addLinks(_links: Link[]): this {
    return this
  }

  setStatus(status: SpanStatus): this {
    this.calls.setStatus.push({ status })
    return this
  }

  updateName(name: string): this {
    this.calls.updateName.push({ name })
    return this
  }

  end(endTime?: TimeInput): void {
    this.calls.end.push({ endTime })
  }

  isRecording(): boolean {
    return true
  }

  recordException(exception: Exception, time?: TimeInput): void {
    this.calls.recordException.push({ exception, time })
  }

  // Helpers for assertions

  getAttributeValue(key: string): SpanAttributeValue | undefined {
    const entry = this.calls.setAttribute.find((c) => c.key === key)
    return entry?.value
  }

  getEvents(name: string): Array<{ name: string; attributes: SpanAttributes | TimeInput | undefined }> {
    return this.calls.addEvent.filter((c) => c.name === name)
  }

  getEventAttribute(eventName: string, attrKey: string): string | undefined {
    const event = this.calls.addEvent.find((c) => c.name === eventName)
    if (event?.attributes && typeof event.attributes === 'object' && attrKey in event.attributes) {
      return (event.attributes as Record<string, string>)[attrKey]
    }
    return undefined
  }
}

function userMessage(text: string): Message {
  return new Message({ role: 'user', content: [new TextBlock(text)] })
}

function assistantMessage(text: string): Message {
  return new Message({ role: 'assistant', content: [new TextBlock(text)] })
}

describe('Tracer', () => {
  let mockSpan: MockSpan
  let mockStartSpan: ReturnType<typeof vi.fn<(name: string, ...args: unknown[]) => Span>>

  beforeEach(() => {
    mockSpan = new MockSpan()
    mockStartSpan = vi.fn<(name: string, ...args: unknown[]) => Span>().mockReturnValue(mockSpan)

    vi.mocked(trace.getTracer).mockReturnValue({
      startSpan: mockStartSpan,
      startActiveSpan: vi.fn(),
    })
  })

  /** Get the [spanName, options] from the first startSpan call. */
  function getStartSpanCall(): [string, { attributes: Record<string, SpanAttributeValue | undefined> }] {
    const call = mockStartSpan.mock.calls[0] as [string, { attributes: Record<string, SpanAttributeValue | undefined> }]
    return call
  }

  /** Extract a string attribute from a mock span event's attributes. */
  function eventAttr(event: { attributes: SpanAttributes | TimeInput | undefined }, key: string): string {
    const attrs = event.attributes as Record<string, string>
    return attrs[key]!
  }

  describe('constructor', () => {
    it('reads service name from OTEL_SERVICE_NAME env var', () => {
      vi.stubEnv('OTEL_SERVICE_NAME', 'my-custom-service')

      new Tracer()

      expect(trace.getTracer).toHaveBeenCalledWith('my-custom-service')
    })

    it('defaults service name to strands-agents', () => {
      vi.stubEnv('OTEL_SERVICE_NAME', '')

      new Tracer()

      expect(trace.getTracer).toHaveBeenCalledWith('strands-agents')
    })
  })

  describe('startAgentSpan', () => {
    it('creates span with correct name and standard attributes', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      tracer.startAgentSpan({
        messages: [userMessage('Hello')],
        agentName: 'test-agent',
        modelId: 'model-123',
      })

      const [spanName, options] = getStartSpanCall()
      expect(spanName).toBe('invoke_agent test-agent')
      expect(options.attributes).toMatchObject({
        'gen_ai.operation.name': 'invoke_agent',
        'gen_ai.system': expect.any(String),
        'gen_ai.agent.name': 'test-agent',
        'gen_ai.request.model': 'model-123',
        name: 'invoke_agent test-agent',
      })
    })

    it('includes agent id when provided', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      tracer.startAgentSpan({
        messages: [userMessage('Hello')],
        agentName: 'test-agent',
        agentId: 'agent-42',
      })

      const [, options] = getStartSpanCall()
      expect(options.attributes['gen_ai.agent.id']).toBe('agent-42')
    })

    it('serializes tool names into gen_ai.agent.tools', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      tracer.startAgentSpan({
        messages: [userMessage('Hello')],
        agentName: 'test-agent',
        tools: [{ name: 'calculator' }, { name: 'search' }],
      })

      const [, options] = getStartSpanCall()
      expect(options.attributes['gen_ai.agent.tools']).toBe('["calculator","search"]')
    })

    it('includes tool definitions when gen_ai_tool_definitions opt-in is set', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', 'gen_ai_tool_definitions')
      const tracer = new Tracer()
      const toolsConfig = { calc: { name: 'calc', description: 'Calculator' } }

      tracer.startAgentSpan({
        messages: [userMessage('Hello')],
        agentName: 'test-agent',
        toolsConfig,
      })

      const [, options] = getStartSpanCall()
      expect(options.attributes['gen_ai.tool.definitions']).toBe(JSON.stringify(toolsConfig))
    })

    it('serializes system prompt into attribute', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      tracer.startAgentSpan({
        messages: [userMessage('Hello')],
        agentName: 'test-agent',
        systemPrompt: 'You are a helpful assistant',
      })

      const [, options] = getStartSpanCall()
      expect(options.attributes['system_prompt']).toBe('"You are a helpful assistant"')
    })

    it('merges constructor-level and call-level trace attributes', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer({ 'global.attr': 'global-val' })

      tracer.startAgentSpan({
        messages: [userMessage('Hello')],
        agentName: 'test-agent',
        traceAttributes: { 'custom.session': 'sess-1' },
      })

      const [, options] = getStartSpanCall()
      expect(options.attributes['global.attr']).toBe('global-val')
      expect(options.attributes['custom.session']).toBe('sess-1')
    })

    it('adds separate stable message events per message', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      tracer.startAgentSpan({
        messages: [userMessage('Hello'), assistantMessage('Hi')],
        agentName: 'test-agent',
      })

      const userEvents = mockSpan.getEvents('gen_ai.user.message')
      const assistantEvents = mockSpan.getEvents('gen_ai.assistant.message')
      expect(userEvents).toHaveLength(1)
      expect(assistantEvents).toHaveLength(1)
    })

    it('classifies tool result messages as gen_ai.tool.message', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      const toolResultMsg = new Message({
        role: 'user',
        content: [new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [new TextBlock('done')] })],
      })

      tracer.startAgentSpan({ messages: [toolResultMsg], agentName: 'test-agent' })

      expect(mockSpan.getEvents('gen_ai.tool.message')).toHaveLength(1)
    })

    it('adds single operation details event with latest conventions', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', 'gen_ai_latest_experimental')
      const tracer = new Tracer()

      tracer.startAgentSpan({
        messages: [userMessage('Hello'), assistantMessage('Hi')],
        agentName: 'test-agent',
      })

      const detailEvents = mockSpan.getEvents('gen_ai.client.inference.operation.details')
      expect(detailEvents).toHaveLength(1)

      const inputMessages = JSON.parse(eventAttr(detailEvents[0]!, 'gen_ai.input.messages'))
      expect(inputMessages).toStrictEqual([
        { role: 'user', parts: [{ type: 'text', content: 'Hello' }] },
        { role: 'assistant', parts: [{ type: 'text', content: 'Hi' }] },
      ])
    })

    it('uses gen_ai.provider.name with latest conventions', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', 'gen_ai_latest_experimental')
      const tracer = new Tracer()

      tracer.startAgentSpan({ messages: [userMessage('Hello')], agentName: 'test-agent' })

      const [, options] = getStartSpanCall()
      expect(options.attributes['gen_ai.provider.name']).toBeDefined()
      expect(options.attributes['gen_ai.system']).toBeUndefined()
    })

    it('uses gen_ai.system with stable conventions', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      tracer.startAgentSpan({ messages: [userMessage('Hello')], agentName: 'test-agent' })

      const [, options] = getStartSpanCall()
      expect(options.attributes['gen_ai.system']).toBeDefined()
      expect(options.attributes['gen_ai.provider.name']).toBeUndefined()
    })
  })

  describe('endAgentSpan', () => {
    it('sets OK status and ends span on success', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()
      const span = tracer.startAgentSpan({ messages: [userMessage('Hi')], agentName: 'agent' })

      tracer.endAgentSpan(span)

      expect(mockSpan.calls.setStatus).toContainEqual({ status: { code: SpanStatusCode.OK } })
      expect(mockSpan.calls.end).toHaveLength(1)
    })

    it('sets ERROR status and records exception on error', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()
      const span = tracer.startAgentSpan({ messages: [userMessage('Hi')], agentName: 'agent' })
      const error = new Error('agent failed')

      tracer.endAgentSpan(span, { error })

      expect(mockSpan.calls.setStatus).toContainEqual({
        status: { code: SpanStatusCode.ERROR, message: 'agent failed' },
      })
      expect(mockSpan.calls.recordException).toContainEqual({ exception: error, time: undefined })
    })

    it('sets accumulated usage attributes', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()
      const span = tracer.startAgentSpan({ messages: [userMessage('Hi')], agentName: 'agent' })

      tracer.endAgentSpan(span, {
        accumulatedUsage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
      })

      expect(mockSpan.getAttributeValue('gen_ai.usage.input_tokens')).toBe(100)
      expect(mockSpan.getAttributeValue('gen_ai.usage.output_tokens')).toBe(200)
      expect(mockSpan.getAttributeValue('gen_ai.usage.total_tokens')).toBe(300)
      expect(mockSpan.getAttributeValue('gen_ai.usage.prompt_tokens')).toBe(100)
      expect(mockSpan.getAttributeValue('gen_ai.usage.completion_tokens')).toBe(200)
    })

    it('adds response event with stable conventions', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()
      const span = tracer.startAgentSpan({ messages: [userMessage('Hi')], agentName: 'agent' })

      const response = new Message({ role: 'assistant', content: [new TextBlock('Hello back')] })
      tracer.endAgentSpan(span, { response, stopReason: 'end_turn' })

      const choiceEvents = mockSpan.getEvents('gen_ai.choice')
      expect(choiceEvents).toHaveLength(1)
      expect(eventAttr(choiceEvents[0]!, 'message')).toBe('Hello back')
      expect(eventAttr(choiceEvents[0]!, 'finish_reason')).toBe('end_turn')
    })

    it('adds response event with latest conventions', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', 'gen_ai_latest_experimental')
      const tracer = new Tracer()
      const span = tracer.startAgentSpan({ messages: [userMessage('Hi')], agentName: 'agent' })

      const response = new Message({ role: 'assistant', content: [new TextBlock('Hello back')] })
      tracer.endAgentSpan(span, { response, stopReason: 'end_turn' })

      const detailEvents = mockSpan.getEvents('gen_ai.client.inference.operation.details')
      const outputEvent = detailEvents.find((e) => eventAttr(e, 'gen_ai.output.messages'))
      expect(outputEvent).toBeDefined()
      const parsed = JSON.parse(eventAttr(outputEvent!, 'gen_ai.output.messages'))
      expect(parsed).toStrictEqual([
        { role: 'assistant', parts: [{ type: 'text', content: 'Hello back' }], finish_reason: 'end_turn' },
      ])
    })

    it('handles null span gracefully', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      expect(() => tracer.endAgentSpan(null)).not.toThrow()
      expect(mockSpan.calls.end).toHaveLength(0)
    })
  })

  describe('startModelInvokeSpan', () => {
    it('creates span with chat operation name and model id', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      tracer.startModelInvokeSpan({ messages: [userMessage('Hello')], modelId: 'claude-3' })

      const [spanName, options] = getStartSpanCall()
      expect(spanName).toBe('chat')
      expect(options.attributes).toMatchObject({
        'gen_ai.operation.name': 'chat',
        'gen_ai.request.model': 'claude-3',
      })
    })

    it('adds message events to span', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      tracer.startModelInvokeSpan({ messages: [userMessage('Hello')] })

      expect(mockSpan.getEvents('gen_ai.user.message')).toHaveLength(1)
    })
  })

  describe('endModelInvokeSpan', () => {
    it('sets usage and metrics attributes', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()
      const span = tracer.startModelInvokeSpan({ messages: [userMessage('Hi')], modelId: 'model-1' })

      tracer.endModelInvokeSpan(span, {
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        metrics: { latencyMs: 500 },
      })

      expect(mockSpan.getAttributeValue('gen_ai.usage.input_tokens')).toBe(10)
      expect(mockSpan.getAttributeValue('gen_ai.usage.output_tokens')).toBe(20)
      expect(mockSpan.getAttributeValue('gen_ai.usage.total_tokens')).toBe(30)
      expect(mockSpan.getAttributeValue('gen_ai.server.request.duration')).toBe(500)
    })

    it('sets cache token attributes when provided', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()
      const span = tracer.startModelInvokeSpan({ messages: [userMessage('Hi')] })

      tracer.endModelInvokeSpan(span, {
        usage: {
          inputTokens: 100,
          outputTokens: 200,
          totalTokens: 300,
          cacheReadInputTokens: 50,
          cacheWriteInputTokens: 25,
        },
      })

      expect(mockSpan.getAttributeValue('gen_ai.usage.cache_read_input_tokens')).toBe(50)
      expect(mockSpan.getAttributeValue('gen_ai.usage.cache_write_input_tokens')).toBe(25)
    })

    it('skips cache token attributes when zero', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()
      const span = tracer.startModelInvokeSpan({ messages: [userMessage('Hi')] })

      tracer.endModelInvokeSpan(span, {
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, cacheReadInputTokens: 0 },
      })

      expect(mockSpan.getAttributeValue('gen_ai.usage.cache_read_input_tokens')).toBeUndefined()
    })

    it('skips latency attribute when zero', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()
      const span = tracer.startModelInvokeSpan({ messages: [userMessage('Hi')] })

      tracer.endModelInvokeSpan(span, {
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        metrics: { latencyMs: 0 },
      })

      expect(mockSpan.getAttributeValue('gen_ai.server.request.duration')).toBeUndefined()
    })

    it('adds output event with stable conventions for mixed content', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()
      const span = tracer.startModelInvokeSpan({ messages: [userMessage('Hi')] })

      const output = new Message({
        role: 'assistant',
        content: [
          new TextBlock('The answer is 42'),
          new ToolUseBlock({ name: 'calc', toolUseId: 'tool-1', input: { expr: '6*7' } }),
        ],
      })

      tracer.endModelInvokeSpan(span, { output, stopReason: 'tool_use' })

      const choiceEvents = mockSpan.getEvents('gen_ai.choice')
      expect(choiceEvents).toHaveLength(1)
      expect(eventAttr(choiceEvents[0]!, 'finish_reason')).toBe('tool_use')

      const parsed = JSON.parse(eventAttr(choiceEvents[0]!, 'message'))
      expect(parsed).toStrictEqual([
        { text: 'The answer is 42' },
        { type: 'toolUse', name: 'calc', toolUseId: 'tool-1', input: { expr: '6*7' } },
      ])
    })

    it('adds output event with latest conventions for mixed content', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', 'gen_ai_latest_experimental')
      const tracer = new Tracer()
      const span = tracer.startModelInvokeSpan({ messages: [userMessage('Hi')] })

      const output = new Message({
        role: 'assistant',
        content: [
          new TextBlock('The answer'),
          new ToolUseBlock({ name: 'calc', toolUseId: 'tool-1', input: { x: 1 } }),
        ],
      })

      tracer.endModelInvokeSpan(span, { output, stopReason: 'tool_use' })

      const detailEvents = mockSpan.getEvents('gen_ai.client.inference.operation.details')
      const outputEvent = detailEvents.find((e) => eventAttr(e, 'gen_ai.output.messages'))
      expect(outputEvent).toBeDefined()
      const parsed = JSON.parse(eventAttr(outputEvent!, 'gen_ai.output.messages'))
      expect(parsed).toStrictEqual([
        {
          role: 'assistant',
          parts: [
            { type: 'text', content: 'The answer' },
            { type: 'tool_call', name: 'calc', id: 'tool-1', arguments: { x: 1 } },
          ],
          finish_reason: 'tool_use',
        },
      ])
    })

    it('records error on model invocation failure', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()
      const span = tracer.startModelInvokeSpan({ messages: [userMessage('Hi')] })
      const error = new Error('model timeout')

      tracer.endModelInvokeSpan(span, { error })

      expect(mockSpan.calls.setStatus).toContainEqual({
        status: { code: SpanStatusCode.ERROR, message: 'model timeout' },
      })
      expect(mockSpan.calls.recordException).toContainEqual({ exception: error, time: undefined })
    })

    it('handles null span gracefully', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      expect(() => tracer.endModelInvokeSpan(null)).not.toThrow()
    })
  })

  describe('startToolCallSpan', () => {
    it('creates span with tool name and call id', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      tracer.startToolCallSpan({
        tool: { name: 'calculator', toolUseId: 'call-1', input: { expr: '2+2' } },
      })

      const [spanName, options] = getStartSpanCall()
      expect(spanName).toBe('execute_tool calculator')
      expect(options.attributes).toMatchObject({
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': 'calculator',
        'gen_ai.tool.call.id': 'call-1',
      })
    })

    it('adds stable tool message event with serialized input', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      tracer.startToolCallSpan({
        tool: { name: 'search', toolUseId: 'call-2', input: { query: 'test' } },
      })

      const toolEvents = mockSpan.getEvents('gen_ai.tool.message')
      expect(toolEvents).toHaveLength(1)
      expect(eventAttr(toolEvents[0]!, 'role')).toBe('tool')
      expect(eventAttr(toolEvents[0]!, 'content')).toBe('{"query":"test"}')
      expect(eventAttr(toolEvents[0]!, 'id')).toBe('call-2')
    })

    it('adds latest convention tool input event', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', 'gen_ai_latest_experimental')
      const tracer = new Tracer()

      tracer.startToolCallSpan({
        tool: { name: 'search', toolUseId: 'call-2', input: { query: 'test' } },
      })

      const detailEvents = mockSpan.getEvents('gen_ai.client.inference.operation.details')
      expect(detailEvents).toHaveLength(1)
      const parsed = JSON.parse(eventAttr(detailEvents[0]!, 'gen_ai.input.messages'))
      expect(parsed).toStrictEqual([
        {
          role: 'tool',
          parts: [{ type: 'tool_call', name: 'search', id: 'call-2', arguments: { query: 'test' } }],
        },
      ])
    })
  })

  describe('endToolCallSpan', () => {
    it('sets tool status attribute and adds stable result event', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()
      const span = tracer.startToolCallSpan({
        tool: { name: 'calc', toolUseId: 'call-1', input: {} },
      })

      const toolResult = new ToolResultBlock({
        toolUseId: 'call-1',
        status: 'success',
        content: [new TextBlock('42')],
      })

      tracer.endToolCallSpan(span, { toolResult })

      expect(mockSpan.getAttributeValue('gen_ai.tool.status')).toBe('success')

      const choiceEvents = mockSpan.getEvents('gen_ai.choice')
      expect(choiceEvents).toHaveLength(1)
      expect(eventAttr(choiceEvents[0]!, 'id')).toBe('call-1')
    })

    it('adds latest convention tool result event', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', 'gen_ai_latest_experimental')
      const tracer = new Tracer()
      const span = tracer.startToolCallSpan({
        tool: { name: 'calc', toolUseId: 'call-1', input: {} },
      })

      const toolResult = new ToolResultBlock({
        toolUseId: 'call-1',
        status: 'success',
        content: [new TextBlock('42')],
      })

      tracer.endToolCallSpan(span, { toolResult })

      const detailEvents = mockSpan.getEvents('gen_ai.client.inference.operation.details')
      const outputEvent = detailEvents.find((e) => eventAttr(e, 'gen_ai.output.messages'))
      expect(outputEvent).toBeDefined()
      const parsed = JSON.parse(eventAttr(outputEvent!, 'gen_ai.output.messages'))
      expect(parsed[0].role).toBe('tool')
      expect(parsed[0].parts[0].type).toBe('tool_call_response')
      expect(parsed[0].parts[0].id).toBe('call-1')
    })

    it('records error on tool failure', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()
      const span = tracer.startToolCallSpan({
        tool: { name: 'calc', toolUseId: 'call-1', input: {} },
      })
      const error = new Error('tool crashed')

      tracer.endToolCallSpan(span, { error })

      expect(mockSpan.calls.setStatus).toContainEqual({
        status: { code: SpanStatusCode.ERROR, message: 'tool crashed' },
      })
      expect(mockSpan.calls.recordException).toContainEqual({ exception: error, time: undefined })
    })

    it('handles null span gracefully', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      expect(() => tracer.endToolCallSpan(null)).not.toThrow()
    })
  })

  describe('startAgentLoopSpan', () => {
    it('creates span with cycle id attribute', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      tracer.startAgentLoopSpan({ cycleId: 'cycle-42', messages: [userMessage('Hi')] })

      const [spanName, options] = getStartSpanCall()
      expect(spanName).toBe('execute_agent_loop_cycle')
      expect(options.attributes['agent_loop.cycle_id']).toBe('cycle-42')
    })

    it('adds message events to loop span', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      tracer.startAgentLoopSpan({ cycleId: 'cycle-1', messages: [userMessage('Hello')] })

      expect(mockSpan.getEvents('gen_ai.user.message')).toHaveLength(1)
    })
  })

  describe('endAgentLoopSpan', () => {
    it('ends span with OK status', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()
      const span = tracer.startAgentLoopSpan({ cycleId: 'cycle-1', messages: [userMessage('Hi')] })

      tracer.endAgentLoopSpan(span)

      expect(mockSpan.calls.setStatus).toContainEqual({ status: { code: SpanStatusCode.OK } })
      expect(mockSpan.calls.end).toHaveLength(1)
    })

    it('records error on loop failure', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()
      const span = tracer.startAgentLoopSpan({ cycleId: 'cycle-1', messages: [userMessage('Hi')] })
      const error = new Error('loop failed')

      tracer.endAgentLoopSpan(span, { error })

      expect(mockSpan.calls.setStatus).toContainEqual({
        status: { code: SpanStatusCode.ERROR, message: 'loop failed' },
      })
      expect(mockSpan.calls.recordException).toContainEqual({ exception: error, time: undefined })
    })

    it('handles null span gracefully', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      expect(() => tracer.endAgentLoopSpan(null)).not.toThrow()
    })
  })

  describe('message event formatting', () => {
    it('maps tool use blocks to tool_call parts in latest conventions', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', 'gen_ai_latest_experimental')
      const tracer = new Tracer()

      const messages = [
        new Message({
          role: 'assistant',
          content: [new ToolUseBlock({ name: 'search', toolUseId: 'tu-1', input: { q: 'test' } })],
        }),
      ]

      tracer.startAgentSpan({ messages, agentName: 'agent' })

      const detailEvents = mockSpan.getEvents('gen_ai.client.inference.operation.details')
      const parsed = JSON.parse(eventAttr(detailEvents[0]!, 'gen_ai.input.messages'))
      expect(parsed[0].parts[0]).toStrictEqual({
        type: 'tool_call',
        name: 'search',
        id: 'tu-1',
        arguments: { q: 'test' },
      })
    })

    it('maps tool result blocks to tool_call_response parts in latest conventions', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', 'gen_ai_latest_experimental')
      const tracer = new Tracer()

      const messages = [
        new Message({
          role: 'user',
          content: [new ToolResultBlock({ toolUseId: 'tu-1', status: 'success', content: [new TextBlock('result')] })],
        }),
      ]

      tracer.startAgentSpan({ messages, agentName: 'agent' })

      const detailEvents = mockSpan.getEvents('gen_ai.client.inference.operation.details')
      const parsed = JSON.parse(eventAttr(detailEvents[0]!, 'gen_ai.input.messages'))
      expect(parsed[0].parts[0].type).toBe('tool_call_response')
      expect(parsed[0].parts[0].id).toBe('tu-1')
    })

    it('serializes text block content in stable convention events', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      tracer.startModelInvokeSpan({ messages: [userMessage('Hello world')] })

      const userEvents = mockSpan.getEvents('gen_ai.user.message')
      const parsed = JSON.parse(eventAttr(userEvents[0]!, 'content'))
      expect(parsed[0].type).toBe('textBlock')
      expect(parsed[0].text).toBe('Hello world')
    })
  })

  describe('error resilience', () => {
    it('returns null when startAgentSpan throws internally', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      mockStartSpan.mockImplementation(() => {
        throw new Error('otel failure')
      })
      const tracer = new Tracer()

      expect(tracer.startAgentSpan({ messages: [userMessage('Hi')], agentName: 'agent' })).toBeNull()
    })

    it('returns null when startModelInvokeSpan throws internally', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      mockStartSpan.mockImplementation(() => {
        throw new Error('otel failure')
      })
      const tracer = new Tracer()

      expect(tracer.startModelInvokeSpan({ messages: [userMessage('Hi')] })).toBeNull()
    })

    it('returns null when startToolCallSpan throws internally', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      mockStartSpan.mockImplementation(() => {
        throw new Error('otel failure')
      })
      const tracer = new Tracer()

      expect(tracer.startToolCallSpan({ tool: { name: 'x', toolUseId: 'y', input: {} } })).toBeNull()
    })

    it('returns null when startAgentLoopSpan throws internally', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      mockStartSpan.mockImplementation(() => {
        throw new Error('otel failure')
      })
      const tracer = new Tracer()

      expect(tracer.startAgentLoopSpan({ cycleId: 'c', messages: [userMessage('Hi')] })).toBeNull()
    })

    it('does not throw when ending null spans with errors', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      expect(() => {
        tracer.endAgentSpan(null, { error: new Error('test') })
        tracer.endModelInvokeSpan(null, { error: new Error('test') })
        tracer.endToolCallSpan(null, { error: new Error('test') })
        tracer.endAgentLoopSpan(null, { error: new Error('test') })
      }).not.toThrow()
    })
  })

  describe('semantic convention opt-in parsing', () => {
    it('parses multiple comma-separated opt-in values', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', 'gen_ai_latest_experimental,gen_ai_tool_definitions')
      const tracer = new Tracer()
      const toolsConfig = { calc: { name: 'calc', description: 'Calculator' } }

      tracer.startAgentSpan({ messages: [userMessage('Hi')], agentName: 'agent', toolsConfig })

      const [, options] = getStartSpanCall()
      expect(options.attributes['gen_ai.provider.name']).toBeDefined()
      expect(options.attributes['gen_ai.tool.definitions']).toBe(JSON.stringify(toolsConfig))
    })

    it('handles whitespace in opt-in values', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', ' gen_ai_latest_experimental , gen_ai_tool_definitions ')
      const tracer = new Tracer()

      tracer.startAgentSpan({ messages: [userMessage('Hi')], agentName: 'agent' })

      const [, options] = getStartSpanCall()
      expect(options.attributes['gen_ai.provider.name']).toBeDefined()
    })

    it('defaults to stable conventions when env var is empty', () => {
      vi.stubEnv('OTEL_SEMCONV_STABILITY_OPT_IN', '')
      const tracer = new Tracer()

      tracer.startAgentSpan({ messages: [userMessage('Hi')], agentName: 'agent' })

      const [, options] = getStartSpanCall()
      expect(options.attributes['gen_ai.system']).toBeDefined()
      expect(options.attributes['gen_ai.provider.name']).toBeUndefined()
    })
  })
})
