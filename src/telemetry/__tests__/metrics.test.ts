import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentLoopMetrics, LocalTrace } from '../metrics.js'
import type { ToolUse } from '../../tools/types.js'
import { Message, TextBlock } from '../../types/messages.js'

describe('LocalTrace', () => {
  describe('constructor', () => {
    it('creates a root trace with defaults', () => {
      vi.spyOn(Date, 'now').mockReturnValue(50_000)
      const trace = new LocalTrace('test-trace')

      expect(trace.name).toBe('test-trace')
      expect(trace.id).toMatch(/^[0-9a-f-]+$/)
      expect(trace.parentId).toBeNull()
      expect(trace.startTime).toBe(50.0)
      expect(trace.endTime).toBeNull()
      expect(trace.children).toStrictEqual([])
      expect(trace.metadata).toStrictEqual({})
      vi.restoreAllMocks()
    })

    it('uses provided start time instead of Date.now', () => {
      const trace = new LocalTrace('trace', undefined, 100.5)

      expect(trace.startTime).toBe(100.5)
    })

    it('links to parent and registers as child', () => {
      const parent = new LocalTrace('parent', undefined, 1.0)
      const child = new LocalTrace('child', parent, 2.0)

      expect(child.parentId).toBe(parent.id)
      expect(parent.children).toStrictEqual([child])
    })
  })

  describe('end', () => {
    it('records provided end time and computes duration', () => {
      const trace = new LocalTrace('trace', undefined, 100.0)

      trace.end(105.0)

      expect(trace.endTime).toBe(105.0)
      expect(trace.duration).toBe(5.0)
    })

    it('uses Date.now when no end time provided', () => {
      vi.spyOn(Date, 'now').mockReturnValue(200_000)
      const trace = new LocalTrace('trace', undefined, 100.0)

      trace.end()

      expect(trace.endTime).toBe(200.0)
      expect(trace.duration).toBe(100.0)
      vi.restoreAllMocks()
    })
  })
})

describe('AgentLoopMetrics', () => {
  const makeTool = (name: string, toolUseId: string): ToolUse => ({
    name,
    toolUseId,
    input: {},
  })

  let metrics: AgentLoopMetrics

  beforeEach(() => {
    metrics = new AgentLoopMetrics()
  })

  describe('getSummary', () => {
    it('returns complete zeroed summary for fresh instance', () => {
      expect(metrics.getSummary()).toStrictEqual({
        totalCycles: 0,
        totalDuration: 0,
        averageCycleTime: 0,
        toolUsage: {},
        traces: [],
        accumulatedUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        accumulatedMetrics: { latencyMs: 0 },
        agentInvocations: [],
      })
    })

    it('returns complete summary after a realistic agent execution', () => {
      vi.useFakeTimers()
      vi.setSystemTime(100_000)

      metrics.startNewInvocation()

      const c1 = metrics.startCycle()
      metrics.updateFromMetadata({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        metrics: { latencyMs: 100 },
      })
      metrics.addToolUsage({
        tool: makeTool('search', 'tid-1'),
        duration: 0.5,
        toolTrace: new LocalTrace('t1', c1.cycleTrace),
        success: true,
      })
      vi.setSystemTime(103_000)
      metrics.endCycle(c1.startTime, c1.cycleTrace)

      vi.setSystemTime(200_000)
      const c2 = metrics.startCycle()
      metrics.updateFromMetadata({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        metrics: { latencyMs: 250 },
      })
      metrics.addToolUsage({
        tool: makeTool('search', 'tid-2'),
        duration: 1.5,
        toolTrace: new LocalTrace('t2', c2.cycleTrace),
        success: false,
      })
      vi.setSystemTime(205_000)
      metrics.endCycle(c2.startTime, c2.cycleTrace)

      const summary = metrics.getSummary()

      expect(summary).toStrictEqual({
        totalCycles: 2,
        totalDuration: 8.0,
        averageCycleTime: 4.0,
        accumulatedUsage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
        accumulatedMetrics: { latencyMs: 350 },
        toolUsage: {
          search: {
            callCount: 2,
            successCount: 1,
            errorCount: 1,
            totalTime: 2.0,
            averageTime: 1.0,
            successRate: 0.5,
          },
        },
        traces: [c1.cycleTrace, c2.cycleTrace],
        agentInvocations: [
          {
            usage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
            cycles: [
              { agentLoopCycleId: 'cycle-1', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
              { agentLoopCycleId: 'cycle-2', usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } },
            ],
          },
        ],
      })

      vi.useRealTimers()
    })

    it('tracks multiple invocations independently', () => {
      metrics.startNewInvocation()
      metrics.startCycle()
      metrics.updateUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })

      metrics.startNewInvocation()
      metrics.startCycle()
      metrics.updateUsage({ inputTokens: 20, outputTokens: 10, totalTokens: 30 })

      expect(metrics.getSummary().agentInvocations).toStrictEqual([
        {
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          cycles: [{ agentLoopCycleId: 'cycle-1', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }],
        },
        {
          usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
          cycles: [{ agentLoopCycleId: 'cycle-2', usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } }],
        },
      ])
    })
  })

  describe('startNewInvocation', () => {
    it('appends an invocation with empty cycles and zeroed usage', () => {
      metrics.startNewInvocation()

      expect(metrics.agentInvocations).toStrictEqual([
        { cycles: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      ])
    })

    it('latestAgentInvocation returns the most recently added invocation', () => {
      metrics.startNewInvocation()
      metrics.startNewInvocation()

      expect(metrics.agentInvocations).toHaveLength(2)
      expect(metrics.latestAgentInvocation).toBe(metrics.agentInvocations[1])
    })
  })

  describe('startCycle', () => {
    it('returns cycle id, start time, and trace', () => {
      vi.spyOn(Date, 'now').mockReturnValue(100_000)

      const result = metrics.startCycle()

      expect(result).toStrictEqual({
        cycleId: 'cycle-1',
        startTime: 100.0,
        cycleTrace: expect.objectContaining({ name: 'Cycle 1', startTime: 100.0 }),
      })
      expect(metrics.cycleCount).toBe(1)
      expect(metrics.traces).toStrictEqual([result.cycleTrace])
      vi.restoreAllMocks()
    })

    it('adds cycle entry to the latest invocation', () => {
      metrics.startNewInvocation()
      metrics.startCycle()

      expect(metrics.latestAgentInvocation!.cycles).toStrictEqual([
        { agentLoopCycleId: 'cycle-1', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      ])
    })

    it('does not fail when no invocation exists', () => {
      const result = metrics.startCycle()

      expect(result.cycleId).toBe('cycle-1')
      expect(metrics.agentInvocations).toStrictEqual([])
    })
  })

  describe('endCycle', () => {
    it('records duration and ends the trace', () => {
      vi.spyOn(Date, 'now').mockReturnValue(200_000)
      const cycleTrace = new LocalTrace('cycle', undefined, 100.0)

      metrics.endCycle(100.0, cycleTrace)

      expect(metrics.cycleDurations).toStrictEqual([100.0])
      expect(cycleTrace.endTime).toBe(200.0)
      expect(cycleTrace.duration).toBe(100.0)
      vi.restoreAllMocks()
    })
  })

  describe('addToolUsage', () => {
    it('records success and sets trace metadata', () => {
      const toolTrace = new LocalTrace('tool', undefined, 1.0)

      metrics.addToolUsage({
        tool: makeTool('myTool', 'id-1'),
        duration: 1.5,
        toolTrace,
        success: true,
      })

      expect(metrics.toolMetrics).toStrictEqual({
        myTool: { callCount: 1, successCount: 1, errorCount: 0, totalTime: 1.5 },
      })
      expect(toolTrace.metadata).toStrictEqual({ toolUseId: 'id-1', toolName: 'myTool' })
      expect(toolTrace.rawName).toBe('myTool - id-1')
    })

    it('records failure', () => {
      metrics.addToolUsage({
        tool: makeTool('myTool', 'id-1'),
        duration: 0.5,
        toolTrace: new LocalTrace('tool'),
        success: false,
      })

      expect(metrics.toolMetrics).toStrictEqual({
        myTool: { callCount: 1, successCount: 0, errorCount: 1, totalTime: 0.5 },
      })
    })

    it('accumulates across multiple calls to the same tool', () => {
      metrics.addToolUsage({
        tool: makeTool('myTool', 'id-1'),
        duration: 1.0,
        toolTrace: new LocalTrace('t1'),
        success: true,
      })
      metrics.addToolUsage({
        tool: makeTool('myTool', 'id-2'),
        duration: 2.0,
        toolTrace: new LocalTrace('t2'),
        success: false,
      })

      expect(metrics.toolMetrics).toStrictEqual({
        myTool: { callCount: 2, successCount: 1, errorCount: 1, totalTime: 3.0 },
      })
    })

    it('tracks different tools independently', () => {
      metrics.addToolUsage({
        tool: makeTool('toolA', 'id-1'),
        duration: 1.0,
        toolTrace: new LocalTrace('t1'),
        success: true,
      })
      metrics.addToolUsage({
        tool: makeTool('toolB', 'id-2'),
        duration: 2.0,
        toolTrace: new LocalTrace('t2'),
        success: false,
      })

      expect(metrics.toolMetrics).toStrictEqual({
        toolA: { callCount: 1, successCount: 1, errorCount: 0, totalTime: 1.0 },
        toolB: { callCount: 1, successCount: 0, errorCount: 1, totalTime: 2.0 },
      })
    })

    it('attaches message to trace when provided', () => {
      const toolTrace = new LocalTrace('tool')
      const message = new Message({ role: 'assistant', content: [new TextBlock('result')] })

      metrics.addToolUsage({
        tool: makeTool('myTool', 'id-1'),
        duration: 1.0,
        toolTrace,
        success: true,
        message,
      })

      expect(toolTrace.message).toBe(message)
    })
  })

  describe('updateUsage', () => {
    it('accumulates basic token counts', () => {
      metrics.updateUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
      metrics.updateUsage({ inputTokens: 20, outputTokens: 10, totalTokens: 30 })

      expect(metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 30,
        outputTokens: 15,
        totalTokens: 45,
      })
    })

    it('accumulates cache tokens across calls', () => {
      metrics.updateUsage({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cacheReadInputTokens: 3,
        cacheWriteInputTokens: 2,
      })
      metrics.updateUsage({
        inputTokens: 5,
        outputTokens: 2,
        totalTokens: 7,
        cacheReadInputTokens: 4,
      })

      expect(metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 15,
        outputTokens: 7,
        totalTokens: 22,
        cacheReadInputTokens: 7,
        cacheWriteInputTokens: 2,
      })
    })

    it('omits cache fields when source has none', () => {
      metrics.updateUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })

      expect(metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      })
    })

    it('propagates to invocation and current cycle usage', () => {
      metrics.startNewInvocation()
      metrics.startCycle()

      metrics.updateUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })

      const invocation = metrics.latestAgentInvocation!
      expect(invocation).toStrictEqual({
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        cycles: [{ agentLoopCycleId: 'cycle-1', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }],
      })
    })

    it('does not fail when no invocation exists', () => {
      expect(() => {
        metrics.updateUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
      }).not.toThrow()

      expect(metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      })
    })
  })

  describe('updateFromMetadata', () => {
    it('accumulates usage and latency from metadata', () => {
      metrics.updateFromMetadata({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        metrics: { latencyMs: 100 },
      })
      metrics.updateFromMetadata({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 10, outputTokens: 7, totalTokens: 17 },
        metrics: { latencyMs: 200 },
      })

      expect(metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 15,
        outputTokens: 10,
        totalTokens: 25,
      })
      expect(metrics.accumulatedMetrics).toStrictEqual({ latencyMs: 300 })
    })

    it('handles usage-only metadata', () => {
      metrics.updateFromMetadata({
        type: 'modelMetadataEvent',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      })

      expect(metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      })
      expect(metrics.accumulatedMetrics).toStrictEqual({ latencyMs: 0 })
    })

    it('handles metrics-only metadata', () => {
      metrics.updateFromMetadata({
        type: 'modelMetadataEvent',
        metrics: { latencyMs: 250 },
      })

      expect(metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      })
      expect(metrics.accumulatedMetrics).toStrictEqual({ latencyMs: 250 })
    })

    it('is a no-op when metadata has neither usage nor metrics', () => {
      metrics.updateFromMetadata({ type: 'modelMetadataEvent' })

      expect(metrics.accumulatedUsage).toStrictEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      })
      expect(metrics.accumulatedMetrics).toStrictEqual({ latencyMs: 0 })
    })
  })
})
