/**
 * Utilities for collecting and reporting performance metrics in the SDK.
 * Matches the Python SDK's metrics.py for parity.
 */

import { metrics as metricsApi, type Counter, type Histogram, type Meter } from '@opentelemetry/api'
import * as constants from './metrics-constants.js'
import type { Message } from '../types/messages.js'
import type { Usage, Metrics } from '../models/streaming.js'
import type { ToolUse } from './types.js'
import { logger } from '../logging/index.js'

/**
 * A trace representing a single operation or step in the execution flow.
 */
export class Trace {
  public readonly id: string
  public name: string
  public rawName?: string
  public parentId?: string
  public startTime: number
  public endTime?: number
  public children: Trace[] = []
  public metadata: Record<string, unknown> = {}
  public message?: Message

  constructor(
    name: string,
    parentId?: string,
    startTime?: number,
    rawName?: string,
    metadata?: Record<string, unknown>,
    message?: Message
  ) {
    this.id = globalThis.crypto.randomUUID()
    this.name = name
    if (rawName !== undefined) {
      this.rawName = rawName
    }
    if (parentId !== undefined) {
      this.parentId = parentId
    }
    this.startTime = startTime ?? Date.now() / 1000
    this.metadata = metadata ?? {}
    if (message !== undefined) {
      this.message = message
    }
  }

  /**
   * Mark the trace as complete with the given or current timestamp.
   */
  end(endTime?: number): void {
    this.endTime = endTime ?? Date.now() / 1000
  }

  /**
   * Add a child trace to this trace.
   */
  addChild(child: Trace): void {
    this.children.push(child)
  }

  /**
   * Calculate the duration of this trace in seconds.
   */
  duration(): number | undefined {
    return this.endTime !== undefined ? this.endTime - this.startTime : undefined
  }

  /**
   * Add a message to the trace.
   */
  addMessage(message: Message): void {
    this.message = message
  }

  /**
   * Convert the trace to a dictionary representation.
   */
  toDict(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      raw_name: this.rawName,
      parent_id: this.parentId,
      start_time: this.startTime,
      end_time: this.endTime,
      duration: this.duration(),
      children: this.children.map((child) => child.toDict()),
      metadata: this.metadata,
      message: this.message,
    }
  }
}

/**
 * Metrics for a specific tool's usage.
 */
export class ToolMetrics {
  public tool: ToolUse
  public callCount: number = 0
  public successCount: number = 0
  public errorCount: number = 0
  public totalTime: number = 0

  constructor(tool: ToolUse) {
    this.tool = tool
  }

  /**
   * Record a new tool call with its outcome.
   */
  addCall(
    tool: ToolUse,
    duration: number,
    success: boolean,
    metricsClient: MetricsClient,
    attributes?: Record<string, string | number | boolean>
  ): void {
    this.tool = tool
    this.callCount++
    this.totalTime += duration

    metricsClient.toolCallCount.add(1, attributes)
    metricsClient.toolDuration.record(duration, attributes)

    if (success) {
      this.successCount++
      metricsClient.toolSuccessCount.add(1, attributes)
    } else {
      this.errorCount++
      metricsClient.toolErrorCount.add(1, attributes)
    }
  }
}

/**
 * Aggregated metrics for a single event loop cycle.
 */
export interface EventLoopCycleMetric {
  eventLoopCycleId: string
  usage: Usage
}

/**
 * Metrics for a single agent invocation.
 */
export class AgentInvocation {
  public cycles: EventLoopCycleMetric[] = []
  public usage: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
}

/**
 * Aggregated metrics for an event loop's execution.
 */
export class EventLoopMetrics {
  public cycleCount: number = 0
  public toolMetrics: Map<string, ToolMetrics> = new Map()
  public cycleDurations: number[] = []
  public agentInvocations: AgentInvocation[] = []
  public traces: Trace[] = []
  public accumulatedUsage: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  public accumulatedMetrics: Metrics = { latencyMs: 0 }

  private get _metricsClient(): MetricsClient {
    return MetricsClient.getInstance()
  }

  /**
   * Get the most recent agent invocation.
   */
  get latestAgentInvocation(): AgentInvocation | undefined {
    return this.agentInvocations.length > 0
      ? this.agentInvocations[this.agentInvocations.length - 1]
      : undefined
  }

  /**
   * Start a new event loop cycle and create a trace for it.
   */
  startCycle(attributes: Record<string, string | number | boolean>): { startTime: number; cycleTrace: Trace } {
    this._metricsClient.eventLoopCycleCount.add(1, attributes)
    this._metricsClient.eventLoopStartCycle.add(1, attributes)
    this.cycleCount++

    const startTime = Date.now() / 1000
    const cycleTrace = new Trace(`Cycle ${this.cycleCount}`, undefined, startTime)
    this.traces.push(cycleTrace)

    // Add cycle to latest agent invocation (Python: self.agent_invocations[-1].cycles.append)
    const latestInvocation = this.latestAgentInvocation
    if (latestInvocation) {
      latestInvocation.cycles.push({
        eventLoopCycleId: attributes['event_loop_cycle_id'] as string,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      })
    }

    return { startTime, cycleTrace }
  }

  /**
   * End the current event loop cycle and record its duration.
   */
  endCycle(
    startTime: number,
    cycleTrace: Trace,
    attributes?: Record<string, string | number | boolean>,
    message?: Message
  ): void {
    this._metricsClient.eventLoopEndCycle.add(1, attributes)
    const endTime = Date.now() / 1000
    const duration = endTime - startTime

    this._metricsClient.eventLoopCycleDuration.record(duration, attributes)
    this.cycleDurations.push(duration)
    
    // Add message to trace if provided (matches Python SDK)
    if (message) {
      cycleTrace.addMessage(message)
    }
    
    cycleTrace.end(endTime)
  }

  /**
   * Record metrics for a tool invocation.
   */
  addToolUsage(
    tool: ToolUse,
    duration: number,
    toolTrace: Trace,
    success: boolean,
    message: Message
  ): void {
    const toolName = tool.name ?? 'unknown_tool'
    const toolUseId = tool.toolUseId ?? 'unknown'

    toolTrace.metadata['toolUseId'] = toolUseId
    toolTrace.metadata['tool_name'] = toolName
    toolTrace.rawName = `${toolName} - ${toolUseId}`
    toolTrace.addMessage(message)

    let toolMetric = this.toolMetrics.get(toolName)
    if (!toolMetric) {
      toolMetric = new ToolMetrics(tool)
      this.toolMetrics.set(toolName, toolMetric)
    }

    toolMetric.addCall(tool, duration, success, this._metricsClient, {
      tool_name: toolName,
      tool_use_id: toolUseId,
    })

    toolTrace.end()
  }

  /**
   * Helper method to accumulate usage from source to target.
   */
  private _accumulateUsage(target: Usage, source: Usage): void {
    target.inputTokens += source.inputTokens
    target.outputTokens += source.outputTokens
    target.totalTokens += source.totalTokens

    if (source.cacheReadInputTokens !== undefined) {
      target.cacheReadInputTokens = (target.cacheReadInputTokens ?? 0) + source.cacheReadInputTokens
    }
    if (source.cacheWriteInputTokens !== undefined) {
      target.cacheWriteInputTokens = (target.cacheWriteInputTokens ?? 0) + source.cacheWriteInputTokens
    }
  }

  /**
   * Update the accumulated token usage with new usage data.
   */
  updateUsage(usage: Usage): void {
    // Record metrics to OpenTelemetry
    this._metricsClient.eventLoopInputTokens.record(usage.inputTokens)
    this._metricsClient.eventLoopOutputTokens.record(usage.outputTokens)

    if (usage.cacheReadInputTokens !== undefined) {
      this._metricsClient.eventLoopCacheReadInputTokens.record(usage.cacheReadInputTokens)
    }
    if (usage.cacheWriteInputTokens !== undefined) {
      this._metricsClient.eventLoopCacheWriteInputTokens.record(usage.cacheWriteInputTokens)
    }

    this._accumulateUsage(this.accumulatedUsage, usage)
    
    // Update latest agent invocation usage (Python: self._accumulate_usage(self.agent_invocations[-1].usage, usage))
    const latestInvocation = this.latestAgentInvocation
    if (latestInvocation) {
      this._accumulateUsage(latestInvocation.usage, usage)

      // Update current cycle usage (Python: current_cycle = self.agent_invocations[-1].cycles[-1])
      const currentCycle = latestInvocation.cycles[latestInvocation.cycles.length - 1]
      if (currentCycle) {
        this._accumulateUsage(currentCycle.usage, usage)
      }
    }
  }

  /**
   * Start a new agent invocation by creating a new AgentInvocation.
   */
  resetUsageMetrics(): void {
    this.agentInvocations.push(new AgentInvocation())
  }

  /**
   * Update the accumulated performance metrics with new metrics data.
   */
  updateMetrics(metrics: Metrics): void {
    this._metricsClient.eventLoopLatency.record(metrics.latencyMs)
    this.accumulatedMetrics.latencyMs += metrics.latencyMs
  }

  /**
   * Generate a comprehensive summary of all collected metrics.
   */
  getSummary(): Record<string, unknown> {
    const totalDuration = this.cycleDurations.reduce((sum, d) => sum + d, 0)
    const averageCycleTime = this.cycleCount > 0 ? totalDuration / this.cycleCount : 0

    const toolUsage: Record<string, unknown> = {}
    for (const [toolName, metrics] of this.toolMetrics) {
      toolUsage[toolName] = {
        tool_info: {
          tool_use_id: metrics.tool.toolUseId ?? 'N/A',
          name: metrics.tool.name ?? 'unknown',
          input_params: metrics.tool.input ?? {},
        },
        execution_stats: {
          call_count: metrics.callCount,
          success_count: metrics.successCount,
          error_count: metrics.errorCount,
          total_time: metrics.totalTime,
          average_time: metrics.callCount > 0 ? metrics.totalTime / metrics.callCount : 0,
          success_rate: metrics.callCount > 0 ? metrics.successCount / metrics.callCount : 0,
        },
      }
    }

    return {
      total_cycles: this.cycleCount,
      total_duration: totalDuration,
      average_cycle_time: averageCycleTime,
      tool_usage: toolUsage,
      traces: this.traces.map((trace) => trace.toDict()),
      accumulated_usage: this.accumulatedUsage,
      accumulated_metrics: this.accumulatedMetrics,
      agent_invocations: this.agentInvocations.map((invocation) => ({
        usage: invocation.usage,
        cycles: invocation.cycles.map((cycle) => ({
          event_loop_cycle_id: cycle.eventLoopCycleId,
          usage: cycle.usage,
        })),
      })),
    }
  }
}

/**
 * Singleton client for managing OpenTelemetry metrics instruments.
 */
export class MetricsClient {
  private static _instance: MetricsClient | null = null

  public meter: Meter
  public eventLoopCycleCount!: Counter
  public eventLoopStartCycle!: Counter
  public eventLoopEndCycle!: Counter
  public eventLoopCycleDuration!: Histogram
  public eventLoopLatency!: Histogram
  public eventLoopInputTokens!: Histogram
  public eventLoopOutputTokens!: Histogram
  public eventLoopCacheReadInputTokens!: Histogram
  public eventLoopCacheWriteInputTokens!: Histogram
  public modelTimeToFirstToken!: Histogram
  public toolCallCount!: Counter
  public toolSuccessCount!: Counter
  public toolErrorCount!: Counter
  public toolDuration!: Histogram

  private constructor() {
    logger.info('Creating Strands MetricsClient')
    const meterProvider = metricsApi.getMeterProvider()
    this.meter = meterProvider.getMeter('strands-agents')
    this.createInstruments()
  }

  /**
   * Get the singleton instance of MetricsClient.
   */
  static getInstance(): MetricsClient {
    if (!MetricsClient._instance) {
      MetricsClient._instance = new MetricsClient()
    }
    return MetricsClient._instance
  }

  /**
   * Create and initialize all OpenTelemetry metric instruments.
   */
  private createInstruments(): void {
    this.eventLoopCycleCount = this.meter.createCounter(constants.STRANDS_EVENT_LOOP_CYCLE_COUNT, {
      unit: 'Count',
      description: 'Number of event loop cycles',
    })
    this.eventLoopStartCycle = this.meter.createCounter(constants.STRANDS_EVENT_LOOP_START_CYCLE, {
      unit: 'Count',
      description: 'Number of event loop cycle starts',
    })
    this.eventLoopEndCycle = this.meter.createCounter(constants.STRANDS_EVENT_LOOP_END_CYCLE, {
      unit: 'Count',
      description: 'Number of event loop cycle ends',
    })
    this.eventLoopCycleDuration = this.meter.createHistogram(constants.STRANDS_EVENT_LOOP_CYCLE_DURATION, {
      unit: 's',
      description: 'Duration of event loop cycles',
    })
    this.eventLoopLatency = this.meter.createHistogram(constants.STRANDS_EVENT_LOOP_LATENCY, {
      unit: 'ms',
      description: 'Event loop latency',
    })
    this.toolCallCount = this.meter.createCounter(constants.STRANDS_TOOL_CALL_COUNT, {
      unit: 'Count',
      description: 'Number of tool calls',
    })
    this.toolSuccessCount = this.meter.createCounter(constants.STRANDS_TOOL_SUCCESS_COUNT, {
      unit: 'Count',
      description: 'Number of successful tool calls',
    })
    this.toolErrorCount = this.meter.createCounter(constants.STRANDS_TOOL_ERROR_COUNT, {
      unit: 'Count',
      description: 'Number of failed tool calls',
    })
    this.toolDuration = this.meter.createHistogram(constants.STRANDS_TOOL_DURATION, {
      unit: 's',
      description: 'Duration of tool calls',
    })
    this.eventLoopInputTokens = this.meter.createHistogram(constants.STRANDS_EVENT_LOOP_INPUT_TOKENS, {
      unit: 'token',
      description: 'Input tokens per model call',
    })
    this.eventLoopOutputTokens = this.meter.createHistogram(constants.STRANDS_EVENT_LOOP_OUTPUT_TOKENS, {
      unit: 'token',
      description: 'Output tokens per model call',
    })
    this.eventLoopCacheReadInputTokens = this.meter.createHistogram(
      constants.STRANDS_EVENT_LOOP_CACHE_READ_INPUT_TOKENS,
      {
        unit: 'token',
        description: 'Cache read input tokens per model call',
      }
    )
    this.eventLoopCacheWriteInputTokens = this.meter.createHistogram(
      constants.STRANDS_EVENT_LOOP_CACHE_WRITE_INPUT_TOKENS,
      {
        unit: 'token',
        description: 'Cache write input tokens per model call',
      }
    )
    this.modelTimeToFirstToken = this.meter.createHistogram(constants.STRANDS_MODEL_TIME_TO_FIRST_TOKEN, {
      unit: 'ms',
      description: 'Time to first token from model',
    })
  }
}

/**
 * Convert event loop metrics to a human-readable string representation.
 */
export function metricsToString(eventLoopMetrics: EventLoopMetrics): string {
  const lines: string[] = []
  const summary = eventLoopMetrics.getSummary()

  lines.push('Event Loop Metrics Summary:')

  const totalCycles = summary['total_cycles'] as number
  const avgTime = summary['average_cycle_time'] as number
  const totalDuration = summary['total_duration'] as number
  lines.push(`├─ Cycles: total=${totalCycles}, avg_time=${avgTime.toFixed(3)}s, total_time=${totalDuration.toFixed(3)}s`)

  // Token display
  const usage = summary['accumulated_usage'] as Usage
  const tokenParts = [
    `in=${usage.inputTokens}`,
    `out=${usage.outputTokens}`,
    `total=${usage.totalTokens}`,
  ]
  if (usage.cacheReadInputTokens) {
    tokenParts.push(`cache_read_input_tokens=${usage.cacheReadInputTokens}`)
  }
  if (usage.cacheWriteInputTokens) {
    tokenParts.push(`cache_write_input_tokens=${usage.cacheWriteInputTokens}`)
  }
  lines.push(`├─ Tokens: ${tokenParts.join(', ')}`)

  const metrics = summary['accumulated_metrics'] as Metrics
  lines.push(`├─ Latency: ${metrics.latencyMs}ms`)

  // Tool usage
  lines.push('├─ Tool Usage:')
  const toolUsage = summary['tool_usage'] as Record<string, unknown>
  for (const [toolName, toolData] of Object.entries(toolUsage)) {
    const data = toolData as Record<string, unknown>
    const execStats = data['execution_stats'] as Record<string, number>
    lines.push(`   └─ ${toolName}:`)
    lines.push(`      ├─ Stats: calls=${execStats['call_count']}, success=${execStats['success_count']}`)
    const errorCount = execStats['error_count'] ?? 0
    const successRate = execStats['success_rate'] ?? 0
    const avgTime = execStats['average_time'] ?? 0
    const totalTime = execStats['total_time'] ?? 0
    lines.push(`      │         errors=${errorCount}, success_rate=${(successRate * 100).toFixed(1)}%`)
    lines.push(`      └─ Timing: avg=${avgTime.toFixed(3)}s, total=${totalTime.toFixed(3)}s`)
  }

  // Execution trace
  lines.push('├─ Execution Trace:')
  const traces = summary['traces'] as Record<string, unknown>[]
  for (const trace of traces) {
    lines.push(...traceToLines(trace, 1))
  }

  return lines.join('\n')
}

/**
 * Convert a trace to formatted text lines.
 */
function traceToLines(trace: Record<string, unknown>, indent: number): string[] {
  const lines: string[] = []
  const duration = trace['duration'] as number | undefined
  const durationStr = duration !== undefined ? `${duration.toFixed(4)}s` : 'N/A'
  const rawName = trace['raw_name'] as string | undefined
  const name = rawName ?? (trace['name'] as string)

  lines.push(`${'   '.repeat(indent)}└─ ${name} - Duration: ${durationStr}`)

  const children = trace['children'] as Record<string, unknown>[]
  for (const child of children) {
    lines.push(...traceToLines(child, indent + 1))
  }

  return lines
}
