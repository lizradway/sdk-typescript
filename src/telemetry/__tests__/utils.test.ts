/**
 * Tests for telemetry utility functions.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createEmptyUsage,
  accumulateUsage,
  getModelId,
} from '../utils.js'
import type { AgentData } from '../../types/agent.js'

describe('Telemetry Utils', () => {
  describe('createEmptyUsage', () => {
    it('should create an empty Usage object with all zeros', () => {
      const usage = createEmptyUsage()

      expect(usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      })
    })

    it('should create a new object each time', () => {
      const usage1 = createEmptyUsage()
      const usage2 = createEmptyUsage()

      expect(usage1).not.toBe(usage2)
    })
  })

  describe('accumulateUsage', () => {
    it('should accumulate usage into target', () => {
      const target = createEmptyUsage()
      const source = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheReadInputTokens: 10,
        cacheWriteInputTokens: 5,
      }

      accumulateUsage(target, source)

      expect(target).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheReadInputTokens: 10,
        cacheWriteInputTokens: 5,
      })
    })

    it('should accumulate multiple sources', () => {
      const target = createEmptyUsage()

      accumulateUsage(target, { inputTokens: 100, outputTokens: 50, totalTokens: 150 })
      accumulateUsage(target, { inputTokens: 200, outputTokens: 100, totalTokens: 300 })

      expect(target).toEqual({
        inputTokens: 300,
        outputTokens: 150,
        totalTokens: 450,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      })
    })

    it('should handle undefined cache tokens in source', () => {
      const target = createEmptyUsage()
      target.cacheReadInputTokens = 10
      target.cacheWriteInputTokens = 5

      accumulateUsage(target, { inputTokens: 100, outputTokens: 50, totalTokens: 150 })

      expect(target.cacheReadInputTokens).toBe(10)
      expect(target.cacheWriteInputTokens).toBe(5)
    })

    it('should handle undefined cache tokens in both target and source', () => {
      const target = createEmptyUsage()
      // Simulate undefined cache tokens by casting to unknown first
      delete (target as unknown as Record<string, unknown>).cacheReadInputTokens
      delete (target as unknown as Record<string, unknown>).cacheWriteInputTokens

      accumulateUsage(target, { inputTokens: 100, outputTokens: 50, totalTokens: 150 })

      expect(target.inputTokens).toBe(100)
      expect(target.outputTokens).toBe(50)
      expect(target.totalTokens).toBe(150)
      expect(target.cacheReadInputTokens).toBe(0)
      expect(target.cacheWriteInputTokens).toBe(0)
    })
  })

  describe('getModelId', () => {
    it('should return modelId from config when available', () => {
      const mockAgent = {
        model: {
          getConfig: vi.fn().mockReturnValue({ modelId: 'anthropic.claude-3-5-sonnet' }),
          constructor: { name: 'BedrockModel' },
        },
      } as unknown as AgentData

      const result = getModelId(mockAgent)

      expect(result).toBe('anthropic.claude-3-5-sonnet')
    })

    it('should fall back to constructor name when modelId is not set', () => {
      const mockAgent = {
        model: {
          getConfig: vi.fn().mockReturnValue({}),
          constructor: { name: 'OpenAIModel' },
        },
      } as unknown as AgentData

      const result = getModelId(mockAgent)

      expect(result).toBe('OpenAIModel')
    })

    it('should fall back to constructor name when modelId is empty string', () => {
      const mockAgent = {
        model: {
          getConfig: vi.fn().mockReturnValue({ modelId: '' }),
          constructor: { name: 'CustomModel' },
        },
      } as unknown as AgentData

      const result = getModelId(mockAgent)

      expect(result).toBe('CustomModel')
    })
  })
})
