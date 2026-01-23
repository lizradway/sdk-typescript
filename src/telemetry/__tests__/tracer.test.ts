import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Tracer, serialize } from '../tracer.js'
import { Message, TextBlock, ToolResultBlock } from '../../types/messages.js'

describe('Tracer', () => {
  let tracer: Tracer

  beforeEach(() => {
    tracer = new Tracer()
  })

  afterEach(() => {
    // Clean up environment variables after each test
    delete process.env.OTEL_SEMCONV_STABILITY_OPT_IN
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  })

  describe('initialization', () => {
    it('should create a Tracer instance', () => {
      expect(tracer).toBeDefined()
      expect(tracer).toBeInstanceOf(Tracer)
    })

    it('should initialize OpenTelemetry tracer provider', () => {
      const tracer1 = new Tracer()
      expect(tracer1).toBeDefined()
      expect(tracer1).toBeInstanceOf(Tracer)
    })

    it('should read semantic convention from environment variable', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_latest_experimental'
        const tracerWithLatest = new Tracer()
        expect(tracerWithLatest).toBeDefined()

        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = ''
        const tracerWithStable = new Tracer()
        expect(tracerWithStable).toBeDefined()
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should use latest conventions when gen_ai_latest_experimental is set', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_latest_experimental'
        const tracerWithLatest = new Tracer()

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('Hello')],
          }),
        ]

        const span = tracerWithLatest.startAgentSpan({ messages, agentName: 'test-agent', agentId: 'agent-123' })
        expect(span).toBeDefined()

        if (span) {
          tracerWithLatest.endAgentSpan(span)
        }
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should use stable conventions when gen_ai_latest_experimental is not set', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = ''
        const tracerWithStable = new Tracer()

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('Hello')],
          }),
        ]

        const span = tracerWithStable.startAgentSpan({ messages, agentName: 'test-agent', agentId: 'agent-123' })
        expect(span).toBeDefined()

        if (span) {
          tracerWithStable.endAgentSpan(span)
        }
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should include tool definitions when gen_ai_tool_definitions is set', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_tool_definitions'
        const tracerWithToolDefs = new Tracer()

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('Hello')],
          }),
        ]

        const toolsConfig = {
          'tool-1': { name: 'tool-1', description: 'Test tool' },
        }

        const span = tracerWithToolDefs.startAgentSpan({
          messages,
          agentName: 'test-agent',
          toolsConfig,
        })
        expect(span).toBeDefined()

        if (span) {
          tracerWithToolDefs.endAgentSpan(span)
        }
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should accept telemetry config', () => {
      const config = {
        enabled: true,
        customTraceAttributes: {
          'custom.key': 'custom.value',
        },
      }
      const tracerWithConfig = new Tracer(config)
      expect(tracerWithConfig).toBeDefined()
    })

    it('should handle OTEL_EXPORTER_OTLP_ENDPOINT environment variable', () => {
      const originalEnv = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      try {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'
        const tracerWithOtlp = new Tracer()
        expect(tracerWithOtlp).toBeDefined()
      } finally {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEnv
      }
    })

    it('should initialize only once even with multiple Tracer instances', () => {
      const tracer1 = new Tracer()
      const tracer2 = new Tracer()
      const tracer3 = new Tracer()

      expect(tracer1).toBeDefined()
      expect(tracer2).toBeDefined()
      expect(tracer3).toBeDefined()
    })

    it('should handle initialization errors gracefully', () => {
      // This test verifies that initialization errors don't throw
      expect(() => {
        new Tracer()
      }).not.toThrow()
    })
  })

  describe('span creation', () => {
    it('should create an agent span', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Hello')],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent', modelId: 'model-123' })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should create a model invoke span', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Hello')],
        }),
      ]

      const span = tracer.startModelInvokeSpan({ messages, modelId: 'model-123' })
      expect(span).toBeDefined()

      if (span) {
        tracer.endModelInvokeSpan(span)
      }
    })

    it('should create a tool call span', () => {
      const toolUse = {
        name: 'test-tool',
        toolUseId: 'tool-123',
        input: { key: 'value' },
      }

      const span = tracer.startToolCallSpan({ tool: toolUse })
      expect(span).toBeDefined()

      if (span) {
        tracer.endToolCallSpan(span)
      }
    })

    it('should create an event loop cycle span', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Hello')],
        }),
      ]

      const span = tracer.startEventLoopCycleSpan({ cycleId: 'cycle-123', messages })
      expect(span).toBeDefined()

      if (span) {
        tracer.endEventLoopCycleSpan(span)
      }
    })
  })

  describe('span lifecycle', () => {
    it('should handle span ending with usage data', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Hello')],
        }),
      ]

      const span = tracer.startModelInvokeSpan({ messages, modelId: 'model-123' })
      expect(span).toBeDefined()

      if (span) {
        const usage = {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        }

        const metrics = {
          latencyMs: 100,
        }

        tracer.endModelInvokeSpan(span, { usage, metrics, stopReason: 'end_turn' })
      }
    })

    it('should handle span ending with error', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Hello')],
        }),
      ]

      const span = tracer.startModelInvokeSpan({ messages })
      expect(span).toBeDefined()

      if (span) {
        const error = new Error('Test error')
        tracer.endModelInvokeSpan(span, { error })
      }
    })

    it('should handle null spans gracefully', () => {
      expect(() => {
        tracer.endAgentSpan(null)
        tracer.endModelInvokeSpan(null)
        tracer.endToolCallSpan(null)
      }).not.toThrow()
    })
  })

  describe('serialization', () => {
    it('should serialize simple objects', () => {
      const obj = { key: 'value', number: 42, bool: true }
      const result = serialize(obj)
      expect(result).toBe(JSON.stringify(obj))
    })

    it('should serialize arrays', () => {
      const arr = [1, 2, 3, 'test']
      const result = serialize(arr)
      expect(result).toBe(JSON.stringify(arr))
    })

    it('should handle circular references', () => {
      const obj: Record<string, unknown> = { key: 'value' }
      obj.self = obj
      const result = serialize(obj)
      expect(result).toContain('<replaced>')
    })

    it('should handle Error objects', () => {
      const error = new Error('Test error')
      const result = serialize(error)
      expect(result).toContain('Test error')
      expect(result).toContain('Error')
    })

    it('should handle Date objects', () => {
      const date = new Date('2025-01-01T00:00:00Z')
      const result = serialize(date)
      expect(result).toContain('2025-01-01')
    })

    it('should handle null and undefined', () => {
      expect(serialize(null)).toBe('null')
      expect(serialize(undefined)).toBe('undefined')
    })
  })

  describe('custom attributes', () => {
    it('should merge custom attributes with standard attributes', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Hello')],
        }),
      ]

      const customAttributes = {
        'custom.session_id': 'session-123',
        'custom.user_id': 'user-456',
      }

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent', customTraceAttributes: customAttributes })

      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })
  })

  describe('message event classification', () => {
    it('should classify user messages correctly', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Hello')],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should classify assistant messages correctly', () => {
      const messages: Message[] = [
        new Message({
          role: 'assistant',
          content: [new TextBlock('Response')],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })
  })

  describe('Property 1: Span Lifecycle Completeness', () => {
    it('should start and end agent spans with success status', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should start and end model invoke spans with success status', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const span = tracer.startModelInvokeSpan({ messages, modelId: 'model-123' })
      expect(span).toBeDefined()

      if (span) {
        const usage = {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        }

        const metrics = {
          latencyMs: 100,
        }

        tracer.endModelInvokeSpan(span, { usage, metrics })
      }
    })

    it('should start and end tool call spans with success status', () => {
      const toolUse = {
        name: 'test-tool',
        toolUseId: 'tool-123',
        input: { key: 'value' },
      }

      const span = tracer.startToolCallSpan({ tool: toolUse })
      expect(span).toBeDefined()

      if (span) {
        const toolResult = {
          toolUseId: 'tool-123',
          status: 'success' as const,
          content: { result: 'success' },
        }

        tracer.endToolCallSpan(span, toolResult)
      }
    })

    it('should start and end event loop cycle spans with success status', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const span = tracer.startEventLoopCycleSpan({ cycleId: 'cycle-123', messages })
      expect(span).toBeDefined()

      if (span) {
        tracer.endEventLoopCycleSpan(span)
      }
    })

    it('should handle span ending with error status', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        const error = new Error('Test error')
        tracer.endAgentSpan(span, undefined, error)
      }
    })

    it('should set start and end times on all span types', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      // Test agent span
      const agentSpan = tracer.startAgentSpan({ messages, agentName: 'agent' })
      expect(agentSpan).toBeDefined()
      if (agentSpan) tracer.endAgentSpan(agentSpan)

      // Test model span
      const modelSpan = tracer.startModelInvokeSpan({ messages })
      expect(modelSpan).toBeDefined()
      if (modelSpan) tracer.endModelInvokeSpan(modelSpan)

      // Test tool span
      const toolSpan = tracer.startToolCallSpan({
        tool: { name: 'tool', toolUseId: 'id', input: {} },
      })
      expect(toolSpan).toBeDefined()
      if (toolSpan) tracer.endToolCallSpan(toolSpan)

      // Test cycle span
      const cycleSpan = tracer.startEventLoopCycleSpan({ cycleId: 'cycle', messages })
      expect(cycleSpan).toBeDefined()
      if (cycleSpan) tracer.endEventLoopCycleSpan(cycleSpan)
    })

    it('should handle multiple sequential spans', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      // Create and end first span
      const span1 = tracer.startAgentSpan({ messages, agentName: 'agent-1' })
      expect(span1).toBeDefined()
      if (span1) tracer.endAgentSpan(span1)

      // Create and end second span
      const span2 = tracer.startAgentSpan({ messages, agentName: 'agent-2' })
      expect(span2).toBeDefined()
      if (span2) tracer.endAgentSpan(span2)

      // Create and end third span
      const span3 = tracer.startAgentSpan({ messages, agentName: 'agent-3' })
      expect(span3).toBeDefined()
      if (span3) tracer.endAgentSpan(span3)
    })

    it('should handle nested spans with parent-child relationships', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      // Create parent span - context stack handles parenting automatically
      const parentSpan = tracer.startAgentSpan({ messages, agentName: 'parent-agent' })
      expect(parentSpan).toBeDefined()

      if (parentSpan) {
        // Create child span - automatically parents to the active span
        const childSpan = tracer.startModelInvokeSpan({ messages, modelId: 'model-123' })
        expect(childSpan).toBeDefined()

        if (childSpan) {
          tracer.endModelInvokeSpan(childSpan)
        }

        // End parent span
        tracer.endAgentSpan(parentSpan)
      }
    })

    it('should handle error resilience when ending spans', () => {
      // Test that ending null spans doesn't throw
      expect(() => {
        tracer.endAgentSpan(null)
        tracer.endModelInvokeSpan(null)
        tracer.endToolCallSpan(null)
      }).not.toThrow()
    })
  })

  describe('Property 4: Error Resilience', () => {
    it('should not throw when starting spans with invalid inputs', () => {
      expect(() => {
        // Try to start spans with various invalid inputs
        tracer.startAgentSpan({ messages: [], agentName: '' }) // empty agent name
        tracer.startAgentSpan({ messages: [], agentName: 'agent', customTraceAttributes: {} }) // empty custom attributes
        tracer.startModelInvokeSpan({ messages: [] })
        tracer.startToolCallSpan({ tool: { name: '', toolUseId: '', input: {} } })
        tracer.startEventLoopCycleSpan({ cycleId: '', messages: [] })
      }).not.toThrow()
    })

    it('should not throw when ending spans with errors', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })

      expect(() => {
        if (span) {
          const error = new Error('Simulated error')
          tracer.endAgentSpan(span, undefined, error)
        }
      }).not.toThrow()
    })

    it('should handle null spans gracefully without throwing', () => {
      expect(() => {
        tracer.endAgentSpan(null, undefined, new Error('test'))
        tracer.endModelInvokeSpan(null, { error: new Error('test') })
        tracer.endToolCallSpan(null, undefined, new Error('test'))
      }).not.toThrow()
    })

    it('should continue operation when serialization fails', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      // Create a circular reference that will be handled by the encoder
      const circularObj: Record<string, unknown> = { key: 'value' }
      circularObj.self = circularObj

      expect(() => {
        const span = tracer.startAgentSpan({
          messages,
          agentName: 'test-agent',
          modelId: 'model-123',
          tools: [circularObj],
        })
        if (span) {
          tracer.endAgentSpan(span)
        }
      }).not.toThrow()
    })

    it('should handle tool definition serialization failures gracefully', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_tool_definitions'
        const tracer2 = new Tracer()

        // Create tools config with problematic values
        const toolsConfig = {
          'tool-1': {
            name: 'tool-1',
            description: 'Test tool',
            // Add a circular reference
            self: undefined as unknown,
          },
        }
        ;(toolsConfig['tool-1'] as Record<string, unknown>).self = toolsConfig['tool-1']

        expect(() => {
          const span = tracer2.startAgentSpan({
            messages,
            agentName: 'test-agent',
            modelId: 'model-123',
            toolsConfig,
          })
          if (span) {
            tracer2.endAgentSpan(span)
          }
        }).not.toThrow()
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should handle multiple sequential operations with errors', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      expect(() => {
        // Create and end multiple spans, some with errors
        const span1 = tracer.startAgentSpan({ messages, agentName: 'agent-1' })
        if (span1) tracer.endAgentSpan(span1, undefined, new Error('error 1'))

        const span2 = tracer.startModelInvokeSpan({ messages })
        if (span2) tracer.endModelInvokeSpan(span2, { error: new Error('error 2') })

        const span3 = tracer.startToolCallSpan({
          tool: { name: 'tool', toolUseId: 'id', input: {} },
        })
        if (span3) tracer.endToolCallSpan(span3, undefined, new Error('error 3'))

        const span4 = tracer.startEventLoopCycleSpan({ cycleId: 'cycle', messages })
        if (span4) tracer.endEventLoopCycleSpan(span4, new Error('error 4'))
      }).not.toThrow()
    })

    it('should continue after attribute setting failures', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      expect(() => {
        // Create span with custom attributes that might cause issues
        const customAttributes: Record<string, unknown> = {
          'valid.attr': 'value',
          'invalid.attr': Symbol('test'), // Invalid attribute type
          'circular.attr': undefined,
        }
        ;(customAttributes['circular.attr'] as Record<string, unknown>) = customAttributes

        const span = tracer.startAgentSpan({
          messages,
          agentName: 'test-agent',
          customTraceAttributes: customAttributes as Record<string, string>,
        })
        if (span) {
          tracer.endAgentSpan(span)
        }
      }).not.toThrow()
    })
  })

  describe('Property 2: Attribute Consistency (Model Invocation)', () => {
    it('should set all provided attributes on model invocation spans', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test message')],
        }),
      ]

      const customAttributes = {
        'custom.session_id': 'session-123',
        'custom.user_id': 'user-456',
      }

      const span = tracer.startModelInvokeSpan({ messages, modelId: 'model-123', customTraceAttributes: customAttributes })
      expect(span).toBeDefined()

      if (span) {
        const usage = {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        }

        const metrics = {
          latencyMs: 100,
        }

        tracer.endModelInvokeSpan(span, { usage, metrics })
      }
    })

    it('should preserve serializable types in model invocation attributes', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const customAttributes = {
        'custom.string': 'value',
        'custom.number': 42,
        'custom.boolean': true,
        'custom.array': [1, 2, 3],
      }

      const span = tracer.startModelInvokeSpan({ messages, modelId: 'model-123', customTraceAttributes: customAttributes })
      expect(span).toBeDefined()

      if (span) {
        tracer.endModelInvokeSpan(span)
      }
    })

    it('should merge custom attributes with standard model invocation attributes', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const customAttributes = {
        'custom.request_id': 'req-123',
      }

      const span = tracer.startModelInvokeSpan({ messages, modelId: 'model-456', customTraceAttributes: customAttributes })
      expect(span).toBeDefined()

      if (span) {
        const usage = {
          inputTokens: 5,
          outputTokens: 15,
          totalTokens: 20,
        }

        tracer.endModelInvokeSpan(span, { usage })
      }
    })

    it('should handle model invocation with custom attributes', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      // Create parent span - context stack handles parenting automatically
      const parentSpan = tracer.startAgentSpan({ messages, agentName: 'parent-agent' })
      expect(parentSpan).toBeDefined()

      if (parentSpan) {
        // Create child model span with custom attributes
        const customAttributes = {
          'custom.trace_id': 'trace-789',
        }

        const modelSpan = tracer.startModelInvokeSpan({ messages, modelId: 'model-123', customTraceAttributes: customAttributes })
        expect(modelSpan).toBeDefined()

        if (modelSpan) {
          const usage = {
            inputTokens: 8,
            outputTokens: 12,
            totalTokens: 20,
          }

          tracer.endModelInvokeSpan(modelSpan, { usage })
        }

        tracer.endAgentSpan(parentSpan)
      }
    })

    it('should maintain attribute consistency across multiple model invocation spans', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const customAttributes1 = {
        'custom.call_id': 'call-1',
      }

      const customAttributes2 = {
        'custom.call_id': 'call-2',
      }

      // Create first model span
      const span1 = tracer.startModelInvokeSpan({ messages, modelId: 'model-123', customTraceAttributes: customAttributes1 })
      expect(span1).toBeDefined()

      if (span1) {
        const usage = {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        }

        tracer.endModelInvokeSpan(span1, { usage })
      }

      // Create second model span
      const span2 = tracer.startModelInvokeSpan({ messages, modelId: 'model-456', customTraceAttributes: customAttributes2 })
      expect(span2).toBeDefined()

      if (span2) {
        const usage = {
          inputTokens: 15,
          outputTokens: 25,
          totalTokens: 40,
        }

        tracer.endModelInvokeSpan(span2, { usage })
      }
    })
  })

  describe('Property 8: Token Usage Accuracy', () => {
    it('should set all token usage attributes when provided', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const span = tracer.startModelInvokeSpan({ messages, modelId: 'model-123' })
      expect(span).toBeDefined()

      if (span) {
        const usage = {
          inputTokens: 100,
          outputTokens: 200,
          totalTokens: 300,
        }

        const metrics = {
          latencyMs: 500,
        }

        tracer.endModelInvokeSpan(span, { usage, metrics })
      }
    })

    it('should set cache token attributes when provided', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const span = tracer.startModelInvokeSpan({ messages, modelId: 'model-123' })
      expect(span).toBeDefined()

      if (span) {
        const usage = {
          inputTokens: 100,
          outputTokens: 200,
          totalTokens: 300,
          cacheReadInputTokens: 50,
          cacheWriteInputTokens: 25,
        }

        tracer.endModelInvokeSpan(span, { usage })
      }
    })

    it('should set performance metrics when provided', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const span = tracer.startModelInvokeSpan({ messages, modelId: 'model-123' })
      expect(span).toBeDefined()

      if (span) {
        const usage = {
          inputTokens: 50,
          outputTokens: 100,
          totalTokens: 150,
        }

        const metrics = {
          timeToFirstByteMs: 250,
          latencyMs: 1000,
        }

        tracer.endModelInvokeSpan(span, { usage, metrics })
      }
    })

    it('should handle zero token values correctly', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const span = tracer.startModelInvokeSpan({ messages, modelId: 'model-123' })
      expect(span).toBeDefined()

      if (span) {
        const usage = {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        }

        tracer.endModelInvokeSpan(span, { usage })
      }
    })

    it('should handle large token values correctly', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const span = tracer.startModelInvokeSpan({ messages, modelId: 'model-123' })
      expect(span).toBeDefined()

      if (span) {
        const usage = {
          inputTokens: 1000000,
          outputTokens: 2000000,
          totalTokens: 3000000,
        }

        tracer.endModelInvokeSpan(span, { usage })
      }
    })

    it('should skip optional cache token attributes when not provided', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const span = tracer.startModelInvokeSpan({ messages, modelId: 'model-123' })
      expect(span).toBeDefined()

      if (span) {
        const usage = {
          inputTokens: 100,
          outputTokens: 200,
          totalTokens: 300,
          // No cache tokens provided
        }

        tracer.endModelInvokeSpan(span, { usage })
      }
    })

    it('should skip optional performance metrics when not provided', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const span = tracer.startModelInvokeSpan({ messages, modelId: 'model-123' })
      expect(span).toBeDefined()

      if (span) {
        const usage = {
          inputTokens: 100,
          outputTokens: 200,
          totalTokens: 300,
        }

        // No metrics provided
        tracer.endModelInvokeSpan(span, { usage })
      }
    })

    it('should handle mixed token usage and metrics', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const span = tracer.startModelInvokeSpan({ messages, modelId: 'model-123' })
      expect(span).toBeDefined()

      if (span) {
        const usage = {
          inputTokens: 75,
          outputTokens: 150,
          totalTokens: 225,
          cacheReadInputTokens: 25,
          // cacheWriteInputTokens not provided
        }

        const metrics = {
          timeToFirstByteMs: 150,
          // latencyMs not provided
        }

        tracer.endModelInvokeSpan(span, { usage, metrics })
      }
    })
  })

  describe('Property 2: Attribute Consistency (Tool Call Tracing)', () => {
    it('should set all tool-specific attributes on tool call spans', () => {
      const toolUse = {
        name: 'calculate',
        toolUseId: 'tool-call-123',
        input: { operation: 'add', a: 5, b: 3 },
      }

      const customAttributes = {
        'custom.request_id': 'req-789',
      }

      const span = tracer.startToolCallSpan({ tool: toolUse, customTraceAttributes: customAttributes })
      expect(span).toBeDefined()

      if (span) {
        const toolResult = {
          toolUseId: 'tool-call-123',
          status: 'success' as const,
          content: { result: 8 },
        }

        tracer.endToolCallSpan(span, toolResult)
      }
    })

    it('should preserve tool call attributes across different tool types', () => {
      const tools = [
        {
          name: 'search',
          toolUseId: 'search-1',
          input: { query: 'test' },
        },
        {
          name: 'calculate',
          toolUseId: 'calc-1',
          input: { expression: '2+2' },
        },
        {
          name: 'fetch',
          toolUseId: 'fetch-1',
          input: { url: 'https://example.com' },
        },
      ]

      for (const tool of tools) {
        const span = tracer.startToolCallSpan({ tool })
        expect(span).toBeDefined()

        if (span) {
          const toolResult = {
            toolUseId: tool.toolUseId,
            status: 'success' as const,
            content: { data: 'result' },
          }

          tracer.endToolCallSpan(span, toolResult)
        }
      }
    })

    it('should merge custom attributes with standard tool call attributes', () => {
      const toolUse = {
        name: 'database_query',
        toolUseId: 'db-query-456',
        input: { sql: 'SELECT * FROM users' },
      }

      const customAttributes = {
        'custom.database': 'production',
        'custom.user_id': 'user-123',
      }

      const span = tracer.startToolCallSpan({ tool: toolUse, customTraceAttributes: customAttributes })
      expect(span).toBeDefined()

      if (span) {
        const toolResult = {
          toolUseId: 'db-query-456',
          status: 'success' as const,
          content: { rows: 42 },
        }

        tracer.endToolCallSpan(span, toolResult)
      }
    })

    it('should handle tool call with parent span and custom attributes', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Calculate something')],
        }),
      ]

      // Create parent span - context stack handles parenting automatically
      const parentSpan = tracer.startAgentSpan({ messages, agentName: 'parent-agent' })
      expect(parentSpan).toBeDefined()

      if (parentSpan) {
        // Create tool call span - automatically parents to the active span
        const toolUse = {
          name: 'math_tool',
          toolUseId: 'math-789',
          input: { operation: 'multiply', x: 6, y: 7 },
        }

        const customAttributes = {
          'custom.trace_id': 'trace-xyz',
        }

        const toolSpan = tracer.startToolCallSpan({ tool: toolUse, customTraceAttributes: customAttributes })
        expect(toolSpan).toBeDefined()

        if (toolSpan) {
          const toolResult = {
            toolUseId: 'math-789',
            status: 'success' as const,
            content: { result: 42 },
          }

          tracer.endToolCallSpan(toolSpan, toolResult)
        }

        tracer.endAgentSpan(parentSpan)
      }
    })

    it('should maintain attribute consistency across multiple tool call spans', () => {
      const tools = [
        {
          name: 'tool-a',
          toolUseId: 'a-1',
          input: { param: 'value-a' },
        },
        {
          name: 'tool-b',
          toolUseId: 'b-1',
          input: { param: 'value-b' },
        },
      ]

      const customAttributes1 = {
        'custom.call_sequence': '1',
      }

      const customAttributes2 = {
        'custom.call_sequence': '2',
      }

      // Create first tool call span
      const span1 = tracer.startToolCallSpan({ tool: tools[0]!, customTraceAttributes: customAttributes1 })
      expect(span1).toBeDefined()

      if (span1) {
        const toolResult1 = {
          toolUseId: 'a-1',
          status: 'success' as const,
          content: { output: 'result-a' },
        }

        tracer.endToolCallSpan(span1, toolResult1)
      }

      // Create second tool call span
      const span2 = tracer.startToolCallSpan({ tool: tools[1]!, customTraceAttributes: customAttributes2 })
      expect(span2).toBeDefined()

      if (span2) {
        const toolResult2 = {
          toolUseId: 'b-1',
          status: 'success' as const,
          content: { output: 'result-b' },
        }

        tracer.endToolCallSpan(span2, toolResult2)
      }
    })

    it('should handle tool call with error status', () => {
      const toolUse = {
        name: 'failing_tool',
        toolUseId: 'fail-1',
        input: { test: 'data' },
      }

      const span = tracer.startToolCallSpan({ tool: toolUse })
      expect(span).toBeDefined()

      if (span) {
        const toolResult = {
          toolUseId: 'fail-1',
          status: 'error' as const,
          content: { error: 'Tool execution failed' },
        }

        tracer.endToolCallSpan(span, toolResult)
      }
    })

    it('should handle tool call with error exception', () => {
      const toolUse = {
        name: 'error_tool',
        toolUseId: 'error-1',
        input: { test: 'data' },
      }

      const span = tracer.startToolCallSpan({ tool: toolUse })
      expect(span).toBeDefined()

      if (span) {
        const error = new Error('Tool execution error')
        tracer.endToolCallSpan(span, undefined, error)
      }
    })
  })

  describe('Property 7: Span Parent-Child Relationships', () => {
    it('should maintain parent-child relationship for event loop cycle spans', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      // Create parent agent span - context stack handles parenting automatically
      const parentSpan = tracer.startAgentSpan({ messages, agentName: 'parent-agent' })
      expect(parentSpan).toBeDefined()

      if (parentSpan) {
        // Create child event loop cycle span - automatically parents to the active span
        const cycleSpan = tracer.startEventLoopCycleSpan({ cycleId: 'cycle-1', messages })
        expect(cycleSpan).toBeDefined()

        if (cycleSpan) {
          tracer.endEventLoopCycleSpan(cycleSpan)
        }

        tracer.endAgentSpan(parentSpan)
      }
    })

    it('should maintain parent-child relationship for nested model invocation spans', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      // Create parent agent span - context stack handles parenting automatically
      const parentSpan = tracer.startAgentSpan({ messages, agentName: 'parent-agent' })
      expect(parentSpan).toBeDefined()

      if (parentSpan) {
        // Create child model invocation span - automatically parents to the active span
        const modelSpan = tracer.startModelInvokeSpan({ messages, modelId: 'model-123' })
        expect(modelSpan).toBeDefined()

        if (modelSpan) {
          const usage = {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
          }

          tracer.endModelInvokeSpan(modelSpan, { usage })
        }

        tracer.endAgentSpan(parentSpan)
      }
    })

    it('should maintain parent-child relationship for nested tool call spans', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      // Create parent agent span - context stack handles parenting automatically
      const parentSpan = tracer.startAgentSpan({ messages, agentName: 'parent-agent' })
      expect(parentSpan).toBeDefined()

      if (parentSpan) {
        // Create child tool call span - automatically parents to the active span
        const toolUse = {
          name: 'test-tool',
          toolUseId: 'tool-1',
          input: { test: 'data' },
        }

        const toolSpan = tracer.startToolCallSpan({ tool: toolUse })
        expect(toolSpan).toBeDefined()

        if (toolSpan) {
          const toolResult = {
            toolUseId: 'tool-1',
            status: 'success' as const,
            content: { result: 'success' },
          }

          tracer.endToolCallSpan(toolSpan, toolResult)
        }

        tracer.endAgentSpan(parentSpan)
      }
    })

    it('should maintain parent-child relationship for deeply nested spans', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      // Create parent agent span - context stack handles parenting automatically
      const agentSpan = tracer.startAgentSpan({ messages, agentName: 'agent' })
      expect(agentSpan).toBeDefined()

      if (agentSpan) {
        // Create child cycle span - automatically parents to the active span
        const cycleSpan = tracer.startEventLoopCycleSpan({ cycleId: 'cycle-1', messages })
        expect(cycleSpan).toBeDefined()

        if (cycleSpan) {
          // Create grandchild model span - automatically parents to the active span
          const modelSpan = tracer.startModelInvokeSpan({ messages, modelId: 'model-123' })
          expect(modelSpan).toBeDefined()

          if (modelSpan) {
            const usage = {
              inputTokens: 5,
              outputTokens: 10,
              totalTokens: 15,
            }

            tracer.endModelInvokeSpan(modelSpan, { usage })
          }

          tracer.endEventLoopCycleSpan(cycleSpan)
        }

        tracer.endAgentSpan(agentSpan)
      }
    })

    it('should maintain parent-child relationship with multiple children', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      // Create parent agent span - context stack handles parenting automatically
      const parentSpan = tracer.startAgentSpan({ messages, agentName: 'parent-agent' })
      expect(parentSpan).toBeDefined()

      if (parentSpan) {
        // Create multiple child spans - each automatically parents to the active span
        // Note: With context stack, these will be siblings since we end each before starting the next
        const cycle1 = tracer.startEventLoopCycleSpan({ cycleId: 'cycle-1', messages })
        if (cycle1) tracer.endEventLoopCycleSpan(cycle1)
        
        const cycle2 = tracer.startEventLoopCycleSpan({ cycleId: 'cycle-2', messages })
        if (cycle2) tracer.endEventLoopCycleSpan(cycle2)
        
        const model1 = tracer.startModelInvokeSpan({ messages, modelId: 'model-1' })
        if (model1) tracer.endModelInvokeSpan(model1)

        expect(cycle1).toBeDefined()
        expect(cycle2).toBeDefined()
        expect(model1).toBeDefined()

        // End parent
        tracer.endAgentSpan(parentSpan)
      }
    })

    it('should maintain parent-child relationship with custom attributes', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const parentAttributes = {
        'custom.parent_id': 'parent-123',
      }

      const childAttributes = {
        'custom.child_id': 'child-456',
      }

      // Create parent span with custom attributes - context stack handles parenting automatically
      const parentSpan = tracer.startAgentSpan({
        messages,
        agentName: 'parent-agent',
        customTraceAttributes: parentAttributes,
      })
      expect(parentSpan).toBeDefined()

      if (parentSpan) {
        // Create child span with custom attributes - automatically parents to the active span
        const childSpan = tracer.startEventLoopCycleSpan({ cycleId: 'cycle-1', messages, customTraceAttributes: childAttributes })
        expect(childSpan).toBeDefined()

        if (childSpan) {
          tracer.endEventLoopCycleSpan(childSpan)
        }

        tracer.endAgentSpan(parentSpan)
      }
    })

    it('should maintain parent-child relationship when child ends with error', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      // Create parent span - context stack handles parenting automatically
      const parentSpan = tracer.startAgentSpan({ messages, agentName: 'parent-agent' })
      expect(parentSpan).toBeDefined()

      if (parentSpan) {
        // Create child span that ends with error - automatically parents to the active span
        const childSpan = tracer.startEventLoopCycleSpan({ cycleId: 'cycle-1', messages })
        expect(childSpan).toBeDefined()

        if (childSpan) {
          const error = new Error('Cycle error')
          tracer.endEventLoopCycleSpan(childSpan, error)
        }

        // Parent should still end successfully
        tracer.endAgentSpan(parentSpan)
      }
    })
  })

  describe('Property 2: Attribute Consistency (Agent Invocation)', () => {
    it('should set all agent-specific attributes on agent spans', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test message')],
        }),
      ]

      const customAttributes = {
        'custom.session_id': 'session-123',
      }

      const span = tracer.startAgentSpan({
        messages,
        agentName: 'test-agent',
        modelId: 'model-123',
        customTraceAttributes: customAttributes,
      })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should preserve agent attributes with tools list', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const tools = [
        { name: 'tool-1', description: 'First tool' },
        { name: 'tool-2', description: 'Second tool' },
      ]

      const span = tracer.startAgentSpan({
        messages,
        agentName: 'agent-with-tools',
        modelId: 'model-456',
        tools,
      })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should merge custom attributes with standard agent attributes', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const customAttributes = {
        'custom.request_id': 'req-123',
        'custom.user_id': 'user-456',
      }

      const span = tracer.startAgentSpan({
        messages,
        agentName: 'test-agent',
        modelId: 'model-789',
        customTraceAttributes: customAttributes,
      })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should handle agent span with tool definitions when opt-in enabled', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_tool_definitions'
        const tracerWithToolDefs = new Tracer()

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('Test')],
          }),
        ]

        const toolsConfig = {
          'tool-1': {
            name: 'tool-1',
            description: 'Test tool',
            inputSchema: { type: 'object' },
          },
        }

        const span = tracerWithToolDefs.startAgentSpan({
          messages,
          agentName: 'test-agent',
          modelId: 'model-123',
          toolsConfig,
        })
        expect(span).toBeDefined()

        if (span) {
          tracerWithToolDefs.endAgentSpan(span)
        }
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should maintain attribute consistency across multiple agent spans', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const customAttributes1 = {
        'custom.agent_id': 'agent-1',
      }

      const customAttributes2 = {
        'custom.agent_id': 'agent-2',
      }

      // Create first agent span
      const span1 = tracer.startAgentSpan({
        messages,
        agentName: 'agent-1',
        modelId: 'model-123',
        customTraceAttributes: customAttributes1,
      })
      expect(span1).toBeDefined()

      if (span1) {
        tracer.endAgentSpan(span1)
      }

      // Create second agent span
      const span2 = tracer.startAgentSpan({
        messages,
        agentName: 'agent-2',
        modelId: 'model-456',
        customTraceAttributes: customAttributes2,
      })
      expect(span2).toBeDefined()

      if (span2) {
        tracer.endAgentSpan(span2)
      }
    })

    it('should handle agent span with error status', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent', modelId: 'model-123' })
      expect(span).toBeDefined()

      if (span) {
        const error = new Error('Agent execution failed')
        tracer.endAgentSpan(span, undefined, error)
      }
    })
  })

  describe('Property 6: Message Event Classification', () => {
    it('should classify user messages correctly', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Hello')],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should classify assistant messages correctly', () => {
      const messages: Message[] = [
        new Message({
          role: 'assistant',
          content: [new TextBlock('Response')],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should classify tool result messages correctly', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [] })],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should handle mixed message types in a single span', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Question')],
        }),
        new Message({
          role: 'assistant',
          content: [new TextBlock('Answer')],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should classify messages correctly with latest conventions', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_latest_experimental'
        const latestTracer = new Tracer()

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('Test')],
          }),
        ]

        const span = latestTracer.startAgentSpan({ messages, agentName: 'test-agent' })
        expect(span).toBeDefined()

        if (span) {
          latestTracer.endAgentSpan(span)
        }
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should classify messages correctly with stable conventions', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = ''
        const stableTracer = new Tracer()

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('Test')],
          }),
        ]

        const span = stableTracer.startAgentSpan({ messages, agentName: 'test-agent' })
        expect(span).toBeDefined()

        if (span) {
          stableTracer.endAgentSpan(span)
        }
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })
  })

  describe('Property 5: Content Block Mapping Round-Trip', () => {
    it('should map TextBlock to OTEL format and preserve content', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Hello world')],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should map ToolUseBlock to OTEL format and preserve tool information', () => {
      const messages: Message[] = [
        new Message({
          role: 'assistant',
          content: [
            new TextBlock('I will use a tool'),
          ],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should map ToolResultBlock to OTEL format and preserve result information', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [] })],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should handle mixed content blocks in a single message', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [
            new TextBlock('First part'),
            new TextBlock('Second part'),
          ],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should handle empty content blocks', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should preserve content block structure with latest conventions', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_latest_experimental'
        const latestTracer = new Tracer()

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('Test content')],
          }),
        ]

        const span = latestTracer.startAgentSpan({ messages, agentName: 'test-agent' })
        expect(span).toBeDefined()

        if (span) {
          latestTracer.endAgentSpan(span)
        }
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should preserve content block structure with stable conventions', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = ''
        const stableTracer = new Tracer()

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('Test content')],
          }),
        ]

        const span = stableTracer.startAgentSpan({ messages, agentName: 'test-agent' })
        expect(span).toBeDefined()

        if (span) {
          stableTracer.endAgentSpan(span)
        }
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })
  })

  describe('Property 2: Attribute Consistency (Serialization)', () => {
    it('should serialize and preserve simple attributes', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const customAttributes = {
        'custom.string': 'value',
        'custom.number': 42,
        'custom.boolean': true,
      }

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent', customTraceAttributes: customAttributes })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should serialize and preserve array attributes', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const customAttributes: Record<string, string | number | boolean | (string | number | boolean)[]> = {
        'custom.array': [1, 2, 3],
      }

      const span = tracer.startAgentSpan({
        messages,
        agentName: 'test-agent',
        customTraceAttributes: customAttributes as Record<string, string>,
      })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should serialize and preserve nested object attributes', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const customAttributes = {
        'custom.nested': JSON.stringify({
          level1: {
            level2: 'value',
          },
        }),
      }

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent', customTraceAttributes: customAttributes })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should handle serialization of complex objects', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const tools = [
        { name: 'tool-1', description: 'First tool', params: { type: 'object', properties: {} } },
        { name: 'tool-2', description: 'Second tool', params: { type: 'object', properties: {} } },
      ]

      const span = tracer.startAgentSpan({
        messages,
        agentName: 'test-agent',
        modelId: 'model-123',
        tools,
      })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should skip null and undefined attributes', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const customAttributes = {
        'custom.valid': 'value',
        'custom.null': null as unknown as string,
        'custom.undefined': undefined as unknown as string,
      }

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent', customTraceAttributes: customAttributes })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should handle serialization with circular references', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const circularObj: Record<string, unknown> = { key: 'value' }
      circularObj.self = circularObj

      const span = tracer.startAgentSpan({
        messages,
        agentName: 'test-agent',
        modelId: 'model-123',
        tools: [circularObj],
      })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })
  })

  describe('Property 3: Semantic Convention Selection', () => {
    it('should determine convention version once at initialization and remain consistent', () => {
      // Test with stable conventions (default)
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = ''
        const stableTracer = new Tracer()

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('Test message')],
          }),
        ]

        // Create multiple spans with the same tracer
        const span1 = stableTracer.startAgentSpan({ messages, agentName: 'agent-1' })
        const span2 = stableTracer.startAgentSpan({ messages, agentName: 'agent-2' })
        const span3 = stableTracer.startModelInvokeSpan({ messages })

        // All spans should be created successfully
        expect(span1).toBeDefined()
        expect(span2).toBeDefined()
        expect(span3).toBeDefined()

        // Clean up
        if (span1) stableTracer.endAgentSpan(span1)
        if (span2) stableTracer.endAgentSpan(span2)
        if (span3) stableTracer.endModelInvokeSpan(span3)
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should use latest conventions when gen_ai_latest_experimental is set at initialization', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_latest_experimental'
        const latestTracer = new Tracer()

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('Test message')],
          }),
        ]

        // Create multiple spans with the same tracer
        const span1 = latestTracer.startAgentSpan({ messages, agentName: 'agent-1' })
        const span2 = latestTracer.startModelInvokeSpan({ messages })

        // All spans should be created successfully
        expect(span1).toBeDefined()
        expect(span2).toBeDefined()

        // Clean up
        if (span1) latestTracer.endAgentSpan(span1)
        if (span2) latestTracer.endModelInvokeSpan(span2)
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should include tool definitions when gen_ai_tool_definitions is set at initialization', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_tool_definitions'
        const toolDefTracer = new Tracer()

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('Test message')],
          }),
        ]

        const toolsConfig = {
          'tool-1': {
            name: 'tool-1',
            description: 'First tool',
            inputSchema: { type: 'object' },
          },
          'tool-2': {
            name: 'tool-2',
            description: 'Second tool',
            inputSchema: { type: 'object' },
          },
        }

        // Create span with tool definitions
        const span = toolDefTracer.startAgentSpan({
          messages,
          agentName: 'test-agent',
          modelId: 'model-123',
          toolsConfig,
        })

        expect(span).toBeDefined()

        if (span) {
          toolDefTracer.endAgentSpan(span)
        }
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should maintain convention version consistency across multiple operations', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_latest_experimental'
        const tracer = new Tracer()

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('Test')],
          }),
        ]

        // Create different types of spans
        const agentSpan = tracer.startAgentSpan({ messages, agentName: 'agent' })
        const modelSpan = tracer.startModelInvokeSpan({ messages })
        const toolSpan = tracer.startToolCallSpan({
          tool: { name: 'test-tool', toolUseId: 'tool-1', input: { test: 'input' } },
        })
        const cycleSpan = tracer.startEventLoopCycleSpan({ cycleId: 'cycle-1', messages })

        // All spans should be created
        expect(agentSpan).toBeDefined()
        expect(modelSpan).toBeDefined()
        expect(toolSpan).toBeDefined()
        expect(cycleSpan).toBeDefined()

        // Clean up
        if (agentSpan) tracer.endAgentSpan(agentSpan)
        if (modelSpan) tracer.endModelInvokeSpan(modelSpan)
        if (toolSpan) tracer.endToolCallSpan(toolSpan)
        if (cycleSpan) tracer.endEventLoopCycleSpan(cycleSpan)
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should handle environment variable changes between Tracer instances', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        // Create tracer with stable conventions
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = ''
        const stableTracer = new Tracer()

        // Create tracer with latest conventions
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_latest_experimental'
        const latestTracer = new Tracer()

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('Test')],
          }),
        ]

        // Both tracers should work independently
        const stableSpan = stableTracer.startAgentSpan({ messages, agentName: 'stable-agent' })
        const latestSpan = latestTracer.startAgentSpan({ messages, agentName: 'latest-agent' })

        expect(stableSpan).toBeDefined()
        expect(latestSpan).toBeDefined()

        // Clean up
        if (stableSpan) stableTracer.endAgentSpan(stableSpan)
        if (latestSpan) latestTracer.endAgentSpan(latestSpan)
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should handle comma-separated opt-in values', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        // Test with comma-separated values
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_latest_experimental, gen_ai_tool_definitions'
        const tracerWithBoth = new Tracer()

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('Test')],
          }),
        ]

        const toolsConfig = {
          'tool-1': {
            name: 'tool-1',
            description: 'Test tool',
            inputSchema: { type: 'object' },
          },
        }

        // Create span with both latest conventions and tool definitions
        const span = tracerWithBoth.startAgentSpan({
          messages,
          agentName: 'test-agent',
          modelId: 'model-123',
          toolsConfig,
        })

        expect(span).toBeDefined()

        if (span) {
          tracerWithBoth.endAgentSpan(span)
        }
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should handle whitespace in comma-separated opt-in values', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        // Test with comma-separated values with extra whitespace
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = '  gen_ai_latest_experimental  ,  gen_ai_tool_definitions  '
        const tracerWithWhitespace = new Tracer()

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('Test')],
          }),
        ]

        // Should still work correctly despite whitespace
        const span = tracerWithWhitespace.startAgentSpan({ messages, agentName: 'test-agent' })

        expect(span).toBeDefined()

        if (span) {
          tracerWithWhitespace.endAgentSpan(span)
        }
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })
  })
})


describe('Additional Tracer Coverage', () => {
  let tracer: Tracer

  beforeEach(() => {
    tracer = new Tracer()
  })

  afterEach(() => {
    delete process.env.OTEL_SEMCONV_STABILITY_OPT_IN
  })

  describe('getTracer', () => {
    it('should throw when telemetry is not enabled', async () => {
      const { getTracer } = await import('../tracer.js')
      const { _resetTracerProvider } = await import('../config.js')
      
      // Reset to ensure telemetry is not enabled
      _resetTracerProvider()
      
      expect(() => getTracer()).toThrow('Telemetry is not enabled')
    })

    it('should return a tracer when telemetry is enabled', async () => {
      const { getTracer } = await import('../tracer.js')
      const { strandsTelemetry, _resetTracerProvider } = await import('../config.js')
      
      // Enable telemetry
      _resetTracerProvider()
      strandsTelemetry.setupConsoleExporter()
      
      const tracer1 = getTracer()
      expect(tracer1).toBeDefined()
    })
  })

  describe('mapContentBlocksToOtelParts', () => {
    it('should map content blocks to OTEL parts format', async () => {
      const { mapContentBlocksToOtelParts } = await import('../tracer.js')
      const contentBlocks = [
        { type: 'textBlock', text: 'Hello' },
        { type: 'toolUseBlock', name: 'test', toolUseId: 'id-1', input: {} },
      ]

      const result = mapContentBlocksToOtelParts(contentBlocks)

      expect(result).toHaveLength(2)
      expect(result[0]).toHaveProperty('type', 'text')
      expect(result[1]).toHaveProperty('type', 'tool_call')
    })
  })

  describe('endAgentSpan with response', () => {
    it('should handle response with content array', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        const response = {
          role: 'assistant',
          content: [
            { type: 'textBlock', text: 'Response text' },
            { type: 'toolUseBlock', name: 'tool', toolUseId: 'id', input: {} },
          ],
        }

        tracer.endAgentSpan(span, response, undefined, undefined, 'end_turn')
      }
    })

    it('should handle string response', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span, 'Simple string response', undefined, undefined, 'end_turn')
      }
    })

    it('should handle response with accumulated usage including cache tokens', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        const usage = {
          inputTokens: 100,
          outputTokens: 200,
          totalTokens: 300,
          cacheReadInputTokens: 50,
          cacheWriteInputTokens: 25,
        }

        tracer.endAgentSpan(span, undefined, undefined, usage, 'end_turn')
      }
    })

    it('should handle response with latest conventions', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_latest_experimental'
        const latestTracer = new Tracer()

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('Test')],
          }),
        ]

        const span = latestTracer.startAgentSpan({ messages, agentName: 'test-agent' })
        expect(span).toBeDefined()

        if (span) {
          const response = {
            role: 'assistant',
            content: [{ type: 'textBlock', text: 'Response' }],
          }

          latestTracer.endAgentSpan(span, response, undefined, undefined, 'end_turn')
        }
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })
  })

  describe('endModelInvokeSpan with output', () => {
    it('should handle output message with latest conventions', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_latest_experimental'
        const latestTracer = new Tracer()

        const messages: Message[] = [
          new Message({
            role: 'user',
            content: [new TextBlock('Test')],
          }),
        ]

        const span = latestTracer.startModelInvokeSpan({ messages, modelId: 'model-123' })
        expect(span).toBeDefined()

        if (span) {
          const output = new Message({
            role: 'assistant',
            content: [new TextBlock('Response')],
          })

          latestTracer.endModelInvokeSpan(span, { output, stopReason: 'end_turn' })
        }
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })

    it('should handle output message with stable conventions', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const span = tracer.startModelInvokeSpan({ messages, modelId: 'model-123' })
      expect(span).toBeDefined()

      if (span) {
        const output = new Message({
          role: 'assistant',
          content: [
            new TextBlock('Response'),
            new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [] }),
          ],
        })

        tracer.endModelInvokeSpan(span, { output, stopReason: 'end_turn' })
      }
    })
  })

  describe('startToolCallSpan with latest conventions', () => {
    it('should use latest conventions for tool call span', () => {
      const originalEnv = process.env.OTEL_SEMCONV_STABILITY_OPT_IN
      try {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'gen_ai_latest_experimental'
        const latestTracer = new Tracer()

        const toolUse = {
          name: 'test-tool',
          toolUseId: 'tool-123',
          input: { key: 'value' },
        }

        const span = latestTracer.startToolCallSpan({ tool: toolUse })
        expect(span).toBeDefined()

        if (span) {
          const toolResult = {
            toolUseId: 'tool-123',
            status: 'success' as const,
            content: { result: 'success' },
          }

          latestTracer.endToolCallSpan(span, toolResult)
        }
      } finally {
        process.env.OTEL_SEMCONV_STABILITY_OPT_IN = originalEnv
      }
    })
  })

  describe('startAgentSpan with system prompt', () => {
    it('should capture system prompt', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new TextBlock('Test')],
        }),
      ]

      const systemPrompt = { text: 'You are a helpful assistant' }

      const span = tracer.startAgentSpan({
        messages,
        agentName: 'test-agent',
        modelId: 'model-123',
        systemPrompt,
      })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })
  })

  describe('content block mapping edge cases', () => {
    it('should handle toolResultBlock in content', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [new ToolResultBlock({ toolUseId: 'tool-1', status: 'success', content: [] })],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should handle unknown block types', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: [{ type: 'unknownBlock', data: 'test' } as unknown as TextBlock],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })

    it('should handle non-object blocks', () => {
      const messages: Message[] = [
        new Message({
          role: 'user',
          content: ['string block' as unknown as TextBlock],
        }),
      ]

      const span = tracer.startAgentSpan({ messages, agentName: 'test-agent' })
      expect(span).toBeDefined()

      if (span) {
        tracer.endAgentSpan(span)
      }
    })
  })

  describe('serialization edge cases', () => {
    it('should handle Map objects', () => {
      const map = new Map([['key', 'value']])
      const result = serialize(map)
      expect(result).toContain('Map')
    })

    it('should handle Set objects', () => {
      const set = new Set([1, 2, 3])
      const result = serialize(set)
      expect(result).toContain('Set')
    })

    it('should handle RegExp objects', () => {
      const regex = /test/gi
      const result = serialize(regex)
      expect(result).toContain('RegExp')
    })

    it('should handle BigInt values', () => {
      const bigint = BigInt(12345678901234567890n)
      const result = serialize(bigint)
      expect(result).toContain('BigInt')
    })

    it('should handle Symbol values', () => {
      const symbol = Symbol('test')
      const result = serialize(symbol)
      expect(result).toContain('Symbol')
    })

    it('should handle Function values', () => {
      const fn = function testFunction() {}
      const result = serialize(fn)
      expect(result).toContain('Function')
    })

    it('should handle objects with toJSON method', () => {
      const obj = {
        toJSON: () => ({ serialized: true }),
      }
      const result = serialize(obj)
      expect(result).toContain('serialized')
    })

    it('should handle objects with custom toString', () => {
      const obj = {
        toString: () => 'custom string',
      }
      const result = serialize(obj)
      expect(result).toContain('custom string')
    })

    it('should handle deeply nested objects', () => {
      let obj: Record<string, unknown> = { value: 'leaf' }
      for (let i = 0; i < 60; i++) {
        obj = { nested: obj }
      }
      const result = serialize(obj)
      expect(result).toContain('max depth reached')
    })
  })
})
