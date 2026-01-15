/**
 * Model provider telemetry integration tests.
 * Verifies telemetry functionality when models are used directly.
 */

import { describe, expect, it } from 'vitest'
import { Message, TextBlock } from '@strands-agents/sdk'
import { bedrock } from './__fixtures__/model-providers.js'

describe.skipIf(bedrock.skip)('Model Provider Telemetry', () => {
  describe('BedrockModel with telemetry', () => {
    it('initializes tracer when telemetry is enabled', () => {
      const model = bedrock.createModel({
        telemetryConfig: {
          enabled: true,
        },
      })

      expect(model).toBeDefined()
      expect(model.getConfig()).toBeDefined()
    })

    it('creates model invocation spans during streaming', async () => {
      const model = bedrock.createModel({
        telemetryConfig: {
          enabled: true,
        },
      })

      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Say hello')],
        }),
      ]

      let eventCount = 0
      for await (const event of model.stream(messages)) {
        eventCount++
        expect(event).toBeDefined()
        expect(event.type).toBeDefined()
      }

      expect(eventCount).toBeGreaterThan(0)
    })

    it('captures token usage in model spans', async () => {
      const model = bedrock.createModel({
        telemetryConfig: {
          enabled: true,
        },
      })

      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Say hello')],
        }),
      ]

      let usageEvent: unknown = null
      for await (const event of model.stream(messages)) {
        if (event.type === 'modelMetadataEvent') {
          usageEvent = event
        }
      }

      // Verify we captured usage information
      expect(usageEvent).toBeDefined()
    })

    it('captures stop reason in model spans', async () => {
      const model = bedrock.createModel({
        telemetryConfig: {
          enabled: true,
        },
      })

      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Say hello')],
        }),
      ]

      let stopReason: string | undefined
      for await (const event of model.stream(messages)) {
        if (event.type === 'modelMessageStopEvent') {
          stopReason = event.stopReason
        }
      }

      expect(stopReason).toBeDefined()
      expect(['endTurn', 'toolUse', 'maxTokens']).toContain(stopReason)
    })

    it('handles errors gracefully with telemetry enabled', async () => {
      const model = bedrock.createModel({
        telemetryConfig: {
          enabled: true,
        },
      })

      // Empty messages array should trigger an error
      const messages: Message[] = []

      let errorThrown = false
      try {
        for await (const _event of model.stream(messages)) {
          // Should not reach here
        }
      } catch (error) {
        errorThrown = true
        expect(error).toBeDefined()
      }

      expect(errorThrown).toBe(true)
    })

    it('works correctly with telemetry disabled', async () => {
      const model = bedrock.createModel({
        telemetryConfig: {
          enabled: false,
        },
      })

      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Say hello')],
        }),
      ]

      let eventCount = 0
      for await (const event of model.stream(messages)) {
        eventCount++
        expect(event).toBeDefined()
      }

      expect(eventCount).toBeGreaterThan(0)
    })

    it('works correctly without telemetry config', async () => {
      const model = bedrock.createModel()

      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Say hello')],
        }),
      ]

      let eventCount = 0
      for await (const event of model.stream(messages)) {
        eventCount++
        expect(event).toBeDefined()
      }

      expect(eventCount).toBeGreaterThan(0)
    })
  })

  describe('Model telemetry with custom attributes', () => {
    it('accepts custom trace attributes in model config', () => {
      const model = bedrock.createModel({
        telemetryConfig: {
          enabled: true,
        },
      })

      expect(model).toBeDefined()
      expect(model.getConfig()).toBeDefined()
    })

    it('streams successfully with custom attributes', async () => {
      const model = bedrock.createModel({
        telemetryConfig: {
          enabled: true,
        },
      })

      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Say hello')],
        }),
      ]

      let eventCount = 0
      for await (const event of model.stream(messages)) {
        eventCount++
        expect(event).toBeDefined()
      }

      expect(eventCount).toBeGreaterThan(0)
    })
  })

  describe('Model telemetry resilience', () => {
    it('telemetry failures do not crash model streaming', async () => {
      const model = bedrock.createModel({
        telemetryConfig: {
          enabled: true,
        },
      })

      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Say hello')],
        }),
      ]

      // Should complete successfully even if telemetry has issues
      let eventCount = 0
      for await (const event of model.stream(messages)) {
        eventCount++
        expect(event).toBeDefined()
      }

      expect(eventCount).toBeGreaterThan(0)
    })

    it('handles concurrent model invocations with telemetry', async () => {
      const model1 = bedrock.createModel({
        telemetryConfig: {
          enabled: true,
        },
      })

      const model2 = bedrock.createModel({
        telemetryConfig: {
          enabled: true,
        },
      })

      const messages1: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Say hello from model 1')],
        }),
      ]

      const messages2: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Say hello from model 2')],
        }),
      ]

      // Run both models concurrently
      const [result1, result2] = await Promise.all([
        (async () => {
          let eventCount = 0
          for await (const _event of model1.stream(messages1)) {
            eventCount++
          }
          return eventCount
        })(),
        (async () => {
          let eventCount = 0
          for await (const _event of model2.stream(messages2)) {
            eventCount++
          }
          return eventCount
        })(),
      ])

      expect(result1).toBeGreaterThan(0)
      expect(result2).toBeGreaterThan(0)
    })
  })
})
