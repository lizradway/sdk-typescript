import { describe, it, expect, beforeEach } from 'vitest'
import {
  LocalTrace,
  ToolMetrics,
  AgentInvocation,
  EventLoopMetrics,
  MetricsClient,
  metricsToString,
} from '../metrics.js'
import { Message, TextBlock, ToolResultBlock } from '../../types/messages.js'

describe('LocalTrace', () => {
  describe('constructor', () => {
    it('should create a trace with required name', () => {
      const trace = new LocalTrace('test-trace')

      expect(trace.name).toBe('test-trace')
      expect(trace.id).toBeDefined()
      expect(trace.startTime).toBeGreaterThan(0)
      expect(trace.children).toEqual([])
      expect(trace.metadata).toEqual({})
    })

    it('should create a trace with all optional parameters', () => {
      const message = new Message({ role: 'user', content: [new TextBlock('test')] })
      const metadata = { key: 'value' }
      const startTime = 1000

      const trace = new LocalTrace('test-trace', 'parent-id', startTime, 'raw-name', metadata, message)

      expect(trace.name).toBe('test-trace')
      expect(trace.parentId).toBe('parent-id')
      expect(trace.startTime).toBe(startTime)
      expect(trace.rawName).toBe('raw-name')
      expect(trace.metadata).toEqual(metadata)
      expect(trace.message).toBe(message)
    })

    it('should use current time when startTime is not provided', () => {
      const before = Date.now() / 1000
      const trace = new LocalTrace('test-trace')
      const after = Date.now() / 1000

      expect(trace.startTime).toBeGreaterThanOrEqual(before)
      expect(trace.startTime).toBeLessThanOrEqual(after)
    })
  })

  describe('end', () => {
    it('should set endTime to current time when no argument provided', () => {
      const trace = new LocalTrace('test-trace')
      const before = Date.now() / 1000
      trace.end()
      const after = Date.now() / 1000

      expect(trace.endTime).toBeGreaterThanOrEqual(before)
      expect(trace.endTime).toBeLessThanOrEqual(after)
    })

    it('should set endTime to provided value', () => {
      const trace = new LocalTrace('test-trace')
      trace.end(2000)

      expect(trace.endTime).toBe(2000)
    })
  })

  describe('addChild', () => {
    it('should add a child trace', () => {
      const parent = new LocalTrace('parent')
      const child = new LocalTrace('child')

      parent.addChild(child)

      expect(parent.children).toHaveLength(1)
      expect(parent.children[0]).toBe(child)
    })

    it('should add multiple children', () => {
      const parent = new LocalTrace('parent')
      const child1 = new LocalTrace('child1')
      const child2 = new LocalTrace('child2')

      parent.addChild(child1)
      parent.addChild(child2)

      expect(parent.children).toHaveLength(2)
    })
  })

  describe('duration', () => {
    it('should return undefined when endTime is not set', () => {
      const trace = new LocalTrace('test-trace', undefined, 1000)

      expect(trace.duration()).toBeUndefined()
    })

    it('should calculate duration correctly', () => {
      const trace = new LocalTrace('test-trace', undefined, 1000)
      trace.end(1500)

      expect(trace.duration()).toBe(500)
    })
  })

  describe('addMessage', () => {
    it('should add a message to the trace', () => {
      const trace = new LocalTrace('test-trace')
      const message = new Message({ role: 'user', content: [new TextBlock('test')] })

      trace.addMessage(message)

      expect(trace.message).toBe(message)
    })
  })

  describe('toDict', () => {
    it('should convert trace to dictionary representation', () => {
      const trace = new LocalTrace('test-trace', 'parent-id', 1000, 'raw-name', { key: 'value' })
      trace.end(1500)

      const dict = trace.toDict()

      expect(dict.id).toBe(trace.id)
      expect(dict.name).toBe('test-trace')
      expect(dict.raw_name).toBe('raw-name')
      expect(dict.parent_id).toBe('parent-id')
      expect(dict.start_time).toBe(1000)
      expect(dict.end_time).toBe(1500)
      expect(dict.duration).toBe(500)
      expect(dict.metadata).toEqual({ key: 'value' })
      expect(dict.children).toEqual([])
    })

    it('should include children in dictionary', () => {
      const parent = new LocalTrace('parent', undefined, 1000)
      const child = new LocalTrace('child', undefined, 1100)
      child.end(1200)
      parent.addChild(child)
      parent.end(1500)

      const dict = parent.toDict()

      expect(dict.children).toHaveLength(1)
      const children = dict.children as Record<string, unknown>[]
      expect(children[0]?.name).toBe('child')
    })
  })
})

describe('ToolMetrics', () => {
  let metricsClient: MetricsClient

  beforeEach(() => {
    metricsClient = MetricsClient.getInstance()
  })

  describe('constructor', () => {
    it('should initialize with tool and zero counters', () => {
      const tool = { name: 'test-tool', toolUseId: 'tool-123', input: {} }
      const toolMetrics = new ToolMetrics(tool)

      expect(toolMetrics.tool).toBe(tool)
      expect(toolMetrics.callCount).toBe(0)
      expect(toolMetrics.successCount).toBe(0)
      expect(toolMetrics.errorCount).toBe(0)
      expect(toolMetrics.totalTime).toBe(0)
    })
  })

  describe('addCall', () => {
    it('should record a successful call', () => {
      const tool = { name: 'test-tool', toolUseId: 'tool-123', input: {} }
      const toolMetrics = new ToolMetrics(tool)

      toolMetrics.addCall(tool, 0.5, true, metricsClient)

      expect(toolMetrics.callCount).toBe(1)
      expect(toolMetrics.successCount).toBe(1)
      expect(toolMetrics.errorCount).toBe(0)
      expect(toolMetrics.totalTime).toBe(0.5)
    })

    it('should record a failed call', () => {
      const tool = { name: 'test-tool', toolUseId: 'tool-123', input: {} }
      const toolMetrics = new ToolMetrics(tool)

      toolMetrics.addCall(tool, 0.3, false, metricsClient)

      expect(toolMetrics.callCount).toBe(1)
      expect(toolMetrics.successCount).toBe(0)
      expect(toolMetrics.errorCount).toBe(1)
      expect(toolMetrics.totalTime).toBe(0.3)
    })

    it('should accumulate multiple calls', () => {
      const tool = { name: 'test-tool', toolUseId: 'tool-123', input: {} }
      const toolMetrics = new ToolMetrics(tool)

      toolMetrics.addCall(tool, 0.5, true, metricsClient)
      toolMetrics.addCall(tool, 0.3, true, metricsClient)
      toolMetrics.addCall(tool, 0.2, false, metricsClient)

      expect(toolMetrics.callCount).toBe(3)
      expect(toolMetrics.successCount).toBe(2)
      expect(toolMetrics.errorCount).toBe(1)
      expect(toolMetrics.totalTime).toBe(1.0)
    })
  })
})

describe('AgentInvocation', () => {
  it('should initialize with empty cycles and zero usage', () => {
    const invocation = new AgentInvocation()

    expect(invocation.cycles).toEqual([])
    expect(invocation.usage.inputTokens).toBe(0)
    expect(invocation.usage.outputTokens).toBe(0)
    expect(invocation.usage.totalTokens).toBe(0)
  })
})

describe('EventLoopMetrics', () => {
  let eventLoopMetrics: EventLoopMetrics

  beforeEach(() => {
    eventLoopMetrics = new EventLoopMetrics()
  })

  describe('latestAgentInvocation', () => {
    it('should return undefined when no invocations exist', () => {
      expect(eventLoopMetrics.latestAgentInvocation).toBeUndefined()
    })

    it('should return the most recent invocation', () => {
      eventLoopMetrics.resetUsageMetrics()
      eventLoopMetrics.resetUsageMetrics()

      expect(eventLoopMetrics.latestAgentInvocation).toBe(eventLoopMetrics.agentInvocations[1])
    })
  })

  describe('startCycle', () => {
    it('should increment cycle count and create trace', () => {
      eventLoopMetrics.resetUsageMetrics()
      const { startTime, cycleTrace } = eventLoopMetrics.startCycle({ event_loop_cycle_id: 'cycle-1' })

      expect(eventLoopMetrics.cycleCount).toBe(1)
      expect(startTime).toBeGreaterThan(0)
      expect(cycleTrace.name).toBe('Cycle 1')
      expect(eventLoopMetrics.traces).toHaveLength(1)
    })

    it('should add cycle to latest agent invocation', () => {
      eventLoopMetrics.resetUsageMetrics()
      eventLoopMetrics.startCycle({ event_loop_cycle_id: 'cycle-1' })

      const latestInvocation = eventLoopMetrics.latestAgentInvocation
      expect(latestInvocation?.cycles).toHaveLength(1)
      expect(latestInvocation?.cycles[0]?.eventLoopCycleId).toBe('cycle-1')
    })
  })

  describe('endCycle', () => {
    it('should record cycle duration', () => {
      eventLoopMetrics.resetUsageMetrics()
      const { startTime, cycleTrace } = eventLoopMetrics.startCycle({ event_loop_cycle_id: 'cycle-1' })

      eventLoopMetrics.endCycle(startTime, cycleTrace)

      expect(eventLoopMetrics.cycleDurations).toHaveLength(1)
      expect(cycleTrace.endTime).toBeDefined()
    })

    it('should add message to trace when provided', () => {
      eventLoopMetrics.resetUsageMetrics()
      const { startTime, cycleTrace } = eventLoopMetrics.startCycle({ event_loop_cycle_id: 'cycle-1' })
      const message = new Message({ role: 'assistant', content: [new TextBlock('response')] })

      eventLoopMetrics.endCycle(startTime, cycleTrace, {}, message)

      expect(cycleTrace.message).toBe(message)
    })
  })

  describe('addToolUsage', () => {
    it('should record tool usage metrics', () => {
      const tool = { name: 'test-tool', toolUseId: 'tool-123', input: { key: 'value' } }
      const toolTrace = new LocalTrace('tool-trace')
      const message = new Message({
        role: 'user',
        content: [new ToolResultBlock({ toolUseId: 'tool-123', status: 'success', content: [] })],
      })

      eventLoopMetrics.addToolUsage({ tool, duration: 0.5, toolTrace, success: true, message })

      expect(eventLoopMetrics.toolMetrics.has('test-tool')).toBe(true)
      const toolMetric = eventLoopMetrics.toolMetrics.get('test-tool')
      expect(toolMetric?.callCount).toBe(1)
      expect(toolMetric?.successCount).toBe(1)
    })

    it('should handle tool with missing name', () => {
      const tool = { name: undefined as unknown as string, toolUseId: 'tool-123', input: {} }
      const toolTrace = new LocalTrace('tool-trace')
      const message = new Message({ role: 'user', content: [] })

      eventLoopMetrics.addToolUsage({ tool, duration: 0.5, toolTrace, success: true, message })

      expect(eventLoopMetrics.toolMetrics.has('unknown_tool')).toBe(true)
    })

    it('should accumulate metrics for same tool', () => {
      const tool = { name: 'test-tool', toolUseId: 'tool-123', input: {} }
      const message = new Message({ role: 'user', content: [] })

      eventLoopMetrics.addToolUsage({ tool, duration: 0.5, toolTrace: new LocalTrace('trace1'), success: true, message })
      eventLoopMetrics.addToolUsage({ tool, duration: 0.3, toolTrace: new LocalTrace('trace2'), success: false, message })

      const toolMetric = eventLoopMetrics.toolMetrics.get('test-tool')
      expect(toolMetric?.callCount).toBe(2)
      expect(toolMetric?.successCount).toBe(1)
      expect(toolMetric?.errorCount).toBe(1)
    })
  })

  describe('updateUsage', () => {
    it('should accumulate token usage', () => {
      eventLoopMetrics.resetUsageMetrics()
      eventLoopMetrics.startCycle({ event_loop_cycle_id: 'cycle-1' })

      eventLoopMetrics.updateUsage({
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      })

      expect(eventLoopMetrics.accumulatedUsage.inputTokens).toBe(10)
      expect(eventLoopMetrics.accumulatedUsage.outputTokens).toBe(20)
      expect(eventLoopMetrics.accumulatedUsage.totalTokens).toBe(30)
    })

    it('should handle cache tokens', () => {
      eventLoopMetrics.resetUsageMetrics()
      eventLoopMetrics.startCycle({ event_loop_cycle_id: 'cycle-1' })

      eventLoopMetrics.updateUsage({
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        cacheReadInputTokens: 5,
        cacheWriteInputTokens: 3,
      })

      expect(eventLoopMetrics.accumulatedUsage.cacheReadInputTokens).toBe(5)
      expect(eventLoopMetrics.accumulatedUsage.cacheWriteInputTokens).toBe(3)
    })

    it('should update latest agent invocation usage', () => {
      eventLoopMetrics.resetUsageMetrics()
      eventLoopMetrics.startCycle({ event_loop_cycle_id: 'cycle-1' })

      eventLoopMetrics.updateUsage({
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      })

      const latestInvocation = eventLoopMetrics.latestAgentInvocation
      expect(latestInvocation?.usage.inputTokens).toBe(10)
    })

    it('should update current cycle usage', () => {
      eventLoopMetrics.resetUsageMetrics()
      eventLoopMetrics.startCycle({ event_loop_cycle_id: 'cycle-1' })

      eventLoopMetrics.updateUsage({
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      })

      const latestInvocation = eventLoopMetrics.latestAgentInvocation
      const currentCycle = latestInvocation?.cycles[0]
      expect(currentCycle?.usage.inputTokens).toBe(10)
    })
  })

  describe('resetUsageMetrics', () => {
    it('should create a new agent invocation', () => {
      eventLoopMetrics.resetUsageMetrics()
      eventLoopMetrics.resetUsageMetrics()

      expect(eventLoopMetrics.agentInvocations).toHaveLength(2)
    })
  })

  describe('updateMetrics', () => {
    it('should accumulate latency metrics', () => {
      eventLoopMetrics.updateMetrics({ latencyMs: 100 })
      eventLoopMetrics.updateMetrics({ latencyMs: 200 })

      expect(eventLoopMetrics.accumulatedMetrics.latencyMs).toBe(300)
    })
  })

  describe('getSummary', () => {
    it('should return comprehensive summary', () => {
      eventLoopMetrics.resetUsageMetrics()
      const { startTime, cycleTrace } = eventLoopMetrics.startCycle({ event_loop_cycle_id: 'cycle-1' })
      eventLoopMetrics.updateUsage({
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      })
      eventLoopMetrics.endCycle(startTime, cycleTrace)

      const summary = eventLoopMetrics.getSummary()

      expect(summary.total_cycles).toBe(1)
      expect(summary.total_duration).toBeGreaterThanOrEqual(0)
      expect(summary.average_cycle_time).toBeGreaterThanOrEqual(0)
      expect(summary.tool_usage).toEqual({})
      expect(summary.traces).toHaveLength(1)
      expect(summary.accumulated_usage).toBeDefined()
      expect(summary.accumulated_metrics).toBeDefined()
      expect(summary.agent_invocations).toHaveLength(1)
    })

    it('should include tool usage in summary', () => {
      const tool = { name: 'test-tool', toolUseId: 'tool-123', input: { key: 'value' } }
      const message = new Message({ role: 'user', content: [] })
      eventLoopMetrics.addToolUsage({ tool, duration: 0.5, toolTrace: new LocalTrace('trace'), success: true, message })

      const summary = eventLoopMetrics.getSummary()
      const toolUsage = summary.tool_usage as Record<string, unknown>

      expect(toolUsage['test-tool']).toBeDefined()
      const toolData = toolUsage['test-tool'] as Record<string, unknown>
      expect(toolData.tool_info).toBeDefined()
      expect(toolData.execution_stats).toBeDefined()
    })

    it('should handle zero cycles', () => {
      const summary = eventLoopMetrics.getSummary()

      expect(summary.total_cycles).toBe(0)
      expect(summary.average_cycle_time).toBe(0)
    })
  })
})

describe('MetricsClient', () => {
  it('should return singleton instance', () => {
    const instance1 = MetricsClient.getInstance()
    const instance2 = MetricsClient.getInstance()

    expect(instance1).toBe(instance2)
  })

  it('should have all metric instruments initialized', () => {
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
  it('should format metrics as human-readable string', () => {
    const eventLoopMetrics = new EventLoopMetrics()
    eventLoopMetrics.resetUsageMetrics()
    const { startTime, cycleTrace } = eventLoopMetrics.startCycle({ event_loop_cycle_id: 'cycle-1' })
    eventLoopMetrics.updateUsage({
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
    })
    eventLoopMetrics.endCycle(startTime, cycleTrace)

    const result = metricsToString(eventLoopMetrics)

    expect(result).toContain('Event Loop Metrics Summary:')
    expect(result).toContain('Cycles: total=1')
    expect(result).toContain('Tokens:')
    expect(result).toContain('in=100')
    expect(result).toContain('out=200')
    expect(result).toContain('total=300')
    expect(result).toContain('Latency:')
    expect(result).toContain('Tool Usage:')
    expect(result).toContain('Execution Trace:')
  })

  it('should include cache tokens when present', () => {
    const eventLoopMetrics = new EventLoopMetrics()
    eventLoopMetrics.resetUsageMetrics()
    const { startTime, cycleTrace } = eventLoopMetrics.startCycle({ event_loop_cycle_id: 'cycle-1' })
    eventLoopMetrics.updateUsage({
      inputTokens: 100,
      outputTokens: 200,
      totalTokens: 300,
      cacheReadInputTokens: 50,
      cacheWriteInputTokens: 25,
    })
    eventLoopMetrics.endCycle(startTime, cycleTrace)

    const result = metricsToString(eventLoopMetrics)

    expect(result).toContain('cache_read_input_tokens=50')
    expect(result).toContain('cache_write_input_tokens=25')
  })

  it('should include tool usage details', () => {
    const eventLoopMetrics = new EventLoopMetrics()
    const tool = { name: 'calculator', toolUseId: 'calc-123', input: { a: 1, b: 2 } }
    const message = new Message({ role: 'user', content: [] })
    eventLoopMetrics.addToolUsage({ tool, duration: 0.5, toolTrace: new LocalTrace('trace'), success: true, message })

    const result = metricsToString(eventLoopMetrics)

    expect(result).toContain('calculator:')
    expect(result).toContain('Stats: calls=1, success=1')
    expect(result).toContain('errors=0')
    expect(result).toContain('success_rate=100.0%')
  })

  it('should handle traces with children', () => {
    const eventLoopMetrics = new EventLoopMetrics()
    eventLoopMetrics.resetUsageMetrics()
    const { startTime, cycleTrace } = eventLoopMetrics.startCycle({ event_loop_cycle_id: 'cycle-1' })

    const childTrace = new LocalTrace('child-operation', undefined, startTime + 0.1)
    childTrace.end(startTime + 0.2)
    cycleTrace.addChild(childTrace)

    eventLoopMetrics.endCycle(startTime, cycleTrace)

    const result = metricsToString(eventLoopMetrics)

    expect(result).toContain('Cycle 1')
    expect(result).toContain('child-operation')
  })

  it('should use rawName when available', () => {
    const eventLoopMetrics = new EventLoopMetrics()
    const tool = { name: 'test-tool', toolUseId: 'tool-123', input: {} }
    const toolTrace = new LocalTrace('tool-trace')
    const message = new Message({ role: 'user', content: [] })

    eventLoopMetrics.addToolUsage({ tool, duration: 0.5, toolTrace, success: true, message })

    // The rawName should be set by addToolUsage
    expect(toolTrace.rawName).toBe('test-tool - tool-123')
  })
})
