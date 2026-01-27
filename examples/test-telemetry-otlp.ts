/**
 * OTLP telemetry test - sends traces to an OTLP endpoint
 * 
 * Prerequisites:
 * - Run a local OTLP collector or use a service like Jaeger
 * - Set OTEL_EXPORTER_OTLP_ENDPOINT env var (or it defaults to http://localhost:4318)
 * 
 * Run with: 
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npx tsx examples/test-telemetry-otlp.ts
 * 
 * Or with explicit endpoint:
 *   npx tsx examples/test-telemetry-otlp.ts
 */

import { strandsTelemetry } from '../src/telemetry/config.js'
import { getTracer } from '../src/telemetry/tracer.js'

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318'
console.log(`Setting up OTLP exporter to: ${endpoint}`)

// Setup telemetry with OTLP exporter
strandsTelemetry.setupOtlpExporter()

// Get a tracer
const tracer = getTracer({
  traceAttributes: {
    'session.id': 'test-session-123',
    'user.id': 'test-user',
  },
})

console.log('Creating test spans...')

// Simulate an agent invocation
const agentSpan = tracer.startAgentSpan({
  messages: [{ role: 'user', content: [{ type: 'textBlock', text: 'What is the weather?' }] }],
  agentName: 'weather-agent',
  modelId: 'anthropic.claude-3-sonnet',
  traceAttributes: { 'request.id': 'req-001' },
})

// Simulate model call
const modelSpan = tracer.startModelInvokeSpan({
  messages: [{ role: 'user', content: [{ type: 'textBlock', text: 'What is the weather?' }] }],
  modelId: 'anthropic.claude-3-sonnet',
})

// Simulate tool call
const toolSpan = tracer.startToolCallSpan({
  tool: { name: 'get_weather', toolUseId: 'tool-123', input: { location: 'Seattle' } },
})

// End tool span
tracer.endToolCallSpan(toolSpan, {
  toolUseId: 'tool-123',
  status: 'success',
  content: [{ type: 'text', text: 'Sunny, 72°F' }],
})

// End model span
tracer.endModelInvokeSpan(modelSpan, {
  usage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
  output: { role: 'assistant', content: [{ type: 'textBlock', text: 'The weather in Seattle is sunny, 72°F.' }] },
  stopReason: 'end_turn',
})

// End agent span
tracer.endAgentSpan(
  agentSpan,
  { content: [{ type: 'textBlock', text: 'The weather in Seattle is sunny, 72°F.' }] },
  undefined,
  { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
  'end_turn',
)

console.log('Spans created! Waiting for export...')

// Give time for batch processor to export
setTimeout(() => {
  console.log('Done! Check your OTLP collector for traces.')
  process.exit(0)
}, 3000)
