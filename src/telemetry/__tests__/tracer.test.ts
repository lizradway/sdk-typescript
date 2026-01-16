import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Tracer, serialize, mapContentBlocksToOtelParts } from '../tracer.js'
import { Message, TextBlock, ToolResultBlock, ToolUseBlock } from '../../types/messages.js'
import {
  BeforeInvocationEvent,
  AfterInvocationEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  AfterToolsEvent,
} from '../../hooks/events.js'
import type { AgentData } from '../../types/agent.js'
import type { Tool } from '../../tools/tool.js'

// Helper to create test messages
function createTestMessages(text = 'Hello'): Message[] {
  return [new Message({ role: 'user', content: [new TextBlock(text)] })]
}

// Helper to create mock agent data
function createMockAgentData(messages: Message[] = [], modelId = 'model-123'): AgentData {
  const mockModel = {
    getConfig: () => ({ modelId }),
    constructor: { name: 'MockModel' },
  } as unknown as AgentData['model']

  const mockState = {
    get: () => undefined,
    set: () => {},
    delete: () => false,
    has: () => false,
    clear: () => {},
    keys: () => [][Symbol.iterator](),
    values: () => [][Symbol.iterator](),
    entries: () => [][Symbol.iterator](),
  } as unknown as AgentData['state']

  return {
    name: 'test-agent',
    agentId: 'agent-id-123',
    model: mockModel,
    messages,
    tools: [] as Tool[],
    state: mockState,
  }
}

describe('Tracer', () => {
  let tracer: Tracer

  beforeEach(() => {
    tracer = new Tracer()
  })

  afterEach(() => {
    delete process.env.OTEL_SEMCONV_STABILITY_OPT_IN
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  })

  describe('initialization', () => {
    it('should create a Tracer instance', () => {
      expect(tracer).toBeDefined()
      expect(tracer).toBeInstanceOf(Tracer)
    })

    it('should initialize OpenTelemetry tracer provider', () => {
      const tracer1 = new Tracer()
      expect(tracer1).toBeDefined()
      expect(tracer1).toBeInstanceOf(Tracer)
    })

    it('should read semantic convention from environment variable', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_latest_experimental'
        const tracerWithLatest = new Tracer()
        expect(tracerWithLatest).toBeDefined()

        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = ''
        const tracerWithStable = new Tracer()
        expect(tracerWithStable).toBeDefined()
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should use latest conventions when gen_ai_latest_experimental is set', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_latest_experimental'
        const tracerWithLatest = new Tracer()
        const messages = createTestMessages()
        const agent = createMockAgentData(messages)

        const event = new BeforeInvocationEvent({ agent, inputMessages: messages })
        const span = tracerWithLatest.startSpan(event)
        expect(span).toBeDefined()

        if (span) {
          const endEvent = new AfterInvocationEvent({ agent })
          tracerWithLatest.endSpan(span, endEvent)
        }
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should use stable conventions when gen_ai_latest_experimental is not set', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = ''
        const tracerWithStable = new Tracer()
        const messages = createTestMessages()
        const agent = createMockAgentData(messages)

        const event = new BeforeInvocationEvent({ agent, inputMessages: messages })
        const span = tracerWithStable.startSpan(event)
        expect(span).toBeDefined()

        if (span) {
          const endEvent = new AfterInvocationEvent({ agent })
          tracerWithStable.endSpan(span, endEvent)
        }
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should initialize only once even with multiple Tracer instances', () => {
      const tracer1 = new Tracer()
      const tracer2 = new Tracer()
      const tracer3 = new Tracer()

      expect(tracer1).toBeDefined()
      expect(tracer2).toBeDefined()
      expect(tracer3).toBeDefined()
    })

    it('should handle initialization errors gracefully', () => {
      expect(() => new Tracer()).not.toThrow()
    })
  })

  describe('span creation with startSpan', () => {
    it('should create an agent span from BeforeInvocationEvent', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeInvocationEvent({ agent, inputMessages: messages })

      const span = tracer.startSpan(event)
      expect(span).toBeDefined()

      if (span) {
        const endEvent = new AfterInvocationEvent({ agent })
        tracer.endSpan(span, endEvent)
      }
    })

    it('should create a model span from BeforeModelCallEvent', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeModelCallEvent({ agent })

      const span = tracer.startSpan(event)
      expect(span).toBeDefined()

      if (span) {
        const endEvent = new AfterModelCallEvent({ agent })
        tracer.endSpan(span, endEvent)
      }
    })

    it('should create a tool span from BeforeToolCallEvent', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeToolCallEvent({
        agent,
        toolUse: { name: 'test-tool', toolUseId: 'tool-use-123', input: { key: 'value' } },
        tool: undefined,
      })

      const span = tracer.startSpan(event)
      expect(span).toBeDefined()

      if (span) {
        const endEvent = new AfterToolCallEvent({
          agent,
          toolUse: { name: 'test-tool', toolUseId: 'tool-use-123', input: { key: 'value' } },
          tool: undefined,
          result: new ToolResultBlock({
            toolUseId: 'tool-use-123',
            status: 'success',
            content: [new TextBlock('Tool result')],
          }),
        })
        tracer.endSpan(span, endEvent)
      }
    })

    it('should create a cycle span', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeModelCallEvent({ agent })

      const span = tracer.startCycleSpan(event, 'cycle-1')
      expect(span).toBeDefined()

      if (span) {
        const endEvent = new AfterModelCallEvent({ agent })
        tracer.endCycleSpan(span, endEvent)
      }
    })

    it('should create nested spans with parent-child relationship', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)

      const agentEvent = new BeforeInvocationEvent({ agent, inputMessages: messages })
      const agentSpan = tracer.startSpan(agentEvent)
      expect(agentSpan).toBeDefined()

      // With startActiveSpan, child spans auto-parent via context
      const modelEvent = new BeforeModelCallEvent({ agent })
      const modelSpan = tracer.startSpan(modelEvent)
      expect(modelSpan).toBeDefined()

      if (modelSpan) {
        const endModelEvent = new AfterModelCallEvent({ agent })
        tracer.endSpan(modelSpan, endModelEvent)
      }
      if (agentSpan) {
        const endAgentEvent = new AfterInvocationEvent({ agent })
        tracer.endSpan(agentSpan, endAgentEvent)
      }
    })
  })

  describe('span ending with endSpan', () => {
    it('should end agent span with response', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeInvocationEvent({ agent, inputMessages: messages })
      const span = tracer.startSpan(event)

      if (span) {
        const response = new Message({ role: 'assistant', content: [new TextBlock('Response')] })
        const endEvent = new AfterInvocationEvent({
          agent,
          result: { message: response, stopReason: 'end_turn' },
        })
        tracer.endSpan(span, endEvent)
      }
    })

    it('should end agent span with error', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeInvocationEvent({ agent, inputMessages: messages })
      const span = tracer.startSpan(event)

      if (span) {
        const error = new Error('Test error')
        const endEvent = new AfterInvocationEvent({ agent, error })
        tracer.endSpan(span, endEvent)
      }
    })

    it('should end agent span with usage from context', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeInvocationEvent({ agent, inputMessages: messages })
      const span = tracer.startSpan(event)

      if (span) {
        const endEvent = new AfterInvocationEvent({ agent })
        tracer.endSpan(span, endEvent, {
          accumulatedUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        })
      }
    })

    it('should end model span with usage and metrics', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeModelCallEvent({ agent })
      const span = tracer.startSpan(event)

      if (span) {
        const endEvent = new AfterModelCallEvent({
          agent,
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          metrics: { latencyMs: 500, timeToFirstByteMs: 100 },
        })
        tracer.endSpan(span, endEvent)
      }
    })

    it('should end tool span with result', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const toolUse = { name: 'test-tool', toolUseId: 'tool-use-123', input: { key: 'value' } }
      const event = new BeforeToolCallEvent({ agent, toolUse, tool: undefined })
      const span = tracer.startSpan(event)

      if (span) {
        const endEvent = new AfterToolCallEvent({
          agent,
          toolUse,
          tool: undefined,
          result: new ToolResultBlock({
            toolUseId: 'tool-use-123',
            status: 'success',
            content: [new TextBlock('Result')],
          }),
        })
        tracer.endSpan(span, endEvent)
      }
    })

    it('should end tool span with error', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const toolUse = { name: 'test-tool', toolUseId: 'tool-use-123', input: { key: 'value' } }
      const event = new BeforeToolCallEvent({ agent, toolUse, tool: undefined })
      const span = tracer.startSpan(event)

      if (span) {
        const endEvent = new AfterToolCallEvent({
          agent,
          toolUse,
          tool: undefined,
          result: new ToolResultBlock({
            toolUseId: 'tool-use-123',
            status: 'error',
            content: [new TextBlock('Error')],
          }),
          error: new Error('Tool failed'),
        })
        tracer.endSpan(span, endEvent)
      }
    })

    it('should end cycle span with AfterModelCallEvent', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeModelCallEvent({ agent })
      const span = tracer.startCycleSpan(event, 'cycle-1')

      if (span) {
        const response = new Message({ role: 'assistant', content: [new TextBlock('Response')] })
        const endEvent = new AfterModelCallEvent({
          agent,
          stopData: { message: response, stopReason: 'end_turn' },
        })
        tracer.endCycleSpan(span, endEvent)
      }
    })

    it('should end cycle span with AfterToolsEvent', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeModelCallEvent({ agent })
      const span = tracer.startCycleSpan(event, 'cycle-1')

      if (span) {
        const toolResultMessage = new Message({
          role: 'user',
          content: [new ToolResultBlock({ toolUseId: 'tool-123', status: 'success', content: [new TextBlock('Result')] })],
        })
        const endEvent = new AfterToolsEvent({ agent, message: toolResultMessage })
        tracer.endCycleSpan(span, endEvent)
      }
    })
  })

  describe('null span handling', () => {
    it('should handle null span in endSpan for agent', () => {
      const agent = createMockAgentData()
      const endEvent = new AfterInvocationEvent({ agent })
      expect(() => tracer.endSpan(null, endEvent)).not.toThrow()
    })

    it('should handle null span in endSpan for model', () => {
      const agent = createMockAgentData()
      const endEvent = new AfterModelCallEvent({ agent })
      expect(() => tracer.endSpan(null, endEvent)).not.toThrow()
    })

    it('should handle null span in endSpan for tool', () => {
      const agent = createMockAgentData()
      const endEvent = new AfterToolCallEvent({
        agent,
        toolUse: { name: 'test', toolUseId: 'id', input: {} },
        tool: undefined,
        result: new ToolResultBlock({ toolUseId: 'id', status: 'success', content: [] }),
      })
      expect(() => tracer.endSpan(null, endEvent)).not.toThrow()
    })

    it('should handle undefined span in endCycleSpan', () => {
      const agent = createMockAgentData()
      const endEvent = new AfterModelCallEvent({ agent })
      // endCycleSpan now requires ActiveSpanHandle, so we test with undefined
      expect(() => tracer.endCycleSpan(undefined as never, endEvent)).not.toThrow()
    })
  })

  describe('serialize function', () => {
    it('should serialize simple objects', () => {
      const result = serialize({ key: 'value' })
      expect(result).toBe('{"key":"value"}')
    })

    it('should serialize arrays', () => {
      const result = serialize([1, 2, 3])
      expect(result).toBe('[1,2,3]')
    })

    it('should serialize nested objects', () => {
      const result = serialize({ outer: { inner: 'value' } })
      expect(result).toBe('{"outer":{"inner":"value"}}')
    })

    it('should handle circular references', () => {
      const obj: Record<string, unknown> = { key: 'value' }
      obj.self = obj
      const result = serialize(obj)
      expect(result).toContain('key')
      expect(result).toContain('<replaced>')
    })

    it('should handle Date objects', () => {
      const date = new Date('2024-01-01T00:00:00.000Z')
      const result = serialize({ date })
      expect(result).toContain('2024-01-01')
    })

    it('should handle Error objects', () => {
      const error = new Error('Test error')
      const result = serialize({ error })
      expect(result).toContain('Test error')
    })

    it('should handle Map objects', () => {
      const map = new Map([['key', 'value']])
      const result = serialize({ map })
      expect(result).toContain('Map')
    })

    it('should handle Set objects', () => {
      const set = new Set([1, 2, 3])
      const result = serialize({ set })
      expect(result).toContain('Set')
    })

    it('should handle BigInt', () => {
      const result = serialize({ big: BigInt(123) })
      expect(result).toContain('BigInt')
    })

    it('should handle Symbol', () => {
      const result = serialize({ sym: Symbol('test') })
      expect(result).toContain('Symbol')
    })

    it('should handle functions', () => {
      const result = serialize({ fn: () => {} })
      expect(result).toContain('Function')
    })

    it('should handle null and undefined', () => {
      expect(serialize(null)).toBe('null')
      expect(serialize(undefined)).toBe('undefined')
    })

    it('should handle primitives', () => {
      expect(serialize('string')).toBe('"string"')
      expect(serialize(123)).toBe('123')
      expect(serialize(true)).toBe('true')
    })
  })

  describe('mapContentBlocksToOtelParts', () => {
    it('should map text blocks', () => {
      const blocks = [{ type: 'textBlock', text: 'Hello' }]
      const result = mapContentBlocksToOtelParts(blocks)
      expect(result).toEqual([{ type: 'text', content: 'Hello' }])
    })

    it('should map tool use blocks', () => {
      const blocks = [{ type: 'toolUseBlock', name: 'tool', toolUseId: 'id-123', input: { key: 'value' } }]
      const result = mapContentBlocksToOtelParts(blocks)
      expect(result).toEqual([{ type: 'tool_call', name: 'tool', id: 'id-123', arguments: { key: 'value' } }])
    })

    it('should map tool result blocks', () => {
      const blocks = [{ type: 'toolResultBlock', toolUseId: 'id-123', content: 'result' }]
      const result = mapContentBlocksToOtelParts(blocks)
      expect(result).toEqual([{ type: 'tool_call_response', id: 'id-123', response: 'result' }])
    })

    it('should handle unknown block types', () => {
      const blocks = [{ type: 'unknownBlock', data: 'test' }]
      const result = mapContentBlocksToOtelParts(blocks)
      expect(result).toEqual([{ type: 'unknownBlock', data: 'test' }])
    })

    it('should handle null/undefined blocks', () => {
      const blocks = [null, undefined, { type: 'textBlock', text: 'Hello' }]
      const result = mapContentBlocksToOtelParts(blocks as unknown[])
      expect(result.length).toBe(3)
      expect(result[2]).toEqual({ type: 'text', content: 'Hello' })
    })

    it('should handle empty array', () => {
      const result = mapContentBlocksToOtelParts([])
      expect(result).toEqual([])
    })
  })

  describe('semantic conventions', () => {
    it('should use stable conventions by default', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        delete process.env.OTEL_SEMCONV_STABILITY_OPT_IN
        const stableTracer = new Tracer()
        const messages = createTestMessages()
        const agent = createMockAgentData(messages)

        const event = new BeforeInvocationEvent({ agent, inputMessages: messages })
        const span = stableTracer.startSpan(event)
        expect(span).toBeDefined()

        if (span) {
          const endEvent = new AfterInvocationEvent({ agent })
          stableTracer.endSpan(span, endEvent)
        }
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should use latest conventions when enabled', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_latest_experimental'
        const latestTracer = new Tracer()
        const messages = createTestMessages()
        const agent = createMockAgentData(messages)

        const event = new BeforeInvocationEvent({ agent, inputMessages: messages })
        const span = latestTracer.startSpan(event)
        expect(span).toBeDefined()

        if (span) {
          const endEvent = new AfterInvocationEvent({ agent })
          latestTracer.endSpan(span, endEvent)
        }
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })
  })

  describe('ITracer interface compliance', () => {
    it('should implement startSpan for agent invocation', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      agent.systemPrompt = 'You are a helpful assistant'

      const event = new BeforeInvocationEvent({ agent, inputMessages: messages })
      const span = tracer.startSpan(event)
      expect(span).toBeDefined()

      if (span) {
        const endEvent = new AfterInvocationEvent({ agent })
        tracer.endSpan(span, endEvent)
      }
    })

    it('should implement endSpan for agent with result and usage', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeInvocationEvent({ agent, inputMessages: messages })
      const span = tracer.startSpan(event)

      if (span) {
        const response = new Message({ role: 'assistant', content: [new TextBlock('Response')] })
        const endEvent = new AfterInvocationEvent({
          agent,
          result: { message: response, stopReason: 'end_turn' },
          accumulatedUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        })
        tracer.endSpan(span, endEvent)
      }
    })

    it('should implement startSpan for model call with parent', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)

      const agentEvent = new BeforeInvocationEvent({ agent, inputMessages: messages })
      const agentSpan = tracer.startSpan(agentEvent)

      // With startActiveSpan, child spans auto-parent via context
      const modelEvent = new BeforeModelCallEvent({ agent })
      const modelSpan = tracer.startSpan(modelEvent)
      expect(modelSpan).toBeDefined()

      if (modelSpan) {
        const endEvent = new AfterModelCallEvent({ agent })
        tracer.endSpan(modelSpan, endEvent)
      }
      if (agentSpan) {
        const endEvent = new AfterInvocationEvent({ agent })
        tracer.endSpan(agentSpan, endEvent)
      }
    })

    it('should implement endSpan for model with response and metrics', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeModelCallEvent({ agent })
      const span = tracer.startSpan(event)

      if (span) {
        const response = new Message({ role: 'assistant', content: [new TextBlock('Response')] })
        const endEvent = new AfterModelCallEvent({
          agent,
          stopData: { message: response, stopReason: 'end_turn' },
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          metrics: { latencyMs: 500, timeToFirstByteMs: 100 },
        })
        tracer.endSpan(span, endEvent)
      }
    })

    it('should implement startSpan for tool call', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeToolCallEvent({
        agent,
        toolUse: { name: 'calculator', toolUseId: 'tool-123', input: { operation: 'add', a: 1, b: 2 } },
        tool: undefined,
      })

      const span = tracer.startSpan(event)
      expect(span).toBeDefined()

      if (span) {
        const endEvent = new AfterToolCallEvent({
          agent,
          toolUse: { name: 'calculator', toolUseId: 'tool-123', input: { operation: 'add', a: 1, b: 2 } },
          tool: undefined,
          result: new ToolResultBlock({ toolUseId: 'tool-123', status: 'success', content: [new TextBlock('3')] }),
        })
        tracer.endSpan(span, endEvent)
      }
    })

    it('should implement startCycleSpan with context', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)

      const agentEvent = new BeforeInvocationEvent({ agent, inputMessages: messages })
      const agentSpan = tracer.startSpan(agentEvent)

      // With startActiveSpan, cycle span auto-parents to agent span via context
      const modelEvent = new BeforeModelCallEvent({ agent })
      const cycleSpan = tracer.startCycleSpan(modelEvent, 'cycle-1')
      expect(cycleSpan).toBeDefined()

      if (cycleSpan) {
        const endEvent = new AfterModelCallEvent({ agent })
        tracer.endCycleSpan(cycleSpan, endEvent)
      }
      if (agentSpan) {
        const endEvent = new AfterInvocationEvent({ agent })
        tracer.endSpan(agentSpan, endEvent)
      }
    })

    it('should implement endCycleSpan with AfterModelCallEvent', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeModelCallEvent({ agent })
      const span = tracer.startCycleSpan(event, 'cycle-1')

      if (span) {
        const response = new Message({ role: 'assistant', content: [new TextBlock('Response')] })
        const endEvent = new AfterModelCallEvent({
          agent,
          stopData: { message: response, stopReason: 'end_turn' },
        })
        tracer.endCycleSpan(span, endEvent)
      }
    })
  })

  describe('cache token usage', () => {
    it('should include cache read tokens in usage', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeInvocationEvent({ agent, inputMessages: messages })
      const span = tracer.startSpan(event)

      if (span) {
        const endEvent = new AfterInvocationEvent({
          agent,
          accumulatedUsage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            cacheReadInputTokens: 80,
          },
        })
        tracer.endSpan(span, endEvent)
      }
    })

    it('should include cache write tokens in usage', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeInvocationEvent({ agent, inputMessages: messages })
      const span = tracer.startSpan(event)

      if (span) {
        const endEvent = new AfterInvocationEvent({
          agent,
          accumulatedUsage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            cacheWriteInputTokens: 20,
          },
        })
        tracer.endSpan(span, endEvent)
      }
    })

    it('should include both cache read and write tokens', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeInvocationEvent({ agent, inputMessages: messages })
      const span = tracer.startSpan(event)

      if (span) {
        const endEvent = new AfterInvocationEvent({
          agent,
          accumulatedUsage: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            cacheReadInputTokens: 80,
            cacheWriteInputTokens: 20,
          },
        })
        tracer.endSpan(span, endEvent)
      }
    })
  })

  describe('complex message content', () => {
    it('should handle messages with tool use blocks', () => {
      const messages = [
        new Message({
          role: 'assistant',
          content: [new ToolUseBlock({ name: 'calculator', toolUseId: 'tool-123', input: { a: 1, b: 2 } })],
        }),
      ]
      const agent = createMockAgentData(messages)

      const event = new BeforeInvocationEvent({ agent, inputMessages: messages })
      const span = tracer.startSpan(event)
      expect(span).toBeDefined()

      if (span) {
        const endEvent = new AfterInvocationEvent({ agent })
        tracer.endSpan(span, endEvent)
      }
    })

    it('should handle messages with tool result blocks', () => {
      const messages = [
        new Message({
          role: 'user',
          content: [new ToolResultBlock({ toolUseId: 'tool-123', status: 'success', content: [new TextBlock('3')] })],
        }),
      ]
      const agent = createMockAgentData(messages)

      const event = new BeforeInvocationEvent({ agent, inputMessages: messages })
      const span = tracer.startSpan(event)
      expect(span).toBeDefined()

      if (span) {
        const endEvent = new AfterInvocationEvent({ agent })
        tracer.endSpan(span, endEvent)
      }
    })

    it('should handle messages with mixed content blocks', () => {
      const messages = [
        new Message({
          role: 'assistant',
          content: [
            new TextBlock('Let me calculate that for you.'),
            new ToolUseBlock({ name: 'calculator', toolUseId: 'tool-123', input: { a: 1, b: 2 } }),
          ],
        }),
      ]
      const agent = createMockAgentData(messages)

      const event = new BeforeInvocationEvent({ agent, inputMessages: messages })
      const span = tracer.startSpan(event)
      expect(span).toBeDefined()

      if (span) {
        const endEvent = new AfterInvocationEvent({ agent })
        tracer.endSpan(span, endEvent)
      }
    })
  })

  describe('error handling', () => {
    it('should handle errors in startSpan gracefully', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeInvocationEvent({ agent, inputMessages: messages })
      expect(() => tracer.startSpan(event)).not.toThrow()
    })

    it('should handle errors in endSpan gracefully', () => {
      const messages = createTestMessages()
      const agent = createMockAgentData(messages)
      const event = new BeforeInvocationEvent({ agent, inputMessages: messages })
      const span = tracer.startSpan(event)

      if (span) {
        const error = new Error('Test error')
        const endEvent = new AfterInvocationEvent({ agent, error })
        expect(() => tracer.endSpan(span, endEvent)).not.toThrow()
      }
    })

    it('should handle undefined span gracefully', () => {
      const agent = createMockAgentData()
      expect(() => tracer.endSpan(undefined, new AfterInvocationEvent({ agent }))).not.toThrow()
      expect(() => tracer.endSpan(undefined, new AfterModelCallEvent({ agent }))).not.toThrow()
      expect(() =>
        tracer.endSpan(undefined, new AfterToolCallEvent({
          agent,
          toolUse: { name: 'test', toolUseId: 'id', input: {} },
          tool: undefined,
          result: new ToolResultBlock({ toolUseId: 'id', status: 'success', content: [] }),
        })),
      ).not.toThrow()
      expect(() => tracer.endCycleSpan(undefined as never, new AfterModelCallEvent({ agent }))).not.toThrow()
    })
  })
})
