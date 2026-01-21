/**
 * Type definitions for OpenTelemetry telemetry support.
 */

import type { Model } from '../models/model.js'

/**
 * Telemetry configuration options for the Tracer.
 */
export interface TelemetryConfig {
  /**
   * Custom trace attributes to include in all spans.
   */
  customTraceAttributes?: Record<string, AttributeValue> | undefined
}

/**
 * OpenTelemetry attribute value types.
 * Must match OpenTelemetry API's AttributeValue type.
 */
export type AttributeValue = 
  | string 
  | number 
  | boolean 
  | Array<null | undefined | string> 
  | Array<null | undefined | number> 
  | Array<null | undefined | boolean>

/**
 * Token usage statistics for a model invocation.
 */
export interface Usage {
  /** Number of tokens in the input (prompt). */
  inputTokens: number
  /** Number of tokens in the output (completion). */
  outputTokens: number
  /** Total number of tokens (input + output). */
  totalTokens: number
  /** Number of input tokens read from cache. */
  cacheReadInputTokens?: number
  /** Number of input tokens written to cache. */
  cacheWriteInputTokens?: number
}

/**
 * Performance metrics for a model invocation.
 */
export interface Metrics {
  /** Time to first byte/token in milliseconds. */
  timeToFirstByteMs?: number
  /** Total latency in milliseconds. */
  latencyMs?: number
}

/**
 * Tool use information for tracing.
 */
export interface ToolUse {
  name: string
  toolUseId: string
  input: unknown
}

/**
 * Tool result information for tracing.
 */
export interface ToolResult {
  toolUseId: string
  status: 'success' | 'error'
  content: unknown
}

/**
 * Creates an empty usage object with all counters set to zero.
 *
 * @returns A new Usage object with zeroed values
 */
export function createEmptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
  }
}

/**
 * Accumulates usage from a source into a target usage object.
 * Mutates the target object in place.
 *
 * @param target - The usage object to accumulate into
 * @param source - The usage data to add
 */
export function accumulateUsage(target: Usage, source: Usage): void {
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  target.totalTokens += source.totalTokens
  target.cacheReadInputTokens = (target.cacheReadInputTokens ?? 0) + (source.cacheReadInputTokens ?? 0)
  target.cacheWriteInputTokens = (target.cacheWriteInputTokens ?? 0) + (source.cacheWriteInputTokens ?? 0)
}

/**
 * Extracts the model ID from a model instance.
 * Falls back to the model's constructor name if modelId is not configured.
 *
 * @param model - The model to extract the model ID from
 * @returns The model ID string
 */
export function getModelId(model: Model): string {
  const modelConfig = model.getConfig()
  return modelConfig.modelId || model.constructor.name
}
