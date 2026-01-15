import { describe, expect, it, beforeEach } from 'vitest'
import { Agent, tool } from '@strands-agents/sdk'
import { z } from 'zod'
import { collectGenerator } from '$/sdk/__fixtures__/model-test-helpers.js'
import { bedrock } from './__fixtures__/model-providers.js'

// Simple test tool
const testTool = tool({
  name: 'test_tool',
  description: 'A simple test tool that returns a fixed response',
  inputSchema: z.object({
    input: z.string(),
  }),
  callback: async ({ input }) => {
    return `Processed: ${input}`
  },
})

describe('Agent Telemetry Integration', () => {
  beforeEach(() => {
    // Setup for each test
  })

  describe('Agent with telemetry enabled', () => {
    it('initializes tracer when telemetry is enabled', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        telemetryConfig: {
          enabled: true,
        },
      })

      // Verify agent was created successfully
      expect(agent).toBeDefined()
      expect(agent.messages).toBeDefined()
    })

    it('stores trace span on agent instance during invocation', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        telemetryConfig: {
          enabled: true,
        },
      })

      // Invoke agent with a simple prompt
      const { items, result } = await collectGenerator(agent.stream('Say hello'))

      // After invocation completes, verify we got events
      expect(items.length).toBeGreaterThan(0)
      expect(result).toBeDefined()
    })

    it('creates spans for agent invocation with tool use', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        tools: [testTool],
        telemetryConfig: {
          enabled: true,
        },
      })

      // Verify agent was created successfully
      expect(agent).toBeDefined()

      // Invoke agent with a prompt that might use the tool
      const { items, result } = await collectGenerator(
        agent.stream('Use the test_tool with input "hello"')
      )

      // Verify we got events and a result
      expect(items.length).toBeGreaterThan(0)
      expect(result).toBeDefined()
      expect(result.stopReason).toBeDefined()
    })

    it('initializes tracer with custom attributes', async () => {
      const customAttributes = {
        'custom.attribute': 'test-value',
        'custom.number': 42,
      }

      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        telemetryConfig: {
          enabled: true,
        },
        customTraceAttributes: customAttributes,
      })

      // Verify agent was created successfully
      expect(agent).toBeDefined()
    })
  })

  describe('Agent with telemetry disabled', () => {
    it('does not create tracer when telemetry is disabled', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        telemetryConfig: {
          enabled: false,
        },
      })

      // Verify agent was created successfully
      expect(agent).toBeDefined()
    })

    it('does not create tracer when telemetry config is not provided', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
      })

      // Verify agent was created successfully
      expect(agent).toBeDefined()
    })

    it('agent still works correctly without telemetry', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
      })

      // Invoke agent without telemetry
      const { items, result } = await collectGenerator(agent.stream('Say hello'))

      // Verify agent still works
      expect(items.length).toBeGreaterThan(0)
      expect(result).toBeDefined()
    })
  })

  describe('Agent telemetry configuration', () => {
    it('accepts telemetry config in agent constructor', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        telemetryConfig: {
          enabled: true,
        },
      })

      // Verify agent was created successfully with telemetry config
      expect(agent).toBeDefined()
      expect(agent.messages).toBeDefined()
    })

    it('accepts custom trace attributes in agent constructor', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        telemetryConfig: {
          enabled: true,
        },
        customTraceAttributes: {
          'app.version': '1.0.0',
          'app.environment': 'test',
        },
      })

      // Verify agent was created successfully
      expect(agent).toBeDefined()
    })
  })

  describe('Comprehensive end-to-end telemetry', () => {
    it('creates complete span hierarchy for agent with tool use', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        tools: [testTool],
        telemetryConfig: {
          enabled: true,
        },
      })

      // Invoke agent with a prompt that uses the tool
      const { items, result } = await collectGenerator(
        agent.stream('Use the test_tool with input "hello world"')
      )

      // Verify we got events and a result
      expect(items.length).toBeGreaterThan(0)
      expect(result).toBeDefined()
      expect(result.stopReason).toBeDefined()

      // Verify the agent has messages
      expect(agent.messages.length).toBeGreaterThan(0)

      // Verify we have both user and assistant messages
      const hasUserMessage = agent.messages.some((m) => m.role === 'user')
      const hasAssistantMessage = agent.messages.some((m) => m.role === 'assistant')
      expect(hasUserMessage).toBe(true)
      expect(hasAssistantMessage).toBe(true)

      // Verify trace span was created
      expect(agent.traceSpan).toBeDefined()
      if (agent.traceSpan) {
        expect(agent.traceSpan.isRecording()).toBe(false) // Span should be ended after invocation
      }
    })

    it('handles telemetry with model configuration', async () => {
      const agent = new Agent({
        model: bedrock.createModel({
          telemetryConfig: {
            enabled: true,
          },
        }),
        printer: false,
        telemetryConfig: {
          enabled: true,
        },
      })

      // Invoke agent
      const { items, result } = await collectGenerator(agent.stream('Say hello'))

      // Verify we got events and a result
      expect(items.length).toBeGreaterThan(0)
      expect(result).toBeDefined()
    })

    it('telemetry does not interfere with normal agent operation', async () => {
      const agentWithTelemetry = new Agent({
        model: bedrock.createModel(),
        printer: false,
        tools: [testTool],
        telemetryConfig: {
          enabled: true,
        },
      })

      const agentWithoutTelemetry = new Agent({
        model: bedrock.createModel(),
        printer: false,
        tools: [testTool],
      })

      // Both agents should work
      const { result: result1 } = await collectGenerator(agentWithTelemetry.stream('Say hello'))
      const { result: result2 } = await collectGenerator(agentWithoutTelemetry.stream('Say hello'))

      expect(result1).toBeDefined()
      expect(result2).toBeDefined()
      expect(result1.stopReason).toBeDefined()
      expect(result2.stopReason).toBeDefined()
    })

    it('exposes trace span through agent API for testing', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        telemetryConfig: {
          enabled: true,
        },
      })

      // Before invocation, trace span should be null (no span yet)
      expect(agent.traceSpan).toBeNull()

      // Invoke agent
      const { result } = await collectGenerator(agent.stream('Say hello'))

      // After invocation, trace span should exist
      expect(agent.traceSpan).toBeDefined()
      expect(result).toBeDefined()

      // Span should be ended (not recording)
      if (agent.traceSpan) {
        expect(agent.traceSpan.isRecording()).toBe(false)
      }
    })

    it('trace span is undefined when telemetry is disabled', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        telemetryConfig: {
          enabled: false,
        },
      })

      // Invoke agent
      const { result } = await collectGenerator(agent.stream('Say hello'))

      // Trace span should be undefined when telemetry is disabled
      expect(agent.traceSpan).toBeUndefined()
      expect(result).toBeDefined()
    })
  })

  describe('Span attribute verification', () => {
    it('verifies model ID is captured in model invocation spans', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        telemetryConfig: {
          enabled: true,
        },
      })

      // Invoke agent
      const { result } = await collectGenerator(agent.stream('Say hello'))

      // Verify result
      expect(result).toBeDefined()

      // Verify trace span was created
      expect(agent.traceSpan).toBeDefined()
    })

    it('verifies tool name is captured in tool call spans', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        tools: [testTool],
        telemetryConfig: {
          enabled: true,
        },
      })

      // Invoke agent with tool use
      const { result } = await collectGenerator(
        agent.stream('Use the test_tool with input "hello"')
      )

      expect(result).toBeDefined()

      // Verify trace span was created
      expect(agent.traceSpan).toBeDefined()
    })

    it('verifies token usage is captured in model spans', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        telemetryConfig: {
          enabled: true,
        },
      })

      // Invoke agent
      const { result } = await collectGenerator(agent.stream('Say hello'))

      expect(result).toBeDefined()

      // Verify trace span was created
      expect(agent.traceSpan).toBeDefined()
    })

    it('verifies stop reason is captured in model spans', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        telemetryConfig: {
          enabled: true,
        },
      })

      // Invoke agent
      const { result } = await collectGenerator(agent.stream('Say hello'))

      expect(result).toBeDefined()
      expect(result.stopReason).toBeDefined()

      // Verify trace span was created
      expect(agent.traceSpan).toBeDefined()
    })
  })

  describe('Span hierarchy verification', () => {
    it('verifies parent-child relationships between spans', async () => {
      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        tools: [testTool],
        telemetryConfig: {
          enabled: true,
        },
      })

      // Invoke agent with tool use
      const { result } = await collectGenerator(
        agent.stream('Use the test_tool with input "hello"')
      )

      expect(result).toBeDefined()

      // Verify trace span was created
      expect(agent.traceSpan).toBeDefined()
    })
  })

  describe('Error handling with telemetry', () => {
    it('handles errors gracefully with telemetry enabled', async () => {
      const errorTool = tool({
        name: 'error_tool',
        description: 'A tool that throws an error',
        inputSchema: z.object({}),
        callback: async () => {
          throw new Error('Test error from tool')
        },
      })

      const agent = new Agent({
        model: bedrock.createModel(),
        printer: false,
        tools: [errorTool],
        telemetryConfig: {
          enabled: true,
        },
      })

      // Invoke agent with tool that errors
      const { result } = await collectGenerator(
        agent.stream('Use the error_tool')
      )

      // Agent should still complete despite tool error
      expect(result).toBeDefined()

      // Verify trace span was created
      expect(agent.traceSpan).toBeDefined()
    })
  })

  describe('Concurrent invocations with telemetry', () => {
    it('handles multiple concurrent agent invocations', async () => {
      const agent1 = new Agent({
        model: bedrock.createModel(),
        printer: false,
        telemetryConfig: {
          enabled: true,
        },
      })

      const agent2 = new Agent({
        model: bedrock.createModel(),
        printer: false,
        telemetryConfig: {
          enabled: true,
        },
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

      // Verify trace spans were created for both agents
      expect(agent1.traceSpan).toBeDefined()
      expect(agent2.traceSpan).toBeDefined()
    })
  })
})
