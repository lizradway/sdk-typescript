/**
 * Tests for MeterHookAdapter.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MeterHookAdapter } from '../meter-hook-adapter.js'
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
  IMeter,
  RecordModelCallParams,
  RecordToolExecutionParams,
  RecordAgentInvocationParams,
  RecordCycleParams,
} from '../meter-interface.js'

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

// Mock meter that records all calls
class MockMeter implements IMeter {
  calls: { method: string; params: unknown }[] = []

  recordModelCall(params: RecordModelCallParams): void {
    this.calls.push({ method: 'recordModelCall', params })
  }

  recordToolExecution(params: RecordToolExecutionParams): void {
    this.calls.push({ method: 'recordToolExecution', params })
  }

  recordAgentInvocation(params: RecordAgentInvocationParams): void {
    this.calls.push({ method: 'recordAgentInvocation', params })
  }

  recordCycle(params: RecordCycleParams): void {
    this.calls.push({ method: 'recordCycle', params })
  }

  reset(): void {
    this.calls = []
  }
}

describe('MeterHookAdapter', () => {
  let mockMeter: MockMeter
  let adapter: MeterHookAdapter
  let registry: HookRegistryImplementation

  beforeEach(() => {
    mockMeter = new MockMeter()
    adapter = new MeterHookAdapter(mockMeter)
    registry = new HookRegistryImplementation()
    adapter.registerCallbacks(registry)
  })

  describe('initialization', () => {
    it('should create adapter with meter', () => {
      expect(adapter).toBeDefined()
      expect(adapter.enableCycleMetrics).toBe(true)
    })

    it('should allow disabling cycle metrics', () => {
      const adapterNoCycles = new MeterHookAdapter(mockMeter, { enableCycleMetrics: false })
      expect(adapterNoCycles.enableCycleMetrics).toBe(false)
    })
  })

  describe('agent invocation metrics', () => {
    it('should record agent invocation on AfterInvocationEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      // Simulate some time passing
      await new Promise((resolve) => globalThis.setTimeout(resolve, 10))

      const response = new Message({ role: 'assistant', content: [new TextBlock('Hi!')] })
      await registry.invokeCallbacks(new AfterInvocationEvent({
        agent,
        result: { message: response, stopReason: 'endTurn' },
        accumulatedUsage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          cacheReadInputTokens: 0,
          cacheWriteInputTokens: 0,
        },
      }))

      const invocationCall = mockMeter.calls.find((c) => c.method === 'recordAgentInvocation')
      expect(invocationCall).toBeDefined()
      const params = invocationCall?.params as RecordAgentInvocationParams
      expect(params.agentName).toBe('test-agent')
      expect(params.agentId).toBe('agent-123')
      expect(params.modelId).toBe('test-model-id')
      expect(params.success).toBe(true)
      expect(params.usage.totalTokens).toBe(150)
      expect(params.durationSeconds).toBeGreaterThan(0)
    })

    it('should record error on failed invocation', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      const error = new Error('Invocation failed')
      await registry.invokeCallbacks(new AfterInvocationEvent({ agent, error }))

      const invocationCall = mockMeter.calls.find((c) => c.method === 'recordAgentInvocation')
      expect(invocationCall).toBeDefined()
      const params = invocationCall?.params as RecordAgentInvocationParams
      expect(params.success).toBe(false)
      expect(params.error).toBe('Invocation failed')
    })
  })

  describe('model call metrics', () => {
    it('should record model call on AfterModelCallEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      const response = new Message({ role: 'assistant', content: [new TextBlock('Hi!')] })
      await registry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        stopData: { message: response, stopReason: 'endTurn' },
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        metrics: { latencyMs: 500, timeToFirstByteMs: 100 },
      }))

      const modelCall = mockMeter.calls.find((c) => c.method === 'recordModelCall')
      expect(modelCall).toBeDefined()
      const params = modelCall?.params as RecordModelCallParams
      expect(params.modelId).toBe('test-model-id')
      expect(params.usage.totalTokens).toBe(150)
      expect(params.latencyMs).toBe(500)
      expect(params.timeToFirstTokenMs).toBe(100)
      expect(params.success).toBe(true)
    })

    it('should record error on failed model call', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      const error = new Error('Model call failed')
      await registry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        error,
        usage: { inputTokens: 100, outputTokens: 0, totalTokens: 100 },
      }))

      const modelCall = mockMeter.calls.find((c) => c.method === 'recordModelCall')
      expect(modelCall).toBeDefined()
      const params = modelCall?.params as RecordModelCallParams
      expect(params.success).toBe(false)
      expect(params.error).toBe('Model call failed')
    })
  })

  describe('tool execution metrics', () => {
    it('should record tool execution on AfterToolCallEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      const toolUse = { name: 'test_tool', toolUseId: 'tool-1', input: { key: 'value' } }
      await registry.invokeCallbacks(new BeforeToolCallEvent({ agent, toolUse, tool: undefined }))

      // Simulate some time passing
      await new Promise((resolve) => globalThis.setTimeout(resolve, 10))

      const result = new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [] })
      await registry.invokeCallbacks(new AfterToolCallEvent({ agent, toolUse, tool: undefined, result }))

      const toolCall = mockMeter.calls.find((c) => c.method === 'recordToolExecution')
      expect(toolCall).toBeDefined()
      const params = toolCall?.params as RecordToolExecutionParams
      expect(params.toolName).toBe('test_tool')
      expect(params.toolUseId).toBe('tool-1')
      expect(params.success).toBe(true)
      expect(params.durationSeconds).toBeGreaterThan(0)
    })

    it('should record error on failed tool execution', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      const toolUse = { name: 'test_tool', toolUseId: 'tool-1', input: {} }
      await registry.invokeCallbacks(new BeforeToolCallEvent({ agent, toolUse, tool: undefined }))

      const result = new ToolResultBlock({ toolUseId: 'tool-1', status: 'error', content: [] })
      const error = new Error('Tool failed')
      await registry.invokeCallbacks(new AfterToolCallEvent({ agent, toolUse, tool: undefined, result, error }))

      const toolCall = mockMeter.calls.find((c) => c.method === 'recordToolExecution')
      expect(toolCall).toBeDefined()
      const params = toolCall?.params as RecordToolExecutionParams
      expect(params.success).toBe(false)
      expect(params.error).toBe('Tool failed')
    })
  })

  describe('cycle metrics', () => {
    it('should record cycle on final model response', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      // Simulate some time passing for duration calculation
      await new Promise((resolve) => globalThis.setTimeout(resolve, 10))

      const response = new Message({ role: 'assistant', content: [new TextBlock('Hi!')] })
      await registry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        stopData: { message: response, stopReason: 'endTurn' },
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      }))

      const cycleCall = mockMeter.calls.find((c) => c.method === 'recordCycle')
      expect(cycleCall).toBeDefined()
      const params = cycleCall?.params as RecordCycleParams
      expect(params.cycleId).toBe('cycle-1')
      expect(params.durationSeconds).toBeGreaterThan(0)
      expect(params.usage?.totalTokens).toBe(150)
    })

    it('should record cycle on AfterToolsEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      // Model returns tool use
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

      // No cycle recorded yet (stopReason is toolUse)
      expect(mockMeter.calls.filter((c) => c.method === 'recordCycle')).toHaveLength(0)

      // Tools complete
      const toolResultMessage = new Message({
        role: 'user',
        content: [new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [] })],
      })
      await registry.invokeCallbacks(new AfterToolsEvent({ agent, message: toolResultMessage }))

      // Now cycle should be recorded
      const cycleCall = mockMeter.calls.find((c) => c.method === 'recordCycle')
      expect(cycleCall).toBeDefined()
      const params = cycleCall?.params as RecordCycleParams
      expect(params.cycleId).toBe('cycle-1')
    })

    it('should not record cycle metrics when disabled', async () => {
      mockMeter.reset()
      adapter = new MeterHookAdapter(mockMeter, { enableCycleMetrics: false })
      registry = new HookRegistryImplementation()
      adapter.registerCallbacks(registry)

      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      const response = new Message({ role: 'assistant', content: [new TextBlock('Hi!')] })
      await registry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        stopData: { message: response, stopReason: 'endTurn' },
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      }))

      // No cycle metrics recorded
      expect(mockMeter.calls.filter((c) => c.method === 'recordCycle')).toHaveLength(0)
    })
  })

  describe('usage accumulation', () => {
    it('should accumulate usage across model calls', async () => {
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

  describe('partial IMeter implementation', () => {
    it('should work with meter that only implements some methods', async () => {
      // Meter that only implements agent invocation
      const partialMeter: IMeter = {
        recordAgentInvocation: vi.fn(),
        // No model, tool, or cycle methods
      }

      const partialAdapter = new MeterHookAdapter(partialMeter)
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
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      }))
      await partialRegistry.invokeCallbacks(new AfterInvocationEvent({
        agent,
        result: {
          message: new Message({ role: 'assistant', content: [new TextBlock('Hi!')] }),
          stopReason: 'endTurn',
        },
      }))

      expect(partialMeter.recordAgentInvocation).toHaveBeenCalledTimes(1)
    })
  })

  describe('multiple cycles', () => {
    it('should track cycle count correctly', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      // Cycle 1: model call -> tool use -> tools complete
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
      await registry.invokeCallbacks(new AfterToolsEvent({
        agent,
        message: new Message({ role: 'user', content: [] }),
      }))

      // Cycle 2: model call -> final response
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))
      await registry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        stopData: {
          message: new Message({ role: 'assistant', content: [new TextBlock('Done!')] }),
          stopReason: 'endTurn',
        },
        usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 },
      }))

      // End invocation
      await registry.invokeCallbacks(new AfterInvocationEvent({
        agent,
        result: {
          message: new Message({ role: 'assistant', content: [new TextBlock('Done!')] }),
          stopReason: 'endTurn',
        },
      }))

      // Should have 2 cycle records
      const cycleCalls = mockMeter.calls.filter((c) => c.method === 'recordCycle')
      expect(cycleCalls).toHaveLength(2)
      expect((cycleCalls[0]?.params as RecordCycleParams).cycleId).toBe('cycle-1')
      expect((cycleCalls[1]?.params as RecordCycleParams).cycleId).toBe('cycle-2')

      // Agent invocation should have cycleCount = 2
      const invocationCall = mockMeter.calls.find((c) => c.method === 'recordAgentInvocation')
      expect((invocationCall?.params as RecordAgentInvocationParams).cycleCount).toBe(2)
    })
  })
})
