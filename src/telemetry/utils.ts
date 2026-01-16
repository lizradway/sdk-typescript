/**
 * Shared utilities for telemetry adapters and providers.
 *
 * This module contains common functions used across telemetry implementations
 * to avoid code duplication.
 */

import type { Usage } from './types.js'
import type { AgentData } from '../types/agent.js'

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
 * Extracts the model ID from an agent.
 * Falls back to the model's constructor name if modelId is not configured.
 *
 * @param agent - The agent to extract the model ID from
 * @returns The model ID string
 */
export function getModelId(agent: AgentData): string {
  const modelConfig = agent.model.getConfig()
  return modelConfig.modelId || agent.model.constructor.name
}
