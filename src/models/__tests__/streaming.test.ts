import { describe, it, expect } from 'vitest'
import { createEmptyUsage, accumulateUsage, type Usage } from '../streaming.js'

describe('streaming utilities', () => {
  describe('createEmptyUsage', () => {
    it('should create a Usage object with all counters set to zero', () => {
      const usage = createEmptyUsage()

      expect(usage).toStrictEqual({
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
    it('should accumulate usage from source into target', () => {
      const target: Usage = {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      }

      const source: Usage = {
        inputTokens: 5,
        outputTokens: 10,
        totalTokens: 15,
      }

      accumulateUsage(target, source)

      expect(target).toStrictEqual({
        inputTokens: 15,
        outputTokens: 30,
        totalTokens: 45,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      })
    })

    it('should handle cache tokens when both have values', () => {
      const target: Usage = {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        cacheReadInputTokens: 5,
        cacheWriteInputTokens: 3,
      }

      const source: Usage = {
        inputTokens: 5,
        outputTokens: 10,
        totalTokens: 15,
        cacheReadInputTokens: 2,
        cacheWriteInputTokens: 1,
      }

      accumulateUsage(target, source)

      expect(target).toStrictEqual({
        inputTokens: 15,
        outputTokens: 30,
        totalTokens: 45,
        cacheReadInputTokens: 7,
        cacheWriteInputTokens: 4,
      })
    })

    it('should handle cache tokens when target has undefined values', () => {
      const target: Usage = {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      }

      const source: Usage = {
        inputTokens: 5,
        outputTokens: 10,
        totalTokens: 15,
        cacheReadInputTokens: 2,
        cacheWriteInputTokens: 1,
      }

      accumulateUsage(target, source)

      expect(target).toStrictEqual({
        inputTokens: 15,
        outputTokens: 30,
        totalTokens: 45,
        cacheReadInputTokens: 2,
        cacheWriteInputTokens: 1,
      })
    })

    it('should handle cache tokens when source has undefined values', () => {
      const target: Usage = {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        cacheReadInputTokens: 5,
        cacheWriteInputTokens: 3,
      }

      const source: Usage = {
        inputTokens: 5,
        outputTokens: 10,
        totalTokens: 15,
      }

      accumulateUsage(target, source)

      expect(target).toStrictEqual({
        inputTokens: 15,
        outputTokens: 30,
        totalTokens: 45,
        cacheReadInputTokens: 5,
        cacheWriteInputTokens: 3,
      })
    })

    it('should mutate target in place', () => {
      const target: Usage = createEmptyUsage()
      const originalTarget = target

      const source: Usage = {
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
      }

      accumulateUsage(target, source)

      expect(target).toBe(originalTarget)
    })

    it('should handle zero values correctly', () => {
      const target: Usage = createEmptyUsage()
      const source: Usage = createEmptyUsage()

      accumulateUsage(target, source)

      expect(target).toStrictEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      })
    })

    it('should handle large values correctly', () => {
      const target: Usage = {
        inputTokens: 1000000,
        outputTokens: 2000000,
        totalTokens: 3000000,
      }

      const source: Usage = {
        inputTokens: 500000,
        outputTokens: 1000000,
        totalTokens: 1500000,
      }

      accumulateUsage(target, source)

      expect(target).toStrictEqual({
        inputTokens: 1500000,
        outputTokens: 3000000,
        totalTokens: 4500000,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      })
    })
  })
})
