/**
 * Test helpers for asserting on LoopMetrics in agent tests.
 * Provides structured matchers instead of opaque expect.any(LoopMetrics) checks.
 */

import { expect } from 'vitest'
import { AgentLoopMetrics } from '../telemetry/metrics.js'

/**
 * Options for building a LoopMetrics matcher.
 */
export interface LoopMetricsMatcher {
  /**
   * Expected number of agent loop cycles.
   */
  cycleCount: number

  /**
   * Expected tool names that were invoked. Empty array means no tools.
   */
  toolNames?: string[]
}

/**
 * Creates an asymmetric matcher that validates LoopMetrics structure and values.
 *
 * Asserts on known deterministic fields (cycleCount, toolMetrics keys, invocation count)
 * while using appropriate matchers for dynamic values (durations, timestamps).
 *
 * @param options - Expected metric values
 * @returns An asymmetric matcher suitable for use in expect().toEqual()
 *
 * @example
 * ```typescript
 * expect(result).toEqual(
 *   new AgentResult({
 *     stopReason: 'endTurn',
 *     lastMessage: expect.objectContaining({ role: 'assistant' }),
 *     metrics: expectLoopMetrics({ cycleCount: 1 }),
 *   })
 * )
 * ```
 */
export function expectLoopMetrics(options: LoopMetricsMatcher): AgentLoopMetrics {
  const { cycleCount, toolNames = [] } = options

  const expectedToolMetrics: Record<string, unknown> = {}
  for (const name of toolNames) {
    expectedToolMetrics[name] = {
      callCount: expect.any(Number),
      successCount: expect.any(Number),
      errorCount: expect.any(Number),
      totalTime: expect.any(Number),
    }
  }

  return expect.objectContaining({
    cycleCount,
    toolMetrics: toolNames.length > 0 ? expect.objectContaining(expectedToolMetrics) : {},
    cycleDurations: expect.arrayContaining(Array.from({ length: cycleCount }, () => expect.any(Number))),
    accumulatedUsage: expect.objectContaining({
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      totalTokens: expect.any(Number),
    }),
    accumulatedMetrics: { latencyMs: expect.any(Number) },
    agentInvocations: expect.arrayContaining([
      expect.objectContaining({
        usage: expect.objectContaining({
          inputTokens: expect.any(Number),
          outputTokens: expect.any(Number),
          totalTokens: expect.any(Number),
        }),
        cycles: expect.arrayContaining(
          Array.from({ length: cycleCount }, () =>
            expect.objectContaining({
              agentLoopCycleId: expect.any(String),
              usage: expect.objectContaining({
                inputTokens: expect.any(Number),
                outputTokens: expect.any(Number),
                totalTokens: expect.any(Number),
              }),
            })
          )
        ),
      }),
    ]),
  }) as AgentLoopMetrics
}
