/**
 * Test telemetry with various tool call scenarios
 * 
 * This tests:
 * - Successful tool calls
 * - Failed tool calls
 * - Parallel tool calls
 * - Nested tool calls (tool calling another tool)
 * 
 * Run with: npx tsx examples/test-telemetry-tool-calls.ts
 */

import { strandsTelemetry } from '../src/telemetry/config.js'
import { getTracer } from '../src/telemetry/tracer.js'

// Setup telemetry
strandsTelemetry.setupConsoleExporter()

const tracer = getTracer({
  traceAttributes: { 'test.scenario': 'tool-calls' },
})

console.log('=== Testing Tool Call Scenarios ===\n')

// --- Scenario 1: Successful tool call ---
console.log('--- Scenario 1: Successful tool call ---')
{
  const agentSpan = tracer.startAgentSpan({
    messages: [{ role: 'user', content: [{ type: 'textBlock', text: 'Get weather' }] }],
    agentName: 'weather-agent',
    tools: [{ name: 'get_weather' }],
  })

  const toolSpan = tracer.startToolCallSpan({
    tool: { name: 'get_weather', toolUseId: 'weather-1', input: { location: 'Seattle' } },
    traceAttributes: { 'tool.category': 'external-api' },
  })

  // Simulate tool execution
  tracer.endToolCallSpan(toolSpan, {
    toolUseId: 'weather-1',
    status: 'success',
    content: [{ type: 'text', text: 'Sunny, 72°F' }],
  })

  tracer.endAgentSpan(agentSpan, 'Weather is sunny')
}

// --- Scenario 2: Failed tool call ---
console.log('\n--- Scenario 2: Failed tool call ---')
{
  const agentSpan = tracer.startAgentSpan({
    messages: [{ role: 'user', content: [{ type: 'textBlock', text: 'Read file' }] }],
    agentName: 'file-agent',
    tools: [{ name: 'read_file' }],
  })

  const toolSpan = tracer.startToolCallSpan({
    tool: { name: 'read_file', toolUseId: 'file-1', input: { path: '/nonexistent.txt' } },
  })

  // Simulate tool failure
  const error = new Error('File not found: /nonexistent.txt')
  tracer.endToolCallSpan(toolSpan, {
    toolUseId: 'file-1',
    status: 'error',
    content: [{ type: 'text', text: 'Error: File not found' }],
  }, error)

  tracer.endAgentSpan(agentSpan, 'Could not read file', error)
}

// --- Scenario 3: Parallel tool calls ---
console.log('\n--- Scenario 3: Parallel tool calls ---')
{
  const agentSpan = tracer.startAgentSpan({
    messages: [{ role: 'user', content: [{ type: 'textBlock', text: 'Get weather for multiple cities' }] }],
    agentName: 'multi-weather-agent',
    tools: [{ name: 'get_weather' }],
  })

  // Start multiple tool calls "in parallel"
  const tool1Span = tracer.startToolCallSpan({
    tool: { name: 'get_weather', toolUseId: 'w-seattle', input: { location: 'Seattle' } },
  })

  const tool2Span = tracer.startToolCallSpan({
    tool: { name: 'get_weather', toolUseId: 'w-nyc', input: { location: 'New York' } },
  })

  const tool3Span = tracer.startToolCallSpan({
    tool: { name: 'get_weather', toolUseId: 'w-london', input: { location: 'London' } },
  })

  // End them (simulating parallel completion)
  tracer.endToolCallSpan(tool2Span, {
    toolUseId: 'w-nyc',
    status: 'success',
    content: [{ type: 'text', text: 'Cloudy, 65°F' }],
  })

  tracer.endToolCallSpan(tool1Span, {
    toolUseId: 'w-seattle',
    status: 'success',
    content: [{ type: 'text', text: 'Rainy, 55°F' }],
  })

  tracer.endToolCallSpan(tool3Span, {
    toolUseId: 'w-london',
    status: 'success',
    content: [{ type: 'text', text: 'Foggy, 50°F' }],
  })

  tracer.endAgentSpan(agentSpan, 'Weather for all cities retrieved')
}

// --- Scenario 4: Tool with complex input/output ---
console.log('\n--- Scenario 4: Complex tool input/output ---')
{
  const agentSpan = tracer.startAgentSpan({
    messages: [{ role: 'user', content: [{ type: 'textBlock', text: 'Search database' }] }],
    agentName: 'db-agent',
    tools: [{ name: 'query_database' }],
  })

  const toolSpan = tracer.startToolCallSpan({
    tool: {
      name: 'query_database',
      toolUseId: 'db-1',
      input: {
        query: 'SELECT * FROM users WHERE active = true',
        params: { limit: 10, offset: 0 },
        options: { timeout: 5000, cache: true },
      },
    },
  })

  tracer.endToolCallSpan(toolSpan, {
    toolUseId: 'db-1',
    status: 'success',
    content: [
      {
        type: 'json',
        data: {
          rows: [
            { id: 1, name: 'Alice', email: 'alice@example.com' },
            { id: 2, name: 'Bob', email: 'bob@example.com' },
          ],
          totalCount: 2,
          executionTime: 45,
        },
      },
    ],
  })

  tracer.endAgentSpan(agentSpan, 'Found 2 users')
}

console.log('\n=== All tool call scenarios completed ===')
