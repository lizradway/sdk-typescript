/**
 * Test that telemetry works as no-op when not configured
 * 
 * This demonstrates that you can use the tracer without configuring
 * any exporters - OTEL returns a no-op tracer that safely does nothing.
 * 
 * Run with: npx tsx examples/test-telemetry-noop.ts
 */

import { getTracer } from '../src/telemetry/tracer.js'

console.log('Testing no-op tracer (no telemetry configured)...\n')

// Get a tracer WITHOUT configuring strandsTelemetry
// This should work - OTEL returns a no-op tracer
const tracer = getTracer({ traceAttributes: { 'test.name': 'noop-test' } })

console.log('Tracer created:', tracer ? 'yes' : 'no')

// Create spans - these should all work without errors
const agentSpan = tracer.startAgentSpan({
  messages: [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello!' }] }],
  agentName: 'test-agent',
})

console.log('Agent span created:', agentSpan ? 'yes' : 'no')

const modelSpan = tracer.startModelInvokeSpan({
  messages: [{ role: 'user', content: [{ type: 'textBlock', text: 'Hello!' }] }],
})

console.log('Model span created:', modelSpan ? 'yes' : 'no')

// End spans
tracer.endModelInvokeSpan(modelSpan, {
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
})

tracer.endAgentSpan(agentSpan, 'Response', undefined, {
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
})

console.log('\nAll operations completed without errors!')
console.log('No spans were exported (no exporter configured).')
