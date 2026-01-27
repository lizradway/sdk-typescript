/**
 * Test that OTEL SDK reads environment variables automatically
 * 
 * This demonstrates that you don't need to manually parse env vars -
 * the OTEL SDK handles OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS, etc.
 * 
 * Run with:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
 *   OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer token123" \
 *   OTEL_SERVICE_NAME=my-test-service \
 *   npx tsx examples/test-telemetry-env-vars.ts
 */

import { strandsTelemetry } from '../src/telemetry/config.js'
import { getTracer } from '../src/telemetry/tracer.js'

console.log('Environment variables:')
console.log('  OTEL_EXPORTER_OTLP_ENDPOINT:', process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '(not set, defaults to http://localhost:4318)')
console.log('  OTEL_EXPORTER_OTLP_HEADERS:', process.env.OTEL_EXPORTER_OTLP_HEADERS || '(not set)')
console.log('  OTEL_SERVICE_NAME:', process.env.OTEL_SERVICE_NAME || '(not set, defaults to strands-agents)')
console.log('')

// Setup OTLP exporter - OTEL SDK reads env vars automatically
// No need to pass endpoint or headers explicitly
strandsTelemetry.setupOtlpExporter()

const tracer = getTracer()

console.log('Creating a test span...')

const span = tracer.startAgentSpan({
  messages: [{ role: 'user', content: [{ type: 'textBlock', text: 'Test' }] }],
  agentName: 'env-test-agent',
})

tracer.endAgentSpan(span, 'Done')

console.log('Span created! Waiting for export...')

setTimeout(() => {
  console.log('Done!')
  process.exit(0)
}, 2000)
