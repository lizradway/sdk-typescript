/**
 * Unit tests for metrics.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  Trace,
  ToolMetrics,
  EventLoopMetrics,
  AgentInvocation,
  MetricsClient,
  metricsToString,
} from '../metrics.js'
import type { ToolUse } from '../types.js'
import type { Message } from '../../types/messages.js'

// Mock the logger
vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: () => 'test-uuid-1234',
})

describe('Trace', () => {
  describe('constructor', () => {
    it('creates a trace with required parameters', () => {
      const trace = new Trace('test-trace')

      expect(trace.name).toBe('test-trace')
      expect(trace.id).toBe('test-uuid-1234')
      expect(trace.children).toEqual([])
      expect(trace.metadata).toEqual({})
      expect(trace.startTime).toBeGreaterThan(0)
      expect(trace.endTime).toBeUndefined()
      expect(trace.parentId).toBeUndefined()
      expect(trace.rawName).toBeUndefined()
      expect(trace.message).toBeUndefined()
    })

    it('creates a trace with all optional parameters', () => {
      const startTime = 1000
      const metadata = { key: 'value' }
      const message = { role: 'user', content: [] } as Message

      const trace = new Trace('test-trace', 'parent-id', startTime, 'raw-name', metadata, message)

      expect(trace.name).toBe('test-trace')
      expect(trace.parentId).toBe('parent-id')
      expect(trace.startTime).toBe(startTime)
      expect(trace.rawName).toBe('raw-name')
      expect(trace.metadata).toEqual(metadata)
      expect(trace.message).toBe(message)
    })
  })

  describe('end', () => {
    it('sets endTime to current time when no argument provided', () => {
      const trace = new Trace('test-trace')
      const beforeEnd = Date.now() / 1000

      trace.end()

      expect(trace.endTime).toBeDefined()
      expect(trace.endTime).toBeGreaterThanOrEqual(beforeEnd)
    })

    it('sets endTime to provided value', () => {
      const trace = new Trace('test-trace')
      const endTime = 2000

      trace.end(endTime)

      expect(trace.endTime).toBe(endTime)
    })
  })

  describe('addChild', () => {
    it('adds a child trace', () => {
      const parent = new Trace('parent')
      const child = new Trace('child')

      parent.addChild(child)

      expect(parent.children).toHaveLength(1)
      expect(parent.children[0]).toBe(child)
    })

    it('adds multiple children', () => {
      const parent = new Trace('parent')
      const child1 = new Trace('child1')
      const child2 = new Trace('child2')

      parent.addChild(child1)
      parent.addChild(child2)

      expect(parent.children).toHaveLength(2)
    })
  })

  describe('duration', () => {
    it('returns undefined when endTime is not set', () => {
      const trace = new Trace('test-trace', undefined, 1000)

      expect(trace.duration()).toBeUndefined()
    })

    it('calculates duration correctly', () => {
      const trace = new Trace('test-trace', undefined, 1000)
      trace.end(1500)

      expect(trace.duration()).toBe(500)
    })
  })

  describe('addMessage', () => {
    it('adds a message to the trace', () => {
      const trace = new Trace('test-trace')
      const message = { role: 'assistant', content: [] } as Message

      trace.addMessage(message)

      expect(trace.message).toBe(message)
    })
  })

  describe('toDict', () => {
    it('converts trace to dictionary representation', () => {
      const trace = new Trace('test-trace', 'parent-id', 1000, 'raw-name', { key: 'value' })
      trace.end(1500)

      const dict = trace.toDict()

      expect(dict).toEqual({
        id: 'test-uuid-1234',
        name: 'test-trace',
        raw_name: 'raw-name',
        parent_id: 'parent-id',
        start_time: 1000,
        end_time: 1500,
        duration: 500,
        children: [],
        metadata: { key: 'value' },
        message: undefined,
      })
    })

    it('includes children in dictionary', () => {
      const parent = new Trace('parent', undefined, 1000)
      const child = new Trace('child', undefined, 1100)
      child.end(1200)
      parent.addChild(child)
      parent.end(1500)

      const dict = parent.toDict()

      expect(dict.children).toHaveLength(1)
      expect((dict.children as Record<string, unknown>[])[0].name).toBe('child')
    })
  })
})

describe('ToolMetrics', () => {
  let mockTool: ToolUse
  let mockMetricsClient: MetricsClient

  beforeEach(() => {
    mockTool = {
      name: 'test-tool',
      toolUseId: 'tool-use-123',
      input: { param: 'value' },
    }

    // Get the singleton instance
    mockMetricsClient = MetricsClient.getInstance()
  })

  describe('constructor', () => {
    it('initializes with default values', () => {
      const metrics = new ToolMetrics(mockTool)

      expect(metrics.tool).toBe(mockTool)
      expect(metrics.callCount).toBe(0)
      expect(metrics.successCount).toBe(0)
      expect(metrics.errorCount).toBe(0)
      expect(metrics.totalTime).toBe(0)
    })
  })

  describe('addCall', () => {
    it('records a successful call', () => {
      const metrics = new ToolMetrics(mockTool)

      metrics.addCall(mockTool, 1.5, true, mockMetricsClient, { tool_name: 'test-tool' })

      expect(metrics.callCount).toBe(1)
      expect(metrics.successCount).toBe(1)
      expect(metrics.errorCount).toBe(0)
      expect(metrics.totalTime).toBe(1.5)
    })

    it('records a failed call', () => {
      const metrics = new ToolMetrics(mockTool)

      metrics.addCall(mockTool, 2.0, false, mockMetricsClient, { tool_name: 'test-tool' })

      expect(metrics.callCount).toBe(1)
      expect(metrics.successCount).toBe(0)
      expect(metrics.errorCount).toBe(1)
      expect(metrics.totalTime).toBe(2.0)
    })

    it('accumulates multiple calls', () => {
      const metrics = new ToolMetrics(mockTool)

      metrics.addCall(mockTool, 1.0, true, mockMetricsClient, {})
      metrics.addCall(mockTool, 2.0, true, mockMetricsClient, {})
      metrics.addCall(mockTool, 1.5, false, mockMetricsClient, {})

      expect(metrics.callCount).toBe(3)
      expect(metrics.successCount).toBe(2)
      expect(metrics.errorCount).toBe(1)
      expect(metrics.totalTime).toBe(4.5)
    })
  })
})

describe('AgentInvocation', () => {
  it('initializes with empty cycles and zero usage', () => {
    const invocation = new AgentInvocation()

    expect(invocation.cycles).toEqual([])
    expect(invocation.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    })
  })
})

describe('EventLoopMetrics', () => {
  let metrics: EventLoopMetrics

  beforeEach(() => {
    metrics = new EventLoopMetrics()
  })

  describe('constructor', () => {
    it('initializes with default values', () => {
      expect(metrics.cycleCount).toBe(0)
      expect(metrics.toolMetrics.size).toBe(0)
      expect(metrics.cycleDurations).toEqual([])
      expect(metrics.agentInvocations).toEqual([])
      expect(metrics.traces).toEqual([])
      expect(metrics.accumulatedUsage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      })
      expect(metrics.accumulatedMetrics).toEqual({ latencyMs: 0 })
    })
  })

  describe('latestAgentInvocation', () => {
    it('returns undefined when no invocations exist', () => {
      expect(metrics.latestAgentInvocation).toBeUndefined()
    })

    it('returns the most recent invocation', () => {
      metrics.resetUsageMetrics()
      metrics.resetUsageMetrics()

      expect(metrics.latestAgentInvocation).toBe(metrics.agentInvocations[1])
    })
  })

  describe('startCycle', () => {
    it('increments cycle count and creates trace', () => {
      metrics.resetUsageMetrics() // Create an agent invocation first

      const { startTime, cycleTrace } = metrics.startCycle({
        event_loop_cycle_id: 'cycle-1',
      })

      expect(metrics.cycleCount).toBe(1)
      expect(startTime).toBeGreaterThan(0)
      expect(cycleTrace).toBeDefined()
      expect(cycleTrace.name).toBe('Cycle 1')
      expect(metrics.traces).toHaveLength(1)
    })

    it('adds cycle to latest agent invocation', () => {
      metrics.resetUsageMetrics()

      metrics.startCycle({ event_loop_cycle_id: 'cycle-1' })

      expect(metrics.latestAgentInvocation?.cycles).toHaveLength(1)
      expect(metrics.latestAgentInvocation?.cycles[0].eventLoopCycleId).toBe('cycle-1')
    })
  })

  describe('endCycle', () => {
    it('records cycle duration', () => {
      metrics.resetUsageMetrics()
      const { startTime, cycleTrace } = metrics.startCycle({ event_loop_cycle_id: 'cycle-1' })

      metrics.endCycle(startTime, cycleTrace, { event_loop_cycle_id: 'cycle-1' })

      expect(metrics.cycleDurations).toHaveLength(1)
      expect(metrics.cycleDurations[0]).toBeGreaterThanOrEqual(0)
      expect(cycleTrace.endTime).toBeDefined()
    })

    it('adds message to trace if provided', () => {
      metrics.resetUsageMetrics()
      const { startTime, cycleTrace } = metrics.startCycle({ event_loop_cycle_id: 'cycle-1' })
      const message = { role: 'assistant', content: [] } as Message

      metrics.endCycle(startTime, cycleTrace, {}, message)

      expect(cycleTrace.message).toBe(message)
    })
  })

  describe('addToolUsage', () => {
    it('records tool usage metrics', () => {
      const tool: ToolUse = {
        name: 'test-tool',
        toolUseId: 'tool-123',
        input: {},
      }
      const toolTrace = new Trace('tool-trace')
      const message = { role: 'user', content: [] } as Message

      metrics.addToolUsage(tool, 1.5, toolTrace, true, message)

      expect(metrics.toolMetrics.has('test-tool')).toBe(true)
      const toolMetric = metrics.toolMetrics.get('test-tool')
      expect(toolMetric?.callCount).toBe(1)
      expect(toolMetric?.successCount).toBe(1)
    })

    it('handles unknown tool name', () => {
      const tool: ToolUse = {
        name: undefined as unknown as string,
        toolUseId: undefined as unknown as string,
        input: {},
      }
      const toolTrace = new Trace('tool-trace')
      const message = { role: 'user', content: [] } as Message

      metrics.addToolUsage(tool, 1.0, toolTrace, false, message)

      expect(metrics.toolMetrics.has('unknown_tool')).toBe(true)
    })
  })

  describe('updateUsage', () => {
    it('accumulates token usage', () => {
      metrics.updateUsage({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      })

      expect(metrics.accumulatedUsage.inputTokens).toBe(100)
      expect(metrics.accumulatedUsage.outputTokens).toBe(50)
      expect(metrics.accumulatedUsage.totalTokens).toBe(150)
    })

    it('accumulates cache tokens when provided', () => {
      metrics.updateUsage({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheReadInputTokens: 20,
        cacheWriteInputTokens: 10,
      })

      expect(metrics.accumulatedUsage.cacheReadInputTokens).toBe(20)
      expect(metrics.accumulatedUsage.cacheWriteInputTokens).toBe(10)
    })

    it('updates latest agent invocation usage', () => {
      metrics.resetUsageMetrics()
      metrics.startCycle({ event_loop_cycle_id: 'cycle-1' })

      metrics.updateUsage({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      })

      expect(metrics.latestAgentInvocation?.usage.inputTokens).toBe(100)
    })
  })

  describe('resetUsageMetrics', () => {
    it('creates a new agent invocation', () => {
      metrics.resetUsageMetrics()

      expect(metrics.agentInvocations).toHaveLength(1)
      expect(metrics.agentInvocations[0]).toBeInstanceOf(AgentInvocation)
    })
  })

  describe('updateMetrics', () => {
    it('accumulates latency metrics', () => {
      metrics.updateMetrics({ latencyMs: 100 })
      metrics.updateMetrics({ latencyMs: 200 })

      expect(metrics.accumulatedMetrics.latencyMs).toBe(300)
    })
  })

  describe('getSummary', () => {
    it('returns comprehensive summary', () => {
      metrics.resetUsageMetrics()
      const { startTime, cycleTrace } = metrics.startCycle({ event_loop_cycle_id: 'cycle-1' })
      metrics.endCycle(startTime, cycleTrace)
      metrics.updateUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 })
      metrics.updateMetrics({ latencyMs: 100 })

      const summary = metrics.getSummary()

      expect(summary.total_cycles).toBe(1)
      expect(summary.total_duration).toBeGreaterThanOrEqual(0)
      expect(summary.average_cycle_time).toBeGreaterThanOrEqual(0)
      expect(summary.tool_usage).toEqual({})
      expect(summary.traces).toHaveLength(1)
      expect(summary.accumulated_usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      })
      expect(summary.accumulated_metrics).toEqual({ latencyMs: 100 })
      expect(summary.agent_invocations).toHaveLength(1)
    })

    it('includes tool usage in summary', () => {
      const tool: ToolUse = { name: 'test-tool', toolUseId: 'tool-123', input: {} }
      const toolTrace = new Trace('tool-trace')
      const message = { role: 'user', content: [] } as Message

      metrics.addToolUsage(tool, 1.5, toolTrace, true, message)

      const summary = metrics.getSummary()
      const toolUsage = summary.tool_usage as Record<string, unknown>

      expect(toolUsage['test-tool']).toBeDefined()
    })
  })
})

describe('MetricsClient', () => {
  it('returns singleton instance', () => {
    const instance1 = MetricsClient.getInstance()
    const instance2 = MetricsClient.getInstance()

    expect(instance1).toBe(instance2)
  })

  it('has all required instruments', () => {
    const client = MetricsClient.getInstance()

    expect(client.meter).toBeDefined()
    expect(client.eventLoopCycleCount).toBeDefined()
    expect(client.eventLoopStartCycle).toBeDefined()
    expect(client.eventLoopEndCycle).toBeDefined()
    expect(client.eventLoopCycleDuration).toBeDefined()
    expect(client.eventLoopLatency).toBeDefined()
    expect(client.eventLoopInputTokens).toBeDefined()
    expect(client.eventLoopOutputTokens).toBeDefined()
    expect(client.eventLoopCacheReadInputTokens).toBeDefined()
    expect(client.eventLoopCacheWriteInputTokens).toBeDefined()
    expect(client.modelTimeToFirstToken).toBeDefined()
    expect(client.toolCallCount).toBeDefined()
    expect(client.toolSuccessCount).toBeDefined()
    expect(client.toolErrorCount).toBeDefined()
    expect(client.toolDuration).toBeDefined()
  })
})

describe('metricsToString', () => {
  it('formats metrics as human-readable string', () => {
    const metrics = new EventLoopMetrics()
    metrics.resetUsageMetrics()
    const { startTime, cycleTrace } = metrics.startCycle({ event_loop_cycle_id: 'cycle-1' })
    metrics.endCycle(startTime, cycleTrace)
    metrics.updateUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 })
    metrics.updateMetrics({ latencyMs: 100 })

    const result = metricsToString(metrics)

    expect(result).toContain('Event Loop Metrics Summary:')
    expect(result).toContain('Cycles:')
    expect(result).toContain('Tokens:')
    expect(result).toContain('in=100')
    expect(result).toContain('out=50')
    expect(result).toContain('total=150')
    expect(result).toContain('Latency: 100ms')
    expect(result).toContain('Tool Usage:')
    expect(result).toContain('Execution Trace:')
  })

  it('includes cache tokens when present', () => {
    const metrics = new EventLoopMetrics()
    metrics.updateUsage({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cacheReadInputTokens: 20,
      cacheWriteInputTokens: 10,
    })

    const result = metricsToString(metrics)

    expect(result).toContain('cache_read_input_tokens=20')
    expect(result).toContain('cache_write_input_tokens=10')
  })

  it('includes tool usage details', () => {
    const metrics = new EventLoopMetrics()
    const tool: ToolUse = { name: 'calculator', toolUseId: 'calc-123', input: {} }
    const toolTrace = new Trace('tool-trace')
    const message = { role: 'user', content: [] } as Message

    metrics.addToolUsage(tool, 1.5, toolTrace, true, message)

    const result = metricsToString(metrics)

    expect(result).toContain('calculator:')
    expect(result).toContain('Stats: calls=1, success=1')
  })
})
