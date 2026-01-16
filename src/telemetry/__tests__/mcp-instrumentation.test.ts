/**
 * Tests for MCP instrumentation and distributed tracing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { context, trace } from '@opentelemetry/api'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { instrumentMcpClient, isInstrumented } from '../mcp-instrumentation.js'
import { McpClient } from '../../mcp.js'
import { McpTool } from '../../tools/mcp-tool.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

describe('MCP Instrumentation', () => {
  let mockTransport: Transport
  let mcpClient: McpClient
  let tracerProvider: NodeTracerProvider
  let exporter: InMemorySpanExporter

  beforeEach(() => {
    // Set up OpenTelemetry tracer provider for testing
    exporter = new InMemorySpanExporter()
    tracerProvider = new NodeTracerProvider()
    tracerProvider.addSpanProcessor(new SimpleSpanProcessor(exporter))
    tracerProvider.register()

    // Create a mock transport
    mockTransport = {
      start: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      onclose: vi.fn(),
      onerror: vi.fn(),
      onmessage: vi.fn(),
    }

    // Create MCP client (instrumentation is auto-applied in constructor)
    mcpClient = new McpClient({
      transport: mockTransport,
      applicationName: 'test-app',
      applicationVersion: '1.0.0',
    })
  })

  afterEach(async () => {
    vi.clearAllMocks()
    // Shutdown tracer provider
    await tracerProvider.shutdown()
  })

  describe('instrumentMcpClient', () => {
    it('should mark client as instrumented', () => {
      expect(isInstrumented(mcpClient)).toBe(true)
    })

    it('should be idempotent - not instrument twice', () => {
      const client = new McpClient({ transport: mockTransport })

      // First instrumentation
      instrumentMcpClient(client)
      expect(isInstrumented(client)).toBe(true)

      // Store original method
      const firstCallTool = client.callTool

      // Second instrumentation should not change the method
      instrumentMcpClient(client)
      expect(client.callTool).toBe(firstCallTool)
    })

    it('should inject OpenTelemetry context when active span exists', async () => {
      // Create a real tracer and span
      const tracer = trace.getTracer('test-tracer')

      // Mock the SDK client's callToolStream to capture arguments
      let capturedArgs: any
      const mockSdkClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        experimental: {
          tasks: {
            callToolStream: vi.fn().mockImplementation((args) => {
              capturedArgs = args
              // Return an async generator that yields a result
              return (async function* () {
                yield { type: 'result', result: { content: [{ type: 'text', text: 'result' }] } }
              })()
            }),
          },
        },
      }

      // Replace the internal client
      ;(mcpClient as any)._client = mockSdkClient
      ;(mcpClient as any)._connected = true

      // Create a mock tool
      const mockTool = {
        name: 'test-tool',
      } as McpTool

      // Call the tool within a real span
      await tracer.startActiveSpan('test-span', async (span) => {
        try {
          await mcpClient.callTool(mockTool, { param: 'value' })
        } finally {
          span.end()
        }
      })

      // Verify that _meta field was injected
      expect(capturedArgs).toBeDefined()
      expect(capturedArgs).toHaveProperty('arguments')
      expect(capturedArgs.arguments).toHaveProperty('_meta')
      expect(capturedArgs.arguments._meta).toBeDefined()

      // The _meta field should contain trace context
      expect(typeof capturedArgs.arguments._meta).toBe('object')
    })

    it('should not inject context when no active span exists', async () => {
      // Mock the SDK client's callToolStream to capture arguments
      let capturedArgs: any
      const mockSdkClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        experimental: {
          tasks: {
            callToolStream: vi.fn().mockImplementation((args) => {
              capturedArgs = args
              return (async function* () {
                yield { type: 'result', result: { content: [{ type: 'text', text: 'result' }] } }
              })()
            }),
          },
        },
      }

      // Replace the internal client
      ;(mcpClient as any)._client = mockSdkClient
      ;(mcpClient as any)._connected = true

      // Create a mock tool
      const mockTool = {
        name: 'test-tool',
      } as McpTool

      // Call without active span
      await mcpClient.callTool(mockTool, { param: 'value' })

      // Verify that _meta field was NOT injected
      expect(capturedArgs).toBeDefined()
      expect(capturedArgs.arguments).not.toHaveProperty('_meta')
    })

    it('should handle null/undefined arguments by creating object with _meta', async () => {
      // Create a real tracer and span
      const tracer = trace.getTracer('test-tracer')

      let capturedArgs: any
      const mockSdkClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        experimental: {
          tasks: {
            callToolStream: vi.fn().mockImplementation((args) => {
              capturedArgs = args
              return (async function* () {
                yield { type: 'result', result: { content: [{ type: 'text', text: 'result' }] } }
              })()
            }),
          },
        },
      }

      ;(mcpClient as any)._client = mockSdkClient
      ;(mcpClient as any)._connected = true

      const mockTool = {
        name: 'test-tool',
      } as McpTool

      // Call with null arguments within a real span
      await tracer.startActiveSpan('test-span', async (span) => {
        try {
          await mcpClient.callTool(mockTool, null as any)
        } finally {
          span.end()
        }
      })

      // Should have created an object with _meta
      expect(capturedArgs).toBeDefined()
      expect(capturedArgs.arguments).toHaveProperty('_meta')
    })

    it('should preserve existing arguments when injecting _meta', async () => {
      // Create a real tracer and span
      const tracer = trace.getTracer('test-tracer')

      let capturedArgs: any
      const mockSdkClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        experimental: {
          tasks: {
            callToolStream: vi.fn().mockImplementation((args) => {
              capturedArgs = args
              return (async function* () {
                yield { type: 'result', result: { content: [{ type: 'text', text: 'result' }] } }
              })()
            }),
          },
        },
      }

      ;(mcpClient as any)._client = mockSdkClient
      ;(mcpClient as any)._connected = true

      const mockTool = {
        name: 'test-tool',
      } as McpTool

      const originalArgs = { param1: 'value1', param2: 'value2' }

      await tracer.startActiveSpan('test-span', async (span) => {
        try {
          await mcpClient.callTool(mockTool, originalArgs)
        } finally {
          span.end()
        }
      })

      // Should preserve original arguments
      expect(capturedArgs.arguments).toHaveProperty('param1', 'value1')
      expect(capturedArgs.arguments).toHaveProperty('param2', 'value2')
      // And add _meta
      expect(capturedArgs.arguments).toHaveProperty('_meta')
    })

    it('should handle errors gracefully and propagate them', async () => {
      // Create a real tracer and span
      const tracer = trace.getTracer('test-tracer')

      const mockSdkClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        experimental: {
          tasks: {
            callToolStream: vi.fn().mockImplementation(() => {
              // eslint-disable-next-line require-yield
              return (async function* () {
                throw new Error('Tool execution failed')
              })()
            }),
          },
        },
      }

      ;(mcpClient as any)._client = mockSdkClient
      ;(mcpClient as any)._connected = true

      const mockTool = {
        name: 'test-tool',
      } as McpTool

      // Should propagate the error
      await expect(
        tracer.startActiveSpan('test-span', async (span) => {
          try {
            return await mcpClient.callTool(mockTool, { param: 'value' })
          } finally {
            span.end()
          }
        })
      ).rejects.toThrow('Tool execution failed')
    })

    it('should not inject context for array arguments', async () => {
      const mockSpan = {
        spanContext: () => ({
          traceId: '12345678901234567890123456789012',
          spanId: '1234567890123456',
          traceFlags: 1,
        }),
        setAttribute: vi.fn(),
        setAttributes: vi.fn(),
        addEvent: vi.fn(),
        setStatus: vi.fn(),
        updateName: vi.fn(),
        end: vi.fn(),
        isRecording: () => true,
        recordException: vi.fn(),
      }

      const spanContext = trace.setSpan(context.active(), mockSpan as any)

      const mockSdkClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        experimental: {
          tasks: {
            callToolStream: vi.fn().mockImplementation(() => {
              // This will throw an error in the actual implementation
              throw new Error('MCP Protocol Error: Tool arguments must be a JSON Object (named parameters). Received: Array')
            }),
          },
        },
      }

      ;(mcpClient as any)._client = mockSdkClient
      ;(mcpClient as any)._connected = true

      const mockTool = {
        name: 'test-tool',
      } as McpTool

      // Call with array arguments (invalid for MCP)
      await expect(
        context.with(spanContext, async () => {
          return mcpClient.callTool(mockTool, ['value1', 'value2'] as any)
        })
      ).rejects.toThrow('MCP Protocol Error')
    })

    it('should inject W3C traceparent header format', async () => {
      // Create a real tracer and span
      const tracer = trace.getTracer('test-tracer')

      let capturedArgs: any
      const mockSdkClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        experimental: {
          tasks: {
            callToolStream: vi.fn().mockImplementation((args) => {
              capturedArgs = args
              return (async function* () {
                yield { type: 'result', result: { content: [{ type: 'text', text: 'result' }] } }
              })()
            }),
          },
        },
      }

      ;(mcpClient as any)._client = mockSdkClient
      ;(mcpClient as any)._connected = true

      const mockTool = {
        name: 'test-tool',
      } as McpTool

      await tracer.startActiveSpan('test-span', async (span) => {
        try {
          await mcpClient.callTool(mockTool, { param: 'value' })
        } finally {
          span.end()
        }
      })

      // Verify W3C traceparent format
      expect(capturedArgs.arguments._meta).toBeDefined()
      expect(capturedArgs.arguments._meta.traceparent).toBeDefined()

      // W3C traceparent format: version-traceId-spanId-flags
      const traceparent = capturedArgs.arguments._meta.traceparent
      expect(typeof traceparent).toBe('string')

      const parts = traceparent.split('-')
      expect(parts).toHaveLength(4)
      expect(parts[0]).toBe('00') // version
      expect(parts[1]).toHaveLength(32) // traceId (32 hex chars)
      expect(parts[2]).toHaveLength(16) // spanId (16 hex chars)
      expect(parts[3]).toMatch(/^[0-9a-f]{2}$/) // flags (2 hex chars)
    })
  })

  describe('isInstrumented', () => {
    it('should return true for instrumented clients', () => {
      const client = new McpClient({ transport: mockTransport })
      expect(isInstrumented(client)).toBe(true)
    })

    it('should return false for non-instrumented clients', () => {
      // Create a client without going through constructor
      const client = Object.create(McpClient.prototype)
      expect(isInstrumented(client)).toBe(false)
    })
  })
})
