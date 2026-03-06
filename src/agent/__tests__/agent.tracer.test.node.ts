import { describe, expect, it, vi, beforeEach, type MockInstance } from 'vitest'
import { Agent } from '../agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { createMockTool } from '../../__fixtures__/tool-helpers.js'
import { TextBlock, ToolResultBlock, MaxTokensError } from '../../index.js'
import { Tracer } from '../../telemetry/tracer.js'
import { StructuredOutputException } from '../../structured-output/exceptions.js'
import { z } from 'zod'

interface MockTracerInstance {
  startAgentSpan: MockInstance
  endAgentSpan: MockInstance
  startAgentLoopSpan: MockInstance
  endAgentLoopSpan: MockInstance
  startModelInvokeSpan: MockInstance
  endModelInvokeSpan: MockInstance
  startToolCallSpan: MockInstance
  endToolCallSpan: MockInstance
  withSpanContext: MockInstance
}

vi.mock('../../telemetry/tracer.js', () => ({
  Tracer: vi.fn(function () {
    return {
      startAgentSpan: vi.fn().mockReturnValue({ mock: 'agentSpan' }),
      endAgentSpan: vi.fn(),
      startAgentLoopSpan: vi.fn().mockReturnValue({ mock: 'loopSpan' }),
      endAgentLoopSpan: vi.fn(),
      startModelInvokeSpan: vi.fn().mockReturnValue({ mock: 'modelSpan' }),
      endModelInvokeSpan: vi.fn(),
      startToolCallSpan: vi.fn().mockReturnValue({ mock: 'toolSpan' }),
      endToolCallSpan: vi.fn(),
      withSpanContext: vi.fn((_span, fn) => fn()),
    }
  }),
}))

function getLatestTracer(): MockTracerInstance {
  return vi.mocked(Tracer).mock.results.at(-1)!.value
}

describe('Agent OTel span integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('initializes Tracer with traceAttributes from config', () => {
      const traceAttributes = { 'custom.attr': 'value' }
      new Agent({ traceAttributes })

      expect(Tracer).toHaveBeenCalledWith(traceAttributes)
    })

    it('initializes Tracer without traceAttributes when not provided', () => {
      new Agent()

      expect(Tracer).toHaveBeenCalledWith(undefined)
    })
  })

  describe('agent span attributes', () => {
    it('passes agent identity to startAgentSpan', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, name: 'TestAgent', agentId: 'test-id' })
      const tracer = getLatestTracer()

      await agent.invoke('Hi')

      expect(tracer.startAgentSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          agentName: 'TestAgent',
          agentId: 'test-id',
          modelId: 'test-model',
        })
      )
    })

    it('includes systemPrompt in agent span', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model, systemPrompt: 'Be helpful' })
      const tracer = getLatestTracer()

      await agent.invoke('Hi')

      expect(tracer.startAgentSpan).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: 'Be helpful' }))
    })

    it('includes tools in agent span', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const tool = createMockTool(
        'myTool',
        () => new ToolResultBlock({ toolUseId: 'id', status: 'success', content: [] })
      )
      const agent = new Agent({ model, tools: [tool] })
      const tracer = getLatestTracer()

      await agent.invoke('Hi')

      expect(tracer.startAgentSpan).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([expect.objectContaining({ name: 'myTool' })]),
        })
      )
    })

    it('passes accumulated usage to endAgentSpan', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })
      const tracer = getLatestTracer()

      await agent.invoke('Hi')

      expect(tracer.endAgentSpan).toHaveBeenCalledWith(
        { mock: 'agentSpan' },
        expect.objectContaining({
          accumulatedUsage: expect.objectContaining({
            inputTokens: expect.any(Number),
            outputTokens: expect.any(Number),
            totalTokens: expect.any(Number),
          }),
        })
      )
    })

    it('passes response and stopReason to endAgentSpan on success', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })
      const tracer = getLatestTracer()

      await agent.invoke('Hi')

      expect(tracer.endAgentSpan).toHaveBeenCalledWith(
        { mock: 'agentSpan' },
        expect.objectContaining({
          response: expect.objectContaining({ role: 'assistant' }),
          stopReason: 'endTurn',
        })
      )
    })
  })

  describe('error propagation to spans', () => {
    it('ends agent span with error on MaxTokensError', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Partial' }, 'maxTokens')
      const agent = new Agent({ model })
      const tracer = getLatestTracer()

      await expect(agent.invoke('Hi')).rejects.toThrow(MaxTokensError)

      expect(tracer.endAgentSpan).toHaveBeenCalledWith(
        { mock: 'agentSpan' },
        expect.objectContaining({ error: expect.any(MaxTokensError) })
      )
    })

    it('ends model span with error when model call fails', async () => {
      const model = new MockMessageModel().addTurn(new Error('Model failed'))
      const agent = new Agent({ model })
      const tracer = getLatestTracer()

      await expect(agent.invoke('Hi')).rejects.toThrow()

      expect(tracer.endModelInvokeSpan).toHaveBeenCalledWith(
        { mock: 'modelSpan' },
        expect.objectContaining({ error: expect.any(Error) })
      )
    })

    it('ends loop span with error on MaxTokensError', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Partial' }, 'maxTokens')
      const agent = new Agent({ model })
      const tracer = getLatestTracer()

      await expect(agent.invoke('Hi')).rejects.toThrow(MaxTokensError)

      expect(tracer.endAgentLoopSpan).toHaveBeenCalledWith(
        { mock: 'loopSpan' },
        expect.objectContaining({ error: expect.any(MaxTokensError) })
      )
    })

    it('ends agent span with StructuredOutputException when model refuses tool', async () => {
      const schema = z.object({ value: z.number() })
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'I refuse' })
      const agent = new Agent({ model, structuredOutputSchema: schema })
      const tracer = getLatestTracer()

      await expect(agent.invoke('Test')).rejects.toThrow(StructuredOutputException)

      expect(tracer.endAgentSpan).toHaveBeenCalledWith(
        { mock: 'agentSpan' },
        expect.objectContaining({ error: expect.any(StructuredOutputException) })
      )
    })
  })

  describe('null span handling', () => {
    it('completes when startAgentSpan returns null', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })
      const tracer = getLatestTracer()
      tracer.startAgentSpan.mockReturnValue(null)

      const result = await agent.invoke('Hi')

      expect(result.stopReason).toBe('endTurn')
      expect(tracer.endAgentSpan).toHaveBeenCalledWith(null, expect.any(Object))
    })

    it('completes when startAgentLoopSpan returns null', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })
      const tracer = getLatestTracer()
      tracer.startAgentLoopSpan.mockReturnValue(null)

      const result = await agent.invoke('Hi')

      expect(result.stopReason).toBe('endTurn')
    })

    it('completes when startModelInvokeSpan returns null', async () => {
      const model = new MockMessageModel().addTurn({ type: 'textBlock', text: 'Hello' })
      const agent = new Agent({ model })
      const tracer = getLatestTracer()
      tracer.startModelInvokeSpan.mockReturnValue(null)

      const result = await agent.invoke('Hi')

      expect(result.stopReason).toBe('endTurn')
    })

    it('completes when startToolCallSpan returns null', async () => {
      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'testTool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const tool = createMockTool(
        'testTool',
        () => new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [new TextBlock('Result')] })
      )

      const agent = new Agent({ model, tools: [tool] })
      const tracer = getLatestTracer()
      tracer.startToolCallSpan.mockReturnValue(null)

      const result = await agent.invoke('Use tool')

      expect(result.stopReason).toBe('endTurn')
      expect(tracer.endToolCallSpan).toHaveBeenCalledWith(null, expect.any(Object))
    })
  })
})
