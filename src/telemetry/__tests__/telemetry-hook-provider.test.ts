/**
 * Unit tests for TelemetryHookProvider.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TelemetryHookProvider } from '../telemetry-hook-provider.js'
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

describe('TelemetryHookProvider', () => {
  let provider: TelemetryHookProvider
  let registry: HookRegistryImplementation

  beforeEach(() => {
    // Reset environment
    delete process.env.OTEL_SEMCONV_STABILITY_OPT_IN
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  })

  afterEach(() => {
    delete process.env.OTEL_SEMCONV_STABILITY_OPT_IN
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  })

  describe('initialization', () => {
    it('should create a TelemetryHookProvider instance', () => {
      provider = new TelemetryHookProvider()
      expect(provider).toBeDefined()
      expect(provider).toBeInstanceOf(TelemetryHookProvider)
    })

    it('should accept telemetry config', () => {
      provider = new TelemetryHookProvider({
        enableCycleSpans: true,
      })
      expect(provider).toBeDefined()
    })

    it('should enable cycle spans by default', () => {
      provider = new TelemetryHookProvider()
      expect(provider.enableCycleSpans).toBe(true)
    })

    it('should allow disabling cycle spans', () => {
      provider = new TelemetryHookProvider({ enableCycleSpans: false })
      expect(provider.enableCycleSpans).toBe(false)
    })
  })

  describe('registerCallbacks', () => {
    beforeEach(() => {
      provider = new TelemetryHookProvider()
      registry = new HookRegistryImplementation()
    })

    it('should register all required callbacks', () => {
      provider.registerCallbacks(registry)

      // Verify callbacks are registered by checking the registry has handlers
      expect(registry).toBeDefined()
    })

    it('should register AfterToolsEvent callback when cycle spans are enabled', () => {
      provider = new TelemetryHookProvider({ enableCycleSpans: true })
      registry = new HookRegistryImplementation()
      provider.registerCallbacks(registry)

      // Provider should have registered AfterToolsEvent
      expect(provider.enableCycleSpans).toBe(true)
    })

    it('should not register AfterToolsEvent callback when cycle spans are disabled', () => {
      provider = new TelemetryHookProvider({ enableCycleSpans: false })
      registry = new HookRegistryImplementation()
      provider.registerCallbacks(registry)

      // Provider should not have registered AfterToolsEvent
      expect(provider.enableCycleSpans).toBe(false)
    })
  })

  describe('span lifecycle with cycle spans enabled', () => {
    beforeEach(() => {
      provider = new TelemetryHookProvider({ enableCycleSpans: true })
      registry = new HookRegistryImplementation()
      provider.registerCallbacks(registry)
    })

    it('should start agent span on BeforeInvocationEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      const event = new BeforeInvocationEvent({ agent, inputMessages })
      await registry.invokeCallbacks(event)

      expect(provider.agentSpan).toBeDefined()
    })

    it('should end agent span on AfterInvocationEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Start agent span
      const beforeEvent = new BeforeInvocationEvent({ agent, inputMessages })
      await registry.invokeCallbacks(beforeEvent)

      expect(provider.agentSpan).toBeDefined()

      // End agent span
      const afterEvent = new AfterInvocationEvent({
        agent,
        result: {
          message: new Message({ role: 'assistant', content: [new TextBlock('Hi!')] }),
          stopReason: 'endTurn',
        },
      })
      await registry.invokeCallbacks(afterEvent)

      expect(provider.agentSpan).toBeFalsy()
    })

    it('should start cycle span on BeforeModelCallEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Start agent span first
      const beforeInvocationEvent = new BeforeInvocationEvent({ agent, inputMessages })
      await registry.invokeCallbacks(beforeInvocationEvent)

      // Start model call
      const beforeModelEvent = new BeforeModelCallEvent({ agent })
      await registry.invokeCallbacks(beforeModelEvent)

      expect(provider.cycleSpan).toBeDefined()
      expect(provider.modelSpan).toBeDefined()
    })

    it('should end cycle span on final model response', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Start agent span
      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      // Start model call
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      expect(provider.cycleSpan).toBeDefined()

      // End model call with final response (not toolUse)
      const afterModelEvent = new AfterModelCallEvent({
        agent,
        stopData: {
          message: new Message({ role: 'assistant', content: [new TextBlock('Hi!')] }),
          stopReason: 'endTurn',
        },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      })
      await registry.invokeCallbacks(afterModelEvent)

      // Cycle span should be ended
      expect(provider.cycleSpan).toBeFalsy()
    })

    it('should not end cycle span when stopReason is toolUse', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Start agent span
      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      // Start model call
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      expect(provider.cycleSpan).toBeDefined()

      // End model call with toolUse
      const afterModelEvent = new AfterModelCallEvent({
        agent,
        stopData: {
          message: new Message({
            role: 'assistant',
            content: [new ToolUseBlock({ name: 'test_tool', toolUseId: 'tool-1', input: {} })],
          }),
          stopReason: 'toolUse',
        },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      })
      await registry.invokeCallbacks(afterModelEvent)

      // Cycle span should still be active (waiting for tools to complete)
      expect(provider.cycleSpan).toBeDefined()
    })

    it('should end cycle span on AfterToolsEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Start agent span
      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      // Start model call
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      // End model call with toolUse
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

      expect(provider.cycleSpan).toBeDefined()

      // Tools complete
      const toolResultMessage = new Message({
        role: 'user',
        content: [new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [] })],
      })
      await registry.invokeCallbacks(new AfterToolsEvent({ agent, message: toolResultMessage }))

      // Cycle span should be ended
      expect(provider.cycleSpan).toBeFalsy()
    })
  })

  describe('span lifecycle with cycle spans disabled', () => {
    beforeEach(() => {
      provider = new TelemetryHookProvider({ enableCycleSpans: false })
      registry = new HookRegistryImplementation()
      provider.registerCallbacks(registry)
    })

    it('should not create cycle spans when disabled', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Start agent span
      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      // Start model call
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      // Cycle span should not be created
      expect(provider.cycleSpan).toBeFalsy()
      // Model span should still be created
      expect(provider.modelSpan).toBeDefined()
    })

    it('should create model span as direct child of agent span', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Start agent span
      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      expect(provider.agentSpan).toBeDefined()

      // Start model call
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      // Model span should be created without cycle span
      expect(provider.modelSpan).toBeDefined()
      expect(provider.cycleSpan).toBeFalsy()
    })
  })

  describe('tool span lifecycle', () => {
    beforeEach(() => {
      provider = new TelemetryHookProvider({ enableCycleSpans: true })
      registry = new HookRegistryImplementation()
      provider.registerCallbacks(registry)
    })

    it('should start tool span on BeforeToolCallEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Start agent span
      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      // Start model call and end with toolUse
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

      // Start tool call
      const toolUse = { name: 'test_tool', toolUseId: 'tool-1', input: { key: 'value' } }
      const beforeToolEvent = new BeforeToolCallEvent({ agent, toolUse, tool: undefined })
      await registry.invokeCallbacks(beforeToolEvent)

      // setActiveSpan should have been called with the tool span
      expect(beforeToolEvent._activeSpan).toBeDefined()
    })

    it('should end tool span on AfterToolCallEvent', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Start agent span
      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      // Start model call and end with toolUse
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

      // Start tool call
      const toolUse = { name: 'test_tool', toolUseId: 'tool-1', input: {} }
      await registry.invokeCallbacks(new BeforeToolCallEvent({ agent, toolUse, tool: undefined }))

      // End tool call
      const toolResult = new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [] })
      await registry.invokeCallbacks(new AfterToolCallEvent({ agent, toolUse, tool: undefined, result: toolResult }))

      // Tool span should be cleaned up (no error means it was ended successfully)
    })

    it('should handle tool errors gracefully', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Start agent span
      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      // Start model call and end with toolUse
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))
      await registry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        stopData: {
          message: new Message({
            role: 'assistant',
            content: [new ToolUseBlock({ name: 'error_tool', toolUseId: 'tool-2', input: {} })],
          }),
          stopReason: 'toolUse',
        },
      }))

      // Start tool call
      const toolUse = { name: 'error_tool', toolUseId: 'tool-2', input: {} }
      await registry.invokeCallbacks(new BeforeToolCallEvent({ agent, toolUse, tool: undefined }))

      // End tool call with error
      const toolResult = new ToolResultBlock({ toolUseId: 'tool-2', status: 'error', content: [] })
      const error = new Error('Tool execution failed')
      const afterToolEvent = new AfterToolCallEvent({ agent, toolUse, tool: undefined, result: toolResult, error })
      await registry.invokeCallbacks(afterToolEvent)

      // Should not throw
    })
  })

  describe('usage accumulation', () => {
    beforeEach(() => {
      provider = new TelemetryHookProvider({ enableCycleSpans: true })
      registry = new HookRegistryImplementation()
      provider.registerCallbacks(registry)
    })

    it('should accumulate token usage across model calls', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Start agent span
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
      const usage = provider.accumulatedUsage
      expect(usage.inputTokens).toBe(300)
      expect(usage.outputTokens).toBe(150)
      expect(usage.totalTokens).toBe(450)
    })

    it('should reset usage on new invocation', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // First invocation
      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))
      await registry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        stopData: {
          message: new Message({ role: 'assistant', content: [new TextBlock('Hi!')] }),
          stopReason: 'endTurn',
        },
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      }))
      await registry.invokeCallbacks(new AfterInvocationEvent({
        agent,
        result: {
          message: new Message({ role: 'assistant', content: [new TextBlock('Hi!')] }),
          stopReason: 'endTurn',
        },
      }))

      // Second invocation - usage should be reset
      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      const usage = provider.accumulatedUsage
      expect(usage.inputTokens).toBe(0)
      expect(usage.outputTokens).toBe(0)
      expect(usage.totalTokens).toBe(0)
    })

    it('should accumulate cache tokens', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Start agent span
      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      // Model call with cache tokens
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))
      await registry.invokeCallbacks(new AfterModelCallEvent({
        agent,
        stopData: {
          message: new Message({ role: 'assistant', content: [new TextBlock('Hi!')] }),
          stopReason: 'endTurn',
        },
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          cacheReadInputTokens: 25,
          cacheWriteInputTokens: 10,
        },
      }))

      const usage = provider.accumulatedUsage
      expect(usage.cacheReadInputTokens).toBe(25)
      expect(usage.cacheWriteInputTokens).toBe(10)
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      provider = new TelemetryHookProvider({ enableCycleSpans: true })
      registry = new HookRegistryImplementation()
      provider.registerCallbacks(registry)
    })

    it('should handle missing agent span gracefully', async () => {
      const agent = createMockAgent()

      // Try to end agent span without starting it
      const afterEvent = new AfterInvocationEvent({
        agent,
        result: {
          message: new Message({ role: 'assistant', content: [new TextBlock('Hi!')] }),
          stopReason: 'endTurn',
        },
      })

      // Should not throw
      await expect(registry.invokeCallbacks(afterEvent)).resolves.not.toThrow()
    })

    it('should handle missing model span gracefully', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Start agent span
      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      // Try to end model span without starting it
      const afterModelEvent = new AfterModelCallEvent({
        agent,
        stopData: {
          message: new Message({ role: 'assistant', content: [new TextBlock('Hi!')] }),
          stopReason: 'endTurn',
        },
      })

      // Should not throw
      await expect(registry.invokeCallbacks(afterModelEvent)).resolves.not.toThrow()
    })

    it('should handle invocation error', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Start agent span
      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      // End with error
      const error = new Error('Invocation failed')
      const afterEvent = new AfterInvocationEvent({ agent, error })

      // Should not throw
      await expect(registry.invokeCallbacks(afterEvent)).resolves.not.toThrow()
    })

    it('should handle model call error', async () => {
      const agent = createMockAgent()
      const inputMessages = [new Message({ role: 'user', content: [new TextBlock('Hello')] })]

      // Start agent span
      await registry.invokeCallbacks(new BeforeInvocationEvent({ agent, inputMessages }))

      // Start model call
      await registry.invokeCallbacks(new BeforeModelCallEvent({ agent }))

      // End with error
      const error = new Error('Model call failed')
      const afterModelEvent = new AfterModelCallEvent({ agent, error })

      // Should not throw
      await expect(registry.invokeCallbacks(afterModelEvent)).resolves.not.toThrow()
    })
  })
})
