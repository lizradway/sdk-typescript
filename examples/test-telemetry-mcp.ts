/**
 * Test MCP distributed tracing
 * 
 * This demonstrates how telemetry works with MCP (Model Context Protocol) tools,
 * showing trace context propagation across service boundaries.
 * 
 * Prerequisites:
 * - An MCP server running (e.g., the test server from test/integ/__fixtures__)
 * - OTLP collector if you want to see distributed traces
 * 
 * Run with: npx tsx examples/test-telemetry-mcp.ts
 */

import { strandsTelemetry } from '../src/telemetry/config.js'
import { getTracer } from '../src/telemetry/tracer.js'
import { context, propagation, trace } from '@opentelemetry/api'

// Setup telemetry with console exporter
strandsTelemetry.setupConsoleExporter()

const tracer = getTracer({
  traceAttributes: {
    'service.name': 'mcp-client',
    'mcp.test': 'distributed-tracing',
  },
})

console.log('=== Testing MCP Distributed Tracing ===\n')

// Simulate MCP client calling an MCP server
async function simulateMcpCall() {
  // Start agent span
  const agentSpan = tracer.startAgentSpan({
    messages: [{ role: 'user', content: [{ type: 'textBlock', text: 'Use MCP tool' }] }],
    agentName: 'mcp-test-agent',
    tools: [{ name: 'mcp_tool' }],
  })

  // Start tool call span for MCP tool
  const toolSpan = tracer.startToolCallSpan({
    tool: {
      name: 'mcp_echo',
      toolUseId: 'mcp-tool-1',
      input: { message: 'Hello from MCP client!' },
    },
    traceAttributes: {
      'mcp.server': 'test-server',
      'mcp.transport': 'http',
    },
  })

  // Demonstrate trace context propagation
  // In a real MCP call, this would be sent in HTTP headers
  const carrier: Record<string, string> = {}
  const activeContext = trace.setSpan(context.active(), toolSpan)
  propagation.inject(activeContext, carrier)

  console.log('Trace context to propagate to MCP server:')
  console.log('  traceparent:', carrier['traceparent'])
  console.log('  tracestate:', carrier['tracestate'] || '(none)')
  console.log('')

  // Simulate MCP server processing (in reality, this happens on the server)
  console.log('--- Simulating MCP Server Side ---')
  
  // Extract context on server side
  const extractedContext = propagation.extract(context.active(), carrier)
  const serverTracer = trace.getTracer('mcp-server')
  
  // Server creates its own span, linked to client's trace
  const serverSpan = serverTracer.startSpan('mcp_echo_handler', {
    attributes: {
      'mcp.tool.name': 'echo',
      'mcp.request.id': 'req-123',
    },
  }, extractedContext)

  // Simulate server work
  console.log('  Server processing request...')
  serverSpan.setAttribute('mcp.response.status', 'success')
  serverSpan.end()

  console.log('--- Back to MCP Client Side ---\n')

  // End tool span with result
  tracer.endToolCallSpan(toolSpan, {
    toolUseId: 'mcp-tool-1',
    status: 'success',
    content: [{ type: 'text', text: 'Echo: Hello from MCP client!' }],
  })

  // End agent span
  tracer.endAgentSpan(
    agentSpan,
    { content: [{ type: 'textBlock', text: 'MCP tool returned: Echo: Hello from MCP client!' }] },
    undefined,
    { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  )
}

// Run the simulation
simulateMcpCall().then(() => {
  console.log('=== MCP Distributed Tracing Test Complete ===')
  console.log('')
  console.log('In a real scenario with OTLP export:')
  console.log('- Client spans and server spans share the same trace ID')
  console.log('- Server span is a child of the client tool call span')
  console.log('- You can see the full distributed trace in Jaeger/Zipkin/etc.')
})
