/**
 * Basic telemetry test - console exporter only
 * 
 * Run with: npx tsx examples/test-telemetry-basic.ts
 */

import { strandsTelemetry } from '../src/telemetry/config.js'
import { getTracer } from '../src/telemetry/tracer.js'

// Setup telemetry with console exporter
strandsTelemetry.setupConsoleExporter()

// Get a tracer and create some spans
const tracer = getTracer({ traceAttributes: { 'test.name': 'basic-test' } })

console.log('Creating test spans...\n')

// Start an agent span
const agentSpan = tracer.startAgentSpan({
  messages: [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello!' }] }],
  agentName: 'test-agent',
  modelId: 'test-model',
})

// Start a model invoke span (child of agent)
const modelSpan = tracer.startModelInvokeSpan({
  messages: [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello!' }] }],
  modelId: 'test-model',
})

// End model span
tracer.endModelInvokeSpan(modelSpan, {
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
})

// End agent span
tracer.endAgentSpan(agentSpan, 'Test response', undefined, {
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
})

console.log('\nDone! Check the console output above for span data.')
