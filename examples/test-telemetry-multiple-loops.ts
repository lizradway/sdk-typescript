/**
 * Test telemetry with multiple event loop cycles using real Bedrock model
 *
 * This demonstrates an agent that goes through multiple model calls
 * with tool use in between, showing proper span nesting in Langfuse.
 *
 * Prerequisites:
 * - AWS credentials configured
 * - OTEL env vars set for Langfuse
 *
 * Run with: npx tsx examples/test-telemetry-multiple-loops.ts
 */

import { strandsTelemetry } from '../src/telemetry/config.js'
import { Agent } from '../src/agent/agent.js'
import { BedrockModel } from '../src/models/bedrock.js'
import { tool } from '../src/tools/zod-tool.js'
import { TextBlock } from '../src/types/messages.js'
import { z } from 'zod'

// Setup telemetry - OTLP exporter reads from env vars
strandsTelemetry.setupOtlpExporter()

// Define simple calculator tools
const addTool = tool({
  name: 'add',
  description: 'Add two numbers together',
  inputSchema: z.object({
    a: z.number().describe('First number'),
    b: z.number().describe('Second number'),
  }),
  callback: ({ a, b }) => {
    return { text: String(a + b) }
  },
})

const multiplyTool = tool({
  name: 'multiply',
  description: 'Multiply two numbers together',
  inputSchema: z.object({
    a: z.number().describe('First number'),
    b: z.number().describe('Second number'),
  }),
  callback: ({ a, b }) => {
    return { text: String(a * b) }
  },
})

async function main() {
  console.log('=== Testing Multiple Event Loop Cycles with Bedrock ===\n')

  const agent = new Agent({
    model: new BedrockModel(),
    name: 'calculator-agent',
    tools: [addTool, multiplyTool],
    traceAttributes: {
      'session.id': 'multi-loop-session',
      'user.id': 'test-user',
    },
    printer: false,
  })

  // This prompt should trigger multiple tool calls
  let responseText = ''
  for await (const event of agent.stream([
    { role: 'user', content: [new TextBlock('What is 2+2? Then multiply that result by 3.')] },
  ])) {
    if (event.type === 'textBlock') {
      responseText += event.text
    }
  }

  console.log('Response:', responseText)
  console.log('\nCheck Langfuse for trace with multiple event loop cycles')
}

main().catch(console.error)
