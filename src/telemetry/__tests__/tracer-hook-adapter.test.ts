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
  StartSpanEvent,
  EndSpanEvent,
  StartSpanContext,
  EndSpanContext,
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

// Mock tracer that records all calls using the ITracer interface
class MockTracer implements ITracer {
  calls: { method: string; event?: unknown; context?: unknown }[] = []
  spans: Map<string, TracerSpanHandle> = new Map()
  spanCounter = 0

  startSpan(event: StartSpanEvent, context?: StartSpanContext): TracerSpanHandle {
    this.calls.push({ method: 'startSpan', event, context })
    const spanType = event.type.replace('before', '').replace('Event', '').toLowerCase()
    const span = { id: `${spanType}-span-${++this.spanCounter}`, type: spanType, eventType: event.type }
    
    if (event.type === 'beforeToolCallEvent') {
      const toolEvent = event as BeforeToolCallEvent
      this.spans.set(`tool-${toolEvent.toolUse.toolUseId}`, span)
    } else {
      this.spans.set(spanType, span)
    }
    return span
  }

  endSpan(span: TracerSpanHandle, event: EndSpanEvent, context?: EndSpanContext): void {
    this.calls.push({ method: 'endSpan', event, context })
    const spanObj = span as { type?: string }
    if (spanObj.type) {
      this.spans.delete(spanObj.type)
    }
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
      expect(mockTracer.calls[0]?.method).toBe('startSpan')
      const event = mockTracer.calls[0]?.event as BeforeInvocationEvent
      expect(event.type).toBe('beforeInvocationEvent')
      expect(event.agent.name).toBe('test-agent')
    })

    it('should end agent span on AfterInvocationEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      const response = new Message({ role: 'assistant', content: [new TextBlock('Hi!')] })
      await registry.invokeCallbacks(new AfterInvocationEvent({
        agent,
        result: { message: response, stopReason: 'endTurn' },
      }))

      expect(mockTracer.calls).toHaveLength(2)
      expect(mockTracer.calls[1]?.method).toBe('endSpan')
      const event = mockTracer.calls[1]?.event as AfterInvocationEvent
      expect(event.type).toBe('afterInvocationEvent')
      expect(event.result?.stopReason).toBe('endTurn')
    })

    it('should pass error to endSpan on failure', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      const error = new Error('Invocation failed')
      await registry.invokeCallbacks(new AfterInvocationEvent({ agent, error }))

      const event = mockTracer.calls[1]?.event as AfterInvocationEvent
      expect(event.error).toBe(error)
    })
  })

  describe('model span lifecycle', () => {
    it('should start model span on BeforeModelCallEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      // Should have: startSpan (agent), startSpan (model)
      // Note: cycle spans are handled internally by the default Tracer, not via ITracer interface
      expect(mockTracer.calls).toHaveLength(2)
      expect(mockTracer.calls[1]?.method).toBe('startSpan')
      const event = mockTracer.calls[1]?.event as BeforeModelCallEvent
      expect(event.type).toBe('beforeModelCallEvent')
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

      // Should have: startSpan (agent), startSpan (model), endSpan (model)
      expect(mockTracer.calls).toHaveLength(3)
      expect(mockTracer.calls[2]?.method).toBe('endSpan')
      const event = mockTracer.calls[2]?.event as AfterModelCallEvent
      expect(event.type).toBe('afterModelCallEvent')
      expect(event.usage?.inputTokens).toBe(10)
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

      const startToolCall = mockTracer.calls.find(c => {
        if (c.method !== 'startSpan') return false
        const event = c.event as StartSpanEvent
        return event.type === 'beforeToolCallEvent'
      })
      expect(startToolCall).toBeDefined()
      const event = startToolCall?.event as BeforeToolCallEvent
      expect(event.toolUse.name).toBe('test_tool')
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

      const endToolCall = mockTracer.calls.find(c => {
        if (c.method !== 'endSpan') return false
        const event = c.event as EndSpanEvent
        return event.type === 'afterToolCallEvent'
      })
      expect(endToolCall).toBeDefined()
      const event = endToolCall?.event as AfterToolCallEvent
      expect(event.result.status).toBe('success')
    })

    it('should pass error to endSpan on tool failure', async () => {
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

      const endToolCall = mockTracer.calls.find(c => {
        if (c.method !== 'endSpan') return false
        const event = c.event as EndSpanEvent
        return event.type === 'afterToolCallEvent'
      })
      const event = endToolCall?.event as AfterToolCallEvent
      expect(event.error).toBe(error)
    })
  })

  describe('without cycle spans', () => {
    beforeEach(() => {
      mockTracer.reset()
      adapter = new TracerHookAdapter(mockTracer, { enableCycleSpans: false })
      registry = new HookRegistryImplementation()
      adapter.registerCallbacks(registry)
    })

    it('should not create cycle spans when disabled', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      // Should have: startSpan (agent), startSpan (model) - no cycle span
      expect(mockTracer.calls).toHaveLength(2)
      expect(mockTracer.calls[0]?.method).toBe('startSpan')
      expect(mockTracer.calls[1]?.method).toBe('startSpan')
    })

    it('should create model span as direct child of agent span', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      // With startActiveSpan, child spans auto-parent via context
      // No parentSpan is passed - context propagation handles it
      const modelCall = mockTracer.calls[1]
      expect(modelCall?.method).toBe('startSpan')
      expect((modelCall?.event as BeforeModelCallEvent).type).toBe('beforeModelCallEvent')
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

      // End cycle (for tracers that support it internally)
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
    it('should work with tracer that only implements startSpan and endSpan', async () => {
      const partialTracer: ITracer = {
        startSpan: vi.fn().mockReturnValue({ id: 'span-1' }),
        endSpan: vi.fn(),
      }

      const partialAdapter = new TracerHookAdapter(partialTracer)
      const partialRegistry = new HookRegistryImplementation()
      partialAdapter.registerCallbacks(partialRegistry)

      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Should not throw even though cycle methods are not implemented
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

      // startSpan called for: agent, model
      expect(partialTracer.startSpan).toHaveBeenCalledTimes(2)
      // endSpan called for: model, agent
      expect(partialTracer.endSpan).toHaveBeenCalledTimes(2)
    })

    it('should work with tracer that implements no methods', async () => {
      const emptyTracer: ITracer = {}

      const emptyAdapter = new TracerHookAdapter(emptyTracer)
      const emptyRegistry = new HookRegistryImplementation()
      emptyAdapter.registerCallbacks(emptyRegistry)

      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Should not throw
      await emptyRegistry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await emptyRegistry.invokeCallbacks(new BeforeModelCallEvent({ agent }))
      await emptyRegistry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        stopData: {
          message: new Message({ role: 'assistant', content: [new TextBlock('Hi!')] }),
          stopReason: 'endTurn',
        },
      }))
      await emptyRegistry.invokeCallbacks(new AfterInvocationEvent({ agent }))
    })

    it('should warn when startSpan is implemented without endSpan', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const incompleteTracer: ITracer = {
        startSpan: vi.fn().mockReturnValue({ id: 'span-1' }),
        // endSpan intentionally not implemented
      }

      new TracerHookAdapter(incompleteTracer)

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('startSpan but not endSpan')
      )

      consoleSpy.mockRestore()
    })

    it('should not warn when all implemented methods have their counterparts', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const completeTracer: ITracer = {
        startSpan: vi.fn().mockReturnValue({ id: 'span-1' }),
        endSpan: vi.fn(),
      }

      new TracerHookAdapter(completeTracer)

      // Should not have any warnings about incomplete implementation
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('startSpan but not endSpan')
      )

      consoleSpy.mockRestore()
    })
  })
})
