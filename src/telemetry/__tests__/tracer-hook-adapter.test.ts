/**
 * Tests for TracerHookAdapter.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TracerHookAdapter } from '../tracer-hook-adapter.js'
import { HookRegistryImplementation } from '../../hooks/registry.js'
import {
  BeforeInvocationEvent,
  AfterInvocationEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  AfterToolsEvent,
} from '../../hooks/events.js'
import { Message, TextBlock, ToolUseBlock, ToolResultBlock } from '../../types/messages.js'
import type { AgentData } from '../../types/agent.js'
import type { Model, BaseModelConfig } from '../../models/model.js'
import type { AgentState } from '../../agent/state.js'
import type {
  ITracer,
  TracerSpanHandle,
  StartAgentSpanParams,
  EndAgentSpanParams,
  StartModelSpanParams,
  EndModelSpanParams,
  StartToolSpanParams,
  EndToolSpanParams,
  StartCycleSpanParams,
  EndCycleSpanParams,
} from '../tracer-interface.js'

// Mock agent for testing
function createMockAgent(overrides: Partial<AgentData> = {}): AgentData {
  const mockModel = {
    getConfig: () => ({ modelId: 'test-model-id' }),
    constructor: { name: 'MockModel' },
  } as unknown as Model<BaseModelConfig>

  const mockState = {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    has: vi.fn(),
    clear: vi.fn(),
    keys: vi.fn(),
    values: vi.fn(),
    entries: vi.fn(),
  } as unknown as AgentState

  return {
    name: 'test-agent',
    agentId: 'agent-123',
    model: mockModel,
    tools: [],
    messages: [],
    state: mockState,
    systemPrompt: 'You are a helpful assistant.',
    ...overrides,
  }
}

// Mock tracer that records all calls
class MockTracer implements ITracer {
  calls: { method: string; params: unknown }[] = []
  spans: Map<string, TracerSpanHandle> = new Map()
  spanCounter = 0

  startAgentSpan(params: StartAgentSpanParams): TracerSpanHandle {
    this.calls.push({ method: 'startAgentSpan', params })
    const span = { id: `agent-span-${++this.spanCounter}`, type: 'agent' }
    this.spans.set('agent', span)
    return span
  }

  endAgentSpan(span: TracerSpanHandle, params: EndAgentSpanParams): void {
    this.calls.push({ method: 'endAgentSpan', params: { span, ...params } })
    this.spans.delete('agent')
  }

  startModelSpan(params: StartModelSpanParams): TracerSpanHandle {
    this.calls.push({ method: 'startModelSpan', params })
    const span = { id: `model-span-${++this.spanCounter}`, type: 'model' }
    this.spans.set('model', span)
    return span
  }

  endModelSpan(span: TracerSpanHandle, params: EndModelSpanParams): void {
    this.calls.push({ method: 'endModelSpan', params: { span, ...params } })
    this.spans.delete('model')
  }

  startToolSpan(params: StartToolSpanParams): TracerSpanHandle {
    this.calls.push({ method: 'startToolSpan', params })
    const span = { id: `tool-span-${++this.spanCounter}`, type: 'tool', toolUseId: params.toolUseId }
    this.spans.set(`tool-${params.toolUseId}`, span)
    return span
  }

  endToolSpan(span: TracerSpanHandle, params: EndToolSpanParams): void {
    this.calls.push({ method: 'endToolSpan', params: { span, ...params } })
    const spanObj = span as { toolUseId?: string }
    if (spanObj.toolUseId) {
      this.spans.delete(`tool-${spanObj.toolUseId}`)
    }
  }

  startCycleSpan(params: StartCycleSpanParams): TracerSpanHandle {
    this.calls.push({ method: 'startCycleSpan', params })
    const span = { id: `cycle-span-${++this.spanCounter}`, type: 'cycle', cycleId: params.cycleId }
    this.spans.set('cycle', span)
    return span
  }

  endCycleSpan(span: TracerSpanHandle, params: EndCycleSpanParams): void {
    this.calls.push({ method: 'endCycleSpan', params: { span, ...params } })
    this.spans.delete('cycle')
  }

  reset(): void {
    this.calls = []
    this.spans.clear()
    this.spanCounter = 0
  }
}

describe('TracerHookAdapter', () => {
  let mockTracer: MockTracer
  let adapter: TracerHookAdapter
  let registry: HookRegistryImplementation

  beforeEach(() => {
    mockTracer = new MockTracer()
    adapter = new TracerHookAdapter(mockTracer)
    registry = new HookRegistryImplementation()
    adapter.registerCallbacks(registry)
  })

  describe('initialization', () => {
    it('should create adapter with tracer', () => {
      expect(adapter).toBeDefined()
      expect(adapter.enableCycleSpans).toBe(true)
    })

    it('should allow disabling cycle spans', () => {
      const adapterNoCycles = new TracerHookAdapter(mockTracer, { enableCycleSpans: false })
      expect(adapterNoCycles.enableCycleSpans).toBe(false)
    })
  })

  describe('agent span lifecycle', () => {
    it('should start agent span on BeforeInvocationEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      expect(mockTracer.calls).toHaveLength(1)
      expect(mockTracer.calls[0]?.method).toBe('startAgentSpan')
      expect(mockTracer.calls[0]?.params).toMatchObject({
        agentName: 'test-agent',
        agentId: 'agent-123',
        modelId: 'test-model-id',
      })
    })

    it('should end agent span on AfterInvocationEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Start agent span
      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      // End agent span
      const response = new Message({ role: 'assistant', content: [new TextBlock('Hi!')] })
      await registry.invokeCallbacks(new AfterInvocationEvent({
        agent,
        result: { message: response, stopReason: 'endTurn' },
      }))

      expect(mockTracer.calls).toHaveLength(2)
      expect(mockTracer.calls[1]?.method).toBe('endAgentSpan')
      expect(mockTracer.calls[1]?.params).toMatchObject({
        response,
        stopReason: 'endTurn',
      })
    })

    it('should pass error to endAgentSpan on failure', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      const error = new Error('Invocation failed')
      await registry.invokeCallbacks(new AfterInvocationEvent({ agent, error }))

      expect(mockTracer.calls[1]?.params).toMatchObject({ error })
    })
  })

  describe('model span lifecycle', () => {
    it('should start model span on BeforeModelCallEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      // Should have: startAgentSpan, startCycleSpan, startModelSpan
      expect(mockTracer.calls).toHaveLength(3)
      expect(mockTracer.calls[2]?.method).toBe('startModelSpan')
      expect(mockTracer.calls[2]?.params).toMatchObject({
        modelId: 'test-model-id',
      })
    })

    it('should end model span on AfterModelCallEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      const response = new Message({ role: 'assistant', content: [new TextBlock('Hi!')] })
      await registry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        stopData: { message: response, stopReason: 'endTurn' },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }))

      // Should have: startAgentSpan, startCycleSpan, startModelSpan, endModelSpan, endCycleSpan
      expect(mockTracer.calls).toHaveLength(5)
      expect(mockTracer.calls[3]?.method).toBe('endModelSpan')
      expect(mockTracer.calls[3]?.params).toMatchObject({
        response,
        stopReason: 'endTurn',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      })
    })
  })

  describe('cycle span lifecycle', () => {
    it('should start cycle span before first model call', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      expect(mockTracer.calls[1]?.method).toBe('startCycleSpan')
      expect(mockTracer.calls[1]?.params).toMatchObject({
        cycleId: 'cycle-1',
      })
    })

    it('should end cycle span on final model response', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      const response = new Message({ role: 'assistant', content: [new TextBlock('Hi!')] })
      await registry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        stopData: { message: response, stopReason: 'endTurn' },
      }))

      expect(mockTracer.calls[4]?.method).toBe('endCycleSpan')
      expect(mockTracer.calls[4]?.params).toMatchObject({
        response,
      })
    })

    it('should not end cycle span when stopReason is toolUse', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      const response = new Message({
        role: 'assistant',
        content: [new ToolUseBlock({ name: 'test_tool', toolUseId: 'tool-1', input: {} })],
      })
      await registry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        stopData: { message: response, stopReason: 'toolUse' },
      }))

      // Should have: startAgentSpan, startCycleSpan, startModelSpan, endModelSpan
      // No endCycleSpan because stopReason is toolUse
      expect(mockTracer.calls).toHaveLength(4)
      expect(mockTracer.calls.every(c => c.method !== 'endCycleSpan')).toBe(true)
    })

    it('should end cycle span on AfterToolsEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))
      await registry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        stopData: {
          message: new Message({
            role: 'assistant',
            content: [new ToolUseBlock({ name: 'test_tool', toolUseId: 'tool-1', input: {} })],
          }),
          stopReason: 'toolUse',
        },
      }))

      const toolResultMessage = new Message({
        role: 'user',
        content: [new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [] })],
      })
      await registry.invokeCallbacks(new AfterToolsEvent({ agent, message: toolResultMessage }))

      const endCycleCall = mockTracer.calls.find(c => c.method === 'endCycleSpan')
      expect(endCycleCall).toBeDefined()
      expect(endCycleCall?.params).toMatchObject({
        toolResultMessage,
      })
    })
  })

  describe('tool span lifecycle', () => {
    it('should start tool span on BeforeToolCallEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))
      await registry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        stopData: {
          message: new Message({
            role: 'assistant',
            content: [new ToolUseBlock({ name: 'test_tool', toolUseId: 'tool-1', input: { key: 'value' } })],
          }),
          stopReason: 'toolUse',
        },
      }))

      const toolUse = { name: 'test_tool', toolUseId: 'tool-1', input: { key: 'value' } }
      await registry.invokeCallbacks(new BeforeToolCallEvent({ agent, toolUse, tool: undefined }))

      const startToolCall = mockTracer.calls.find(c => c.method === 'startToolSpan')
      expect(startToolCall).toBeDefined()
      expect(startToolCall?.params).toMatchObject({
        toolName: 'test_tool',
        toolUseId: 'tool-1',
        input: { key: 'value' },
      })
    })

    it('should end tool span on AfterToolCallEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))
      await registry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        stopData: {
          message: new Message({
            role: 'assistant',
            content: [new ToolUseBlock({ name: 'test_tool', toolUseId: 'tool-1', input: {} })],
          }),
          stopReason: 'toolUse',
        },
      }))

      const toolUse = { name: 'test_tool', toolUseId: 'tool-1', input: {} }
      await registry.invokeCallbacks(new BeforeToolCallEvent({ agent, toolUse, tool: undefined }))

      const result = new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [] })
      await registry.invokeCallbacks(new AfterToolCallEvent({ agent, toolUse, tool: undefined, result }))

      const endToolCall = mockTracer.calls.find(c => c.method === 'endToolSpan')
      expect(endToolCall).toBeDefined()
      expect(endToolCall?.params).toMatchObject({
        result,
      })
    })

    it('should pass error to endToolSpan on failure', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))
      await registry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        stopData: {
          message: new Message({
            role: 'assistant',
            content: [new ToolUseBlock({ name: 'test_tool', toolUseId: 'tool-1', input: {} })],
          }),
          stopReason: 'toolUse',
        },
      }))

      const toolUse = { name: 'test_tool', toolUseId: 'tool-1', input: {} }
      await registry.invokeCallbacks(new BeforeToolCallEvent({ agent, toolUse, tool: undefined }))

      const result = new ToolResultBlock({ toolUseId: 'tool-1', status: 'error', content: [] })
      const error = new Error('Tool failed')
      await registry.invokeCallbacks(new AfterToolCallEvent({ agent, toolUse, tool: undefined, result, error }))

      const endToolCall = mockTracer.calls.find(c => c.method === 'endToolSpan')
      expect(endToolCall?.params).toMatchObject({ error })
    })
  })

  describe('without cycle spans', () => {
    beforeEach(() => {
      mockTracer.reset()
      adapter = new TracerHookAdapter(mockTracer, { enableCycleSpans: false })
      registry = new HookRegistryImplementation()
      adapter.registerCallbacks(registry)
    })

    it('should not create cycle spans', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      // Should have: startAgentSpan, startModelSpan (no cycle span)
      expect(mockTracer.calls).toHaveLength(2)
      expect(mockTracer.calls[0]?.method).toBe('startAgentSpan')
      expect(mockTracer.calls[1]?.method).toBe('startModelSpan')
    })

    it('should create model span as direct child of agent span', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      const startModelCall = mockTracer.calls.find(c => c.method === 'startModelSpan')
      expect(startModelCall?.params).toMatchObject({
        parentSpan: { id: 'agent-span-1', type: 'agent' },
      })
    })
  })

  describe('usage accumulation', () => {
    it('should accumulate token usage across model calls', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      // First model call
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))
      await registry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        stopData: {
          message: new Message({
            role: 'assistant',
            content: [new ToolUseBlock({ name: 'test_tool', toolUseId: 'tool-1', input: {} })],
          }),
          stopReason: 'toolUse',
        },
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      }))

      // End cycle
      await registry.invokeCallbacks(new AfterToolsEvent({
        agent,
        message: new Message({ role: 'user', content: [] }),
      }))

      // Second model call
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))
      await registry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        stopData: {
          message: new Message({ role: 'assistant', content: [new TextBlock('Done!')] }),
          stopReason: 'endTurn',
        },
        usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
      }))

      // Check accumulated usage
      const usage = adapter.accumulatedUsage
      expect(usage.inputTokens).toBe(300)
      expect(usage.outputTokens).toBe(150)
      expect(usage.totalTokens).toBe(450)
    })
  })

  describe('partial ITracer implementation', () => {
    it('should work with tracer that only implements some methods', async () => {
      // Tracer that only implements agent span methods
      const partialTracer: ITracer = {
        startAgentSpan: vi.fn().mockReturnValue({ id: 'agent-1' }),
        endAgentSpan: vi.fn(),
        // No model, tool, or cycle span methods
      }

      const partialAdapter = new TracerHookAdapter(partialTracer)
      const partialRegistry = new HookRegistryImplementation()
      partialAdapter.registerCallbacks(partialRegistry)

      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Should not throw even though model/tool/cycle methods are not implemented
      await partialRegistry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await partialRegistry.invokeCallbacks(new BeforeModelCallEvent({ agent }))
      await partialRegistry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        stopData: {
          message: new Message({ role: 'assistant', content: [new TextBlock('Hi!')] }),
          stopReason: 'endTurn',
        },
      }))
      await partialRegistry.invokeCallbacks(new AfterInvocationEvent({
        agent,
        result: {
          message: new Message({ role: 'assistant', content: [new TextBlock('Hi!')] }),
          stopReason: 'endTurn',
        },
      }))

      expect(partialTracer.startAgentSpan).toHaveBeenCalledTimes(1)
      expect(partialTracer.endAgentSpan).toHaveBeenCalledTimes(1)
    })
  })
})
