/**
 * Loop metrics tracking for agent execution.
 *
 * Provides local metrics accumulation for cycle counts, token usage,
 * tool execution stats, and model latency.
 */

import { randomUUID } from 'node:crypto'
import type { Attributes, Meter, Counter, Histogram } from '@opentelemetry/api'
import { metrics as otelMetrics } from '@opentelemetry/api'
import type { Usage, Metrics, ModelMetadataEventData } from '../models/streaming.js'
import type { Message } from '../types/messages.js'
import type { ToolUse } from '../tools/types.js'
import { getServiceName } from './config.js'

/**
 * Creates an empty Usage object with all counters set to zero.
 *
 * @returns A Usage object with zeroed counters
 */
function createEmptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  }
}

/**
 * Accumulates token usage from a source into a target Usage object.
 *
 * @param target - The Usage object to accumulate into (mutated in place)
 * @param source - The Usage object to accumulate from
 */
function accumulateUsage(target: Usage, source: Usage): void {
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

// Metric name constants
const STRANDS_AGENT_LOOP_CYCLE_COUNT = 'strands.agent_loop.cycle_count'
const STRANDS_AGENT_LOOP_START_CYCLE = 'strands.agent_loop.start_cycle'
const STRANDS_AGENT_LOOP_END_CYCLE = 'strands.agent_loop.end_cycle'
const STRANDS_AGENT_LOOP_CYCLE_DURATION = 'strands.agent_loop.cycle_duration'
const STRANDS_AGENT_LOOP_INPUT_TOKENS = 'strands.agent_loop.input.tokens'
const STRANDS_AGENT_LOOP_OUTPUT_TOKENS = 'strands.agent_loop.output.tokens'
const STRANDS_AGENT_LOOP_CACHE_READ_INPUT_TOKENS = 'strands.agent_loop.cache_read.input.tokens'
const STRANDS_AGENT_LOOP_CACHE_WRITE_INPUT_TOKENS = 'strands.agent_loop.cache_write.input.tokens'
const STRANDS_AGENT_LOOP_LATENCY = 'strands.agent_loop.latency'
const STRANDS_MODEL_TIME_TO_FIRST_TOKEN = 'strands.model.time_to_first_token'
const STRANDS_TOOL_CALL_COUNT = 'strands.tool.call_count'
const STRANDS_TOOL_DURATION = 'strands.tool.duration'
const STRANDS_TOOL_SUCCESS_COUNT = 'strands.tool.success_count'
const STRANDS_TOOL_ERROR_COUNT = 'strands.tool.error_count'

/**
 * Execution trace for performance analysis.
 * Tracks timing and hierarchy of operations within the agent loop.
 * Fields default to null for JSON serialization compatibility.
 */
export class LocalTrace {
  /**
   * Unique identifier for this trace.
   */
  readonly id: string

  /**
   * Display name for this trace.
   */
  readonly name: string

  /**
   * Raw name before formatting.
   */
  rawName: string | null = null

  /**
   * Parent trace identifier.
   */
  readonly parentId: string | null

  /**
   * Start time in seconds since epoch.
   */
  readonly startTime: number

  /**
   * End time in seconds since epoch.
   */
  endTime: number | null = null

  /**
   * Duration in seconds, computed when end() is called.
   */
  duration: number = 0

  /**
   * Child traces.
   */
  readonly children: LocalTrace[] = []

  /**
   * Metadata associated with this trace.
   */
  readonly metadata: Record<string, unknown> = {}

  /**
   * Message associated with this trace.
   */
  message: Message | null = null

  constructor(name: string, parentTrace?: LocalTrace, startTime?: number) {
    this.id = randomUUID()
    this.name = name
    this.parentId = parentTrace?.id ?? null
    this.startTime = startTime ?? Date.now() / 1000

    if (parentTrace) {
      parentTrace.children.push(this)
    }
  }

  /**
   * End this trace, recording the end time and computing duration.
   *
   * @param endTime - Optional end time in seconds since epoch
   */
  end(endTime?: number): void {
    this.endTime = endTime ?? Date.now() / 1000
    this.duration = this.endTime - this.startTime
  }
}

/**
 * Per-tool execution metrics.
 */
export interface ToolMetricsData {
  /**
   * Total number of calls to this tool.
   */
  callCount: number

  /**
   * Number of successful calls.
   */
  successCount: number

  /**
   * Number of failed calls.
   */
  errorCount: number

  /**
   * Total execution time in seconds.
   */
  totalTime: number
}

/**
 * Per-cycle usage tracking.
 */
export interface AgentLoopCycleMetric {
  /**
   * Unique identifier for this cycle.
   */
  agentLoopCycleId: string

  /**
   * Token usage for this cycle.
   */
  usage: Usage
}

/**
 * Per-invocation metrics tracking.
 */
export interface AgentInvocation {
  /**
   * Cycle metrics for this invocation.
   */
  cycles: AgentLoopCycleMetric[]

  /**
   * Accumulated token usage for this invocation.
   */
  usage: Usage
}

/**
 * Options for recording tool usage.
 */
export interface ToolUsageOptions {
  /**
   * The tool that was used.
   */
  tool: ToolUse

  /**
   * Execution duration in seconds.
   */
  duration: number

  /**
   * Trace for this tool call.
   */
  toolTrace: LocalTrace

  /**
   * Whether the tool call succeeded.
   */
  success: boolean

  /**
   * The message associated with the tool call.
   */
  message?: Message
}

/**
 * OpenTelemetry meter instruments for emitting metrics.
 * Lazily initialized on first access.
 */
class MetricsClient {
  private readonly _meter: Meter

  readonly agentLoopCycleCount: Counter
  readonly agentLoopStartCycle: Counter
  readonly agentLoopEndCycle: Counter
  readonly agentLoopCycleDuration: Histogram
  readonly agentLoopInputTokens: Histogram
  readonly agentLoopOutputTokens: Histogram
  readonly agentLoopCacheReadInputTokens: Histogram
  readonly agentLoopCacheWriteInputTokens: Histogram
  readonly agentLoopLatency: Histogram
  readonly modelTimeToFirstToken: Histogram
  readonly toolCallCount: Counter
  readonly toolDuration: Histogram
  readonly toolSuccessCount: Counter
  readonly toolErrorCount: Counter

  constructor() {
    this._meter = otelMetrics.getMeter(getServiceName())

    this.agentLoopCycleCount = this._meter.createCounter(STRANDS_AGENT_LOOP_CYCLE_COUNT)
    this.agentLoopStartCycle = this._meter.createCounter(STRANDS_AGENT_LOOP_START_CYCLE)
    this.agentLoopEndCycle = this._meter.createCounter(STRANDS_AGENT_LOOP_END_CYCLE)
    this.agentLoopCycleDuration = this._meter.createHistogram(STRANDS_AGENT_LOOP_CYCLE_DURATION)
    this.agentLoopInputTokens = this._meter.createHistogram(STRANDS_AGENT_LOOP_INPUT_TOKENS)
    this.agentLoopOutputTokens = this._meter.createHistogram(STRANDS_AGENT_LOOP_OUTPUT_TOKENS)
    this.agentLoopCacheReadInputTokens = this._meter.createHistogram(STRANDS_AGENT_LOOP_CACHE_READ_INPUT_TOKENS)
    this.agentLoopCacheWriteInputTokens = this._meter.createHistogram(STRANDS_AGENT_LOOP_CACHE_WRITE_INPUT_TOKENS)
    this.agentLoopLatency = this._meter.createHistogram(STRANDS_AGENT_LOOP_LATENCY)
    this.modelTimeToFirstToken = this._meter.createHistogram(STRANDS_MODEL_TIME_TO_FIRST_TOKEN)
    this.toolCallCount = this._meter.createCounter(STRANDS_TOOL_CALL_COUNT)
    this.toolDuration = this._meter.createHistogram(STRANDS_TOOL_DURATION)
    this.toolSuccessCount = this._meter.createCounter(STRANDS_TOOL_SUCCESS_COUNT)
    this.toolErrorCount = this._meter.createCounter(STRANDS_TOOL_ERROR_COUNT)
  }
}

let _metricsClient: MetricsClient | null = null

/**
 * Get the singleton MetricsClient, lazily initialized on first access.
 * Returns a no-op meter if setupMeter() hasn't been called.
 *
 * @returns The MetricsClient instance
 */
function getMetricsClient(): MetricsClient {
  if (!_metricsClient) {
    _metricsClient = new MetricsClient()
  }
  return _metricsClient
}

/**
 * Summary of all collected metrics.
 */
export interface LoopMetricsSummary {
  /**
   * Total number of agent loop cycles.
   */
  totalCycles: number

  /**
   * Total duration of all cycles in seconds.
   */
  totalDuration: number

  /**
   * Average cycle time in seconds.
   */
  averageCycleTime: number

  /**
   * Per-tool execution statistics.
   */
  toolUsage: Record<
    string,
    {
      callCount: number
      successCount: number
      errorCount: number
      totalTime: number
      averageTime: number
      successRate: number
    }
  >

  /**
   * Execution traces.
   */
  traces: LocalTrace[]

  /**
   * Accumulated token usage across all invocations.
   */
  accumulatedUsage: Usage

  /**
   * Accumulated model latency metrics across all invocations.
   */
  accumulatedMetrics: { latencyMs: number }

  /**
   * Per-invocation metrics.
   */
  agentInvocations: {
    usage: Usage
    cycles: { agentLoopCycleId: string; usage: Usage }[]
  }[]
}

/**
 * Aggregated metrics for an agent's loop execution.
 *
 * Tracks cycle counts, tool usage, execution durations, and token consumption
 * across all model invocations. Mirrors the Python SDK's AgentLoopMetrics class.
 *
 * @example
 * ```typescript
 * const result = await agent.invoke('Hello')
 * console.log(result.metrics.cycleCount)
 * console.log(result.metrics.accumulatedUsage)
 * console.log(result.metrics.toolMetrics)
 * console.log(result.metrics.getSummary())
 * ```
 */
export class LoopMetrics {
  /**
   * Number of agent loop cycles executed.
   */
  cycleCount: number = 0

  /**
   * Per-tool execution metrics keyed by tool name.
   */
  readonly toolMetrics: Record<string, ToolMetricsData> = {}

  /**
   * Duration of each cycle in seconds.
   */
  readonly cycleDurations: number[] = []

  /**
   * Per-invocation metrics.
   */
  readonly agentInvocations: AgentInvocation[] = []

  /**
   * Execution traces.
   */
  readonly traces: LocalTrace[] = []

  /**
   * Accumulated token usage across all model invocations.
   */
  readonly accumulatedUsage: Usage = createEmptyUsage()

  /**
   * Accumulated performance metrics across all model invocations.
   */
  readonly accumulatedMetrics: Metrics = { latencyMs: 0 }

  /**
   * The most recent agent invocation, or undefined if none exist.
   */
  get latestAgentInvocation(): AgentInvocation | undefined {
    return this.agentInvocations.length > 0 ? this.agentInvocations[this.agentInvocations.length - 1] : undefined
  }

  /**
   * Start a new agent loop cycle and create a trace for it.
   *
   * @returns The start time and cycle trace
   */
  startCycle(): { cycleId: string; startTime: number; cycleTrace: LocalTrace } {
    this.cycleCount++

    const client = getMetricsClient()
    const cycleId = `cycle-${this.cycleCount}`
    const attrs: Attributes = { agentLoopCycleId: cycleId }

    client.agentLoopCycleCount.add(1, attrs)
    client.agentLoopStartCycle.add(1, attrs)

    const startTime = Date.now() / 1000
    const cycleTrace = new LocalTrace(`Cycle ${this.cycleCount}`, undefined, startTime)
    this.traces.push(cycleTrace)

    const latestInvocation = this.latestAgentInvocation
    if (latestInvocation) {
      latestInvocation.cycles.push({
        agentLoopCycleId: cycleId,
        usage: createEmptyUsage(),
      })
    }

    return { cycleId, startTime, cycleTrace }
  }

  /**
   * End the current agent loop cycle and record its duration.
   *
   * @param startTime - The timestamp when the cycle started (seconds since epoch)
   * @param cycleTrace - The trace object for this cycle
   */
  endCycle(startTime: number, cycleTrace: LocalTrace): void {
    const client = getMetricsClient()
    const attrs: Attributes = { agentLoopCycleId: `cycle-${this.cycleCount}` }

    client.agentLoopEndCycle.add(1, attrs)

    const endTime = Date.now() / 1000
    const duration = endTime - startTime

    client.agentLoopCycleDuration.record(duration, attrs)

    this.cycleDurations.push(duration)
    cycleTrace.end(endTime)
  }

  /**
   * Record metrics for a tool invocation.
   *
   * @param options - Tool usage recording options
   */
  addToolUsage(options: ToolUsageOptions): void {
    const { tool, duration, toolTrace, success, message } = options
    const toolName = tool.name ?? 'unknown_tool'
    const toolUseId = tool.toolUseId ?? 'unknown'

    toolTrace.metadata['toolUseId'] = toolUseId
    toolTrace.metadata['tool_name'] = toolName
    toolTrace.rawName = `${toolName} - ${toolUseId}`

    if (message !== undefined) {
      toolTrace.message = message
    }

    // Update local tool metrics
    if (!this.toolMetrics[toolName]) {
      this.toolMetrics[toolName] = { callCount: 0, successCount: 0, errorCount: 0, totalTime: 0 }
    }
    const tm = this.toolMetrics[toolName]!
    tm.callCount++
    tm.totalTime += duration
    if (success) {
      tm.successCount++
    } else {
      tm.errorCount++
    }

    // Emit OTEL metrics
    const client = getMetricsClient()
    const otelAttrs = { tool_name: toolName, tool_use_id: toolUseId }
    client.toolCallCount.add(1, otelAttrs)
    client.toolDuration.record(duration, otelAttrs)
    if (success) {
      client.toolSuccessCount.add(1, otelAttrs)
    } else {
      client.toolErrorCount.add(1, otelAttrs)
    }

    toolTrace.end()
  }

  /**
   * Update the accumulated token usage with new usage data.
   *
   * @param usage - The usage data to accumulate
   */
  updateUsage(usage: Usage): void {
    const client = getMetricsClient()

    client.agentLoopInputTokens.record(usage.inputTokens)
    client.agentLoopOutputTokens.record(usage.outputTokens)

    if (usage.cacheReadInputTokens !== undefined) {
      client.agentLoopCacheReadInputTokens.record(usage.cacheReadInputTokens)
    }
    if (usage.cacheWriteInputTokens !== undefined) {
      client.agentLoopCacheWriteInputTokens.record(usage.cacheWriteInputTokens)
    }

    accumulateUsage(this.accumulatedUsage, usage)

    const latestInvocation = this.latestAgentInvocation
    if (latestInvocation) {
      accumulateUsage(latestInvocation.usage, usage)

      const cycles = latestInvocation.cycles
      if (cycles.length > 0) {
        accumulateUsage(cycles[cycles.length - 1]!.usage, usage)
      }
    }
  }

  /**
   * Update accumulated usage and metrics from a model metadata event.
   *
   * @param metadata - The metadata event from a model invocation
   */
  updateFromMetadata(metadata: ModelMetadataEventData): void {
    if (metadata.usage) {
      this.updateUsage(metadata.usage)
    }
    if (metadata.metrics) {
      this.accumulatedMetrics.latencyMs += metadata.metrics.latencyMs

      const client = getMetricsClient()
      client.agentLoopLatency.record(metadata.metrics.latencyMs)
    }
  }

  /**
   * Start a new agent invocation by creating a new AgentInvocation entry.
   * Call this at the start of each new request.
   */
  resetUsageMetrics(): void {
    this.agentInvocations.push({
      cycles: [],
      usage: createEmptyUsage(),
    })
  }

  /**
   * Generate a comprehensive summary of all collected metrics.
   *
   * @returns A dictionary containing summarized metrics data
   */
  getSummary(): LoopMetricsSummary {
    const totalDuration = this.cycleDurations.reduce((sum, d) => sum + d, 0)

    const toolUsage: LoopMetricsSummary['toolUsage'] = {}
    for (const [name, tm] of Object.entries(this.toolMetrics)) {
      toolUsage[name] = {
        callCount: tm.callCount,
        successCount: tm.successCount,
        errorCount: tm.errorCount,
        totalTime: tm.totalTime,
        averageTime: tm.callCount > 0 ? tm.totalTime / tm.callCount : 0,
        successRate: tm.callCount > 0 ? tm.successCount / tm.callCount : 0,
      }
    }

    return {
      totalCycles: this.cycleCount,
      totalDuration,
      averageCycleTime: this.cycleCount > 0 ? totalDuration / this.cycleCount : 0,
      toolUsage,
      traces: this.traces,
      accumulatedUsage: this.accumulatedUsage,
      accumulatedMetrics: { latencyMs: this.accumulatedMetrics.latencyMs },
      agentInvocations: this.agentInvocations.map((inv) => ({
        usage: inv.usage,
        cycles: inv.cycles.map((c) => ({
          agentLoopCycleId: c.agentLoopCycleId,
          usage: c.usage,
        })),
      })),
    }
  }
}
