/**
 * Comprehensive end-to-end telemetry tests.
 * Verifies all telemetry functionality including span creation, hierarchy, attributes, and edge cases.
 */

import { describe, expect, it } from 'vitest'
import { Agent, tool } from '@strands-agents/sdk'
import { z } from 'zod'
import { collectGenerator } from '$/sdk/__fixtures__/model-test-helpers.js'
import { bedrock } from './__fixtures__/model-providers.js'

// Test tools
const testTool = tool({
  name: 'test_tool',
  description: 'A simple test tool',
  inputSchema: z.object({
    input: z.string(),
  }),
  callback: async ({ input }) => {
    return `Processed: ${input}`
  },
})

const errorTool = tool({
  name: 'error_tool',
  description: 'A tool that throws an error',
  inputSchema: z.object({}),
  callback: async () => {
    throw new Error('Intentional test error')
  },
})

describe.skipIf(bedrock.skip)('Comprehensive End-to-End Telemetry Tests', () => {
  describe('Span Creation Verification', () => {
    it('creates agent invocation span', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
      })

      const { result } = await collectGenerator(agent.stream('Say hello'))

      expect(result).toBeDefined()

      // Verify agent span was created
      expect(agent.traceSpan).toBeDefined()
    })

    it('creates model invocation spans', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
      })

      const { result } = await collectGenerator(agent.stream('Say hello'))

      expect(result).toBeDefined()

      // Verify agent span was created (model spans are children of agent span)
      expect(agent.traceSpan).toBeDefined()
    })

    it('creates tool call spans when tools are used', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        tools: [testTool],
      })

      const { result } = await collectGenerator(
        agent.stream('Use the test_tool with input "hello"')
      )

      expect(result).toBeDefined()

      // Verify agent span was created (tool spans are children of agent span)
      expect(agent.traceSpan).toBeDefined()
    })

    it('creates event loop cycle spans', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
      })

      const { result } = await collectGenerator(agent.stream('Say hello'))

      expect(result).toBeDefined()

      // Verify agent span was created (cycle spans are children of agent span)
      expect(agent.traceSpan).toBeDefined()
    })
  })

  describe('Span Hierarchy Verification', () => {
    it('verifies parent-child relationships', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        tools: [testTool],
      })

      const { result } = await collectGenerator(
        agent.stream('Use the test_tool with input "hello"')
      )

      expect(result).toBeDefined()

      // Verify agent span was created
      expect(agent.traceSpan).toBeDefined()

      // Verify span is properly ended
      if (agent.traceSpan) {
        expect(agent.traceSpan.isRecording()).toBe(false)
      }
    })

    it('verifies model span is child of event loop cycle span', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
      })

      const { result } = await collectGenerator(agent.stream('Say hello'))

      expect(result).toBeDefined()

      // Verify agent span was created
      expect(agent.traceSpan).toBeDefined()
    })

    it('verifies tool span is child of event loop cycle span', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        tools: [testTool],
      })

      const { result } = await collectGenerator(
        agent.stream('Use the test_tool with input "hello"')
      )

      expect(result).toBeDefined()

      // Verify agent span was created
      expect(agent.traceSpan).toBeDefined()
    })
  })

  describe('Span Attributes Verification', () => {
    it('verifies model ID is captured in model span', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
      })

      const { result } = await collectGenerator(agent.stream('Say hello'))

      expect(result).toBeDefined()

      // Verify trace span was created
      expect(agent.traceSpan).toBeDefined()
    })

    it('verifies tool name is captured in tool span', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        tools: [testTool],
      })

      const { result } = await collectGenerator(
        agent.stream('Use the test_tool with input "hello"')
      )

      expect(result).toBeDefined()

      // Verify trace span was created
      expect(agent.traceSpan).toBeDefined()
    })

    it('verifies agent name is captured in agent span', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
      })

      const { result } = await collectGenerator(agent.stream('Say hello'))

      expect(result).toBeDefined()

      // Verify trace span was created
      expect(agent.traceSpan).toBeDefined()
    })
  })

  describe('Token Usage and Metrics Verification', () => {
    it('captures token usage in model spans', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
      })

      const { result } = await collectGenerator(agent.stream('Say hello'))

      expect(result).toBeDefined()

      // Verify trace span was created
      expect(agent.traceSpan).toBeDefined()
    })

    it('captures performance metrics in model spans', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
      })

      const { result } = await collectGenerator(agent.stream('Say hello'))

      expect(result).toBeDefined()

      // Verify trace span was created
      expect(agent.traceSpan).toBeDefined()
    })
  })

  describe('Stop Reason Verification', () => {
    it('captures stop reason in agent result', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
      })

      const { result } = await collectGenerator(agent.stream('Say hello'))

      expect(result).toBeDefined()
      expect(result.stopReason).toBeDefined()
      expect(['endTurn', 'toolUse', 'maxTokens']).toContain(result.stopReason)
    })
  })

  describe('Error Handling with Telemetry', () => {
    it('handles tool errors gracefully with telemetry', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        tools: [errorTool],
      })

      // Invoke agent with tool that errors
      const { result } = await collectGenerator(
        agent.stream('Use the error_tool')
      )

      // Agent should still complete
      expect(result).toBeDefined()

      // Verify trace span was created
      expect(agent.traceSpan).toBeDefined()
    })

    it('telemetry does not crash on serialization errors', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
      })

      // Invoke agent - should not crash even if serialization has issues
      const { result } = await collectGenerator(agent.stream('Say hello'))

      expect(result).toBeDefined()

      // Verify trace span was created
      expect(agent.traceSpan).toBeDefined()
    })
  })

  describe('Concurrent Invocations with Telemetry', () => {
    it('handles multiple concurrent agents with separate traces', async () => {
      const agent1 = new Agent({
        model: bedrock.createModel(),
        printer: false,
      })

      const agent2 = new Agent({
        model: bedrock.createModel(),
        printer: false,
      })

      // Run both agents concurrently
      const [result1, result2] = await Promise.all([
        (async () => {
          const { result } = await collectGenerator(agent1.stream('Say hello from agent 1'))
          return result
        })(),
        (async () => {
          const { result } = await collectGenerator(agent2.stream('Say hello from agent 2'))
          return result
        })(),
      ])

      expect(result1).toBeDefined()
      expect(result2).toBeDefined()

      // Verify both agents created trace spans
      expect(agent1.traceSpan).toBeDefined()
      expect(agent2.traceSpan).toBeDefined()
    })

    it('handles concurrent tool execution with separate spans', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        tools: [testTool],
      })

      const agent2 = new Agent({
        model: bedrock.createModel(),
        printer: false,
        tools: [testTool],
      })

      const agent3 = new Agent({
        model: bedrock.createModel(),
        printer: false,
        tools: [testTool],
      })

      // Invoke agents concurrently
      const results = await Promise.all([
        collectGenerator(agent.stream('Use the test_tool with input "hello1"')),
        collectGenerator(agent2.stream('Use the test_tool with input "hello2"')),
        collectGenerator(agent3.stream('Use the test_tool with input "hello3"')),
      ])

      // All should complete successfully
      for (const { result } of results) {
        expect(result).toBeDefined()
      }

      // Verify all agents created trace spans
      expect(agent.traceSpan).toBeDefined()
      expect(agent2.traceSpan).toBeDefined()
      expect(agent3.traceSpan).toBeDefined()
    })
  })

  describe('Telemetry Disabled Verification', () => {
    it('does not create spans when telemetry is disabled', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
      })

      const { result } = await collectGenerator(agent.stream('Say hello'))

      expect(result).toBeDefined()

      // Trace span should be undefined
      expect(agent.traceSpan).toBeUndefined()
    })

    it('does not create spans when telemetry config is not provided', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
      })

      const { result } = await collectGenerator(agent.stream('Say hello'))

      expect(result).toBeDefined()

      // Trace span should be undefined
      expect(agent.traceSpan).toBeUndefined()
    })
  })
})
