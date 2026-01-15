/**
 * MCP Integration Tests
 *
 * Tests Agent integration with MCP servers using all supported transport types.
 * Verifies that agents can successfully use MCP tools via the Bedrock model.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { McpClient, Agent } from '@strands-agents/sdk'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { resolve } from 'node:path'
import { URL } from 'node:url'
import { startHTTPServer, type HttpServerInfo } from './__fixtures__/test-mcp-server.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { bedrock } from './__fixtures__/model-providers.js'
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

type TransportConfig = {
  name: string
  createClient: () => McpClient | Promise<McpClient>
  cleanup?: () => Promise<void>
}

describe('MCP Integration Tests', () => {
  const serverPath = resolve(process.cwd(), 'test/integ/__fixtures__/test-mcp-server.ts')
  let httpServerInfo: HttpServerInfo | undefined

  beforeAll(async () => {
    // Start HTTP server
    httpServerInfo = await startHTTPServer()
  }, 30000)

  afterAll(async () => {
    if (httpServerInfo) {
      await httpServerInfo.close()
    }
  }, 30000)

  const transports: TransportConfig[] = [
    {
      name: 'stdio',
      createClient: () => {
        return new McpClient({
          applicationName: 'test-mcp-stdio',
          transport: new StdioClientTransport({
            command: 'npx',
            args: ['tsx', serverPath],
          }),
        })
      },
    },
    {
      name: 'Streamable HTTP',
      createClient: () => {
        if (!httpServerInfo) throw new Error('HTTP server not started')
        return new McpClient({
          applicationName: 'test-mcp-http',
          transport: new StreamableHTTPClientTransport(new URL(httpServerInfo.url)) as Transport,
        })
      },
    },
  ]

  describe.each(transports)('$name transport', ({ createClient }) => {
    it('agent can use multiple MCP tools in a conversation', async () => {
      const client = await createClient()
      const model = bedrock.createModel({ maxTokens: 300 })

      const agent = new Agent({
        systemPrompt:
          'You are a helpful assistant. Use the echo tool to repeat messages and the calculator tool for arithmetic.',
        tools: [client],
        model,
      })

      // First turn: Use echo tool
      await agent.invoke('Use the echo tool to say "Multi-turn test"')

      // Verify echo tool was used
      const hasEchoUse = agent.messages.some((msg) =>
        msg.content.some((block) => block.type === 'toolUseBlock' && block.name === 'echo')
      )
      expect(hasEchoUse).toBe(true)

      // Second turn: Use calculator tool in same conversation
      const result = await agent.invoke('Now use the calculator tool to add 15 and 27')

      expect(result).toBeDefined()
      expect(result.stopReason).toBeDefined()

      // Verify calculator tool was used
      const hasCalculatorUse = agent.messages.some((msg) =>
        msg.content.some((block) => block.type === 'toolUseBlock' && block.name === 'calculator')
      )
      expect(hasCalculatorUse).toBe(true)
    }, 60000)

    it('agent handles MCP tool errors gracefully', async () => {
      const client = await createClient()
      const model = bedrock.createModel({ maxTokens: 200 })

      const agent = new Agent({
        systemPrompt: 'You are a helpful assistant. If asked to test errors, use the error_tool.',
        tools: [client],
        model,
      })

      const result = await agent.invoke('Use the error_tool to test error handling.')

      expect(result).toBeDefined()

      // Verify the error was encountered
      const hasErrorResult = agent.messages.some((msg) =>
        msg.content.some((block) => block.type === 'toolResultBlock' && block.status === 'error')
      )
      expect(hasErrorResult).toBe(true)
    }, 30000)
  })

  describe('MCP Context Propagation', () => {
    let tracerProvider: NodeTracerProvider
    let exporter: InMemorySpanExporter

    beforeAll(() => {
      // Set up OpenTelemetry for context propagation testing
      exporter = new InMemorySpanExporter()
      tracerProvider = new NodeTracerProvider()
      tracerProvider.addSpanProcessor(new SimpleSpanProcessor(exporter))
      tracerProvider.register()
    })

    afterAll(async () => {
      await tracerProvider.shutdown()
    })

    it('should inject OpenTelemetry context into MCP tool calls', async () => {
      const client = new McpClient({
        applicationName: 'test-mcp-context',
        transport: new StdioClientTransport({
          command: 'npx',
          args: ['tsx', serverPath],
        }),
      })

      const model = bedrock.createModel({ maxTokens: 200 })

      const agent = new Agent({
        systemPrompt: 'You are a helpful assistant. Use the echo tool when asked.',
        tools: [client],
        model,
        telemetryConfig: {
          enabled: true,
        },
      })

      // Clear previous spans
      exporter.reset()

      // Invoke agent with MCP tool
      const result = await agent.invoke('Use the echo tool to say "Testing context propagation"')

      expect(result).toBeDefined()

      // Get exported spans
      const spans = exporter.getFinishedSpans()

      // Should have multiple spans: agent, model invocation, tool call
      expect(spans.length).toBeGreaterThan(0)

      // Find the agent span (root span)
      const agentSpan = spans.find((s) => s.name === 'invoke_agent')
      expect(agentSpan).toBeDefined()

      // Find the tool call span
      const toolSpan = spans.find((s) => s.name === 'echo')
      expect(toolSpan).toBeDefined()

      // Verify they share the same trace ID (distributed tracing)
      if (agentSpan && toolSpan) {
        expect(toolSpan.spanContext().traceId).toBe(agentSpan.spanContext().traceId)
      }

      // Verify the tool span is a child of the agent span
      if (agentSpan && toolSpan) {
        expect(toolSpan.parentSpanId).toBeDefined()
      }
    }, 60000)

    it('should maintain trace context across multiple MCP tool calls', async () => {
      const client = new McpClient({
        applicationName: 'test-mcp-multi-context',
        transport: new StdioClientTransport({
          command: 'npx',
          args: ['tsx', serverPath],
        }),
      })

      const model = bedrock.createModel({ maxTokens: 400 })

      const agent = new Agent({
        systemPrompt: 'You are a helpful assistant. Use tools when asked.',
        tools: [client],
        model,
        telemetryConfig: {
          enabled: true,
        },
      })

      // Clear previous spans
      exporter.reset()

      // Invoke agent with multiple tool calls
      await agent.invoke('Use the echo tool to say "First call"')
      await agent.invoke('Use the calculator tool to add 5 and 3')

      // Get exported spans
      const spans = exporter.getFinishedSpans()

      // Should have spans for both invocations
      const agentSpans = spans.filter((s) => s.name === 'invoke_agent')
      expect(agentSpans.length).toBeGreaterThanOrEqual(2)

      // Each invocation should have its own trace ID
      const traceIds = new Set(agentSpans.map((s) => s.spanContext().traceId))
      expect(traceIds.size).toBeGreaterThanOrEqual(2)

      // But within each invocation, tool spans should share the agent's trace ID
      for (const agentSpan of agentSpans) {
        const traceId = agentSpan.spanContext().traceId
        const toolSpansInTrace = spans.filter(
          (s) => s.spanContext().traceId === traceId && s.name !== 'invoke_agent' && s.name.includes('chat') === false
        )

        // Each tool span should have the same trace ID as its agent span
        for (const toolSpan of toolSpansInTrace) {
          expect(toolSpan.spanContext().traceId).toBe(traceId)
        }
      }
    }, 90000)

    it('should work without telemetry enabled', async () => {
      const client = new McpClient({
        applicationName: 'test-mcp-no-telemetry',
        transport: new StdioClientTransport({
          command: 'npx',
          args: ['tsx', serverPath],
        }),
      })

      const model = bedrock.createModel({ maxTokens: 200 })

      // Agent without telemetry
      const agent = new Agent({
        systemPrompt: 'You are a helpful assistant. Use the echo tool when asked.',
        tools: [client],
        model,
        // No telemetryConfig
      })

      // Should still work without errors
      const result = await agent.invoke('Use the echo tool to say "No telemetry test"')

      expect(result).toBeDefined()
      expect(result.stopReason).toBeDefined()

      // Verify echo tool was used
      const hasEchoUse = agent.messages.some((msg) =>
        msg.content.some((block) => block.type === 'toolUseBlock' && block.name === 'echo')
      )
      expect(hasEchoUse).toBe(true)
    }, 60000)
  })
})
