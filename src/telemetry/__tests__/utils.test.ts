import { describe, it, expect, vi } from 'vitest'
import { createEmptyUsage, accumulateUsage, getModelId } from '../utils.js'
import type { Model } from '../../models/model.js'

describe('telemetry utils', () => {
  describe('createEmptyUsage', () => {
    it('should create a usage object with all counters set to zero', () => {
      const usage = createEmptyUsage()

      expect(usage.inputTokens).toBe(0)
      expect(usage.outputTokens).toBe(0)
      expect(usage.totalTokens).toBe(0)
      expect(usage.cacheReadInputTokens).toBe(0)
      expect(usage.cacheWriteInputTokens).toBe(0)
    })

    it('should create a new object each time', () => {
      const usage1 = createEmptyUsage()
      const usage2 = createEmptyUsage()

      expect(usage1).not.toBe(usage2)
    })
  })

  describe('accumulateUsage', () => {
    it('should accumulate usage from source into target', () => {
      const target = createEmptyUsage()
      const source = {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        cacheReadInputTokens: 5,
        cacheWriteInputTokens: 3,
      }

      accumulateUsage(target, source)

      expect(target.inputTokens).toBe(10)
      expect(target.outputTokens).toBe(20)
      expect(target.totalTokens).toBe(30)
      expect(target.cacheReadInputTokens).toBe(5)
      expect(target.cacheWriteInputTokens).toBe(3)
    })

    it('should accumulate multiple sources', () => {
      const target = createEmptyUsage()
      const source1 = {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      }
      const source2 = {
        inputTokens: 5,
        outputTokens: 15,
        totalTokens: 20,
      }

      accumulateUsage(target, source1)
      accumulateUsage(target, source2)

      expect(target.inputTokens).toBe(15)
      expect(target.outputTokens).toBe(35)
      expect(target.totalTokens).toBe(50)
    })

    it('should handle undefined cache tokens in source', () => {
      const target = createEmptyUsage()
      const source = {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        // cacheReadInputTokens and cacheWriteInputTokens are undefined
      }

      accumulateUsage(target, source)

      expect(target.cacheReadInputTokens).toBe(0)
      expect(target.cacheWriteInputTokens).toBe(0)
    })
  })

  describe('getModelId', () => {
    it('should return modelId from config when available', () => {
      const mockModel = {
        getConfig: vi.fn().mockReturnValue({ modelId: 'test-model-id' }),
        constructor: { name: 'MockModel' },
      } as unknown as Model

      const result = getModelId(mockModel)

      expect(result).toBe('test-model-id')
    })

    it('should fall back to constructor name when modelId is not configured', () => {
      const mockModel = {
        getConfig: vi.fn().mockReturnValue({}),
        constructor: { name: 'BedrockModel' },
      } as unknown as Model

      const result = getModelId(mockModel)

      expect(result).toBe('BedrockModel')
    })

    it('should fall back to constructor name when modelId is empty string', () => {
      const mockModel = {
        getConfig: vi.fn().mockReturnValue({ modelId: '' }),
        constructor: { name: 'OpenAIModel' },
      } as unknown as Model

      const result = getModelId(mockModel)

      expect(result).toBe('OpenAIModel')
    })
  })
})
