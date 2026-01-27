/**
 * Test telemetry with actual Agent class and Bedrock, sending to Langfuse
 *
 * Prerequisites:
 * - AWS credentials configured
 * - Langfuse credentials set via environment variables:
 *   - OTEL_EXPORTER_OTLP_ENDPOINT=https://cloud.langfuse.com/api/public/otel
 *   - OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64(public_key:secret_key)>
 *
 * Run with: npx tsx examples/test-telemetry-with-agent.ts
 */

import { strandsTelemetry } from '../src/telemetry/config.js'
import { Agent } from '../src/agent/agent.js'
import { BedrockModel } from '../src/models/bedrock.js'
import { TextBlock } from '../src/types/messages.js'

// Setup telemetry - OTLP exporter reads from env vars automatically:
// - OTEL_EXPORTER_OTLP_ENDPOINT
// - OTEL_EXPORTER_OTLP_HEADERS
strandsTelemetry
  .setupOtlpExporter()
  .setupConsoleExporter() // Also log to console for debugging

async function main() {
  console.log('=== Testing Telemetry with Agent Class ===\n')

  // Create agent with trace attributes
  const agent = new Agent({
    model: new BedrockModel(),
    name: 'test-agent',
    traceAttributes: {
      'session.id': 'test-session-456',
      'user.id': 'test-user',
      'app.version': '1.0.0',
    },
    printer: false, // Disable printer to see telemetry output clearly
  })

  console.log('Agent created with traceAttributes')
  console.log('Invoking agent...\n')

  // Invoke the agent
  let responseText = ''
  for await (const event of agent.stream([
    { role: 'user', content: [new TextBlock('Say hello in one sentence.')] },
  ])) {
    if (event.type === 'textBlock') {
      responseText += event.text
    }
  }

  console.log('\n--- Agent Response ---')
  console.log(responseText)

  console.log('\n=== Check Langfuse dashboard for traces ===')
}

main().catch(console.error)
