/**
 * Tests for TracingContext propagation to tools.
 *
 * These tests verify that when telemetry is enabled via StrandsTelemetry,
 * tools receive tracing context via ToolContext.tracing for distributed tracing.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Agent } from '../agent.js'
import { MockMessageModel } from '../../__fixtures__/mock-message-model.js'
import { collectGenerator } from '../../__fixtures__/model-test-helpers.js'
import { TextBlock, ToolResultBlock } from '../../types/messages.js'
import type { Tool, ToolContext, TracingContext } from '../../tools/tool.js'
import { StrandsTelemetry, _resetGlobalTelemetryHookProvider, _resetTracerProvider } from '../../telemetry/config.js'

/**
 * Creates a tool that captures the ToolContext it receives.
 * Used to verify tracing context propagation.
 */
function createContextCapturingTool(name: string): {
  tool: Tool
  getCapturedContext: () => ToolContext | undefined
  getCapturedTracingContext: () => TracingContext | undefined
} {
  let capturedContext: ToolContext | undefined
  let capturedTracingContext: TracingContext | undefined

  const tool: Tool = {
    name,
    description: `Tool that captures context: ${name}`,
    toolSpec: {
      name,
      description: `Tool that captures context: ${name}`,
      inputSchema: { type: 'object', properties: {} },
    },
    // eslint-disable-next-line require-yield
    async *stream(context: ToolContext) {
      capturedContext = context
      capturedTracingContext = context.tracing
      return new ToolResultBlock({
        toolUseId: context.toolUse.toolUseId,
        status: 'success',
        content: [new TextBlock('Tool executed')],
      })
    },
  }

  return {
    tool,
    getCapturedContext: () => capturedContext,
    getCapturedTracingContext: () => capturedTracingContext,
  }
}

describe('TracingContext propagation', () => {
  describe('when telemetry is enabled', () => {
    beforeEach(() => {
      // Enable telemetry by instantiating StrandsTelemetry
      new StrandsTelemetry()
    })

    afterEach(() => {
      // Reset global telemetry state
      _resetGlobalTelemetryHookProvider()
      _resetTracerProvider()
    })

    it('passes tracing context to tools', async () => {
      const { tool, getCapturedTracingContext } = createContextCapturingTool('test_tool')

      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({
        model,
        tools: [tool],
        printer: false,
      })

      await collectGenerator(agent.stream('Use the tool'))

      const tracingContext = getCapturedTracingContext()
      expect(tracingContext).toBeDefined()
      expect(tracingContext?.traceparent).toBeDefined()
      expect(tracingContext?.traceId).toBeDefined()
      expect(tracingContext?.spanId).toBeDefined()
      expect(tracingContext?.traceFlags).toBeDefined()
    })

    it('provides valid W3C traceparent format', async () => {
      const { tool, getCapturedTracingContext } = createContextCapturingTool('test_tool')

      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({
        model,
        tools: [tool],
        printer: false,
      })

      await collectGenerator(agent.stream('Use the tool'))

      const tracingContext = getCapturedTracingContext()
      expect(tracingContext).toBeDefined()

      // W3C traceparent format: {version}-{trace-id}-{parent-id}-{trace-flags}
      // Example: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
      const traceparent = tracingContext!.traceparent
      const parts = traceparent.split('-')

      expect(parts).toHaveLength(4)
      expect(parts[0]).toBe('00') // version
      expect(parts[1]).toHaveLength(32) // trace-id (32 hex chars)
      expect(parts[2]).toHaveLength(16) // parent-id/span-id (16 hex chars)
      expect(parts[3]).toMatch(/^[0-9a-f]{2}$/) // trace-flags (2 hex chars)
    })

    it('provides consistent traceId and spanId in traceparent', async () => {
      const { tool, getCapturedTracingContext } = createContextCapturingTool('test_tool')

      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({
        model,
        tools: [tool],
        printer: false,
      })

      await collectGenerator(agent.stream('Use the tool'))

      const tracingContext = getCapturedTracingContext()
      expect(tracingContext).toBeDefined()

      const parts = tracingContext!.traceparent.split('-')
      expect(parts[1]).toBe(tracingContext!.traceId)
      expect(parts[2]).toBe(tracingContext!.spanId)
    })

    it('provides unique spanId for each tool call', async () => {
      const { tool: tool1, getCapturedTracingContext: getContext1 } = createContextCapturingTool('tool_1')
      const { tool: tool2, getCapturedTracingContext: getContext2 } = createContextCapturingTool('tool_2')

      const model = new MockMessageModel()
        .addTurn([
          { type: 'toolUseBlock', name: 'tool_1', toolUseId: 'tool-1', input: {} },
          { type: 'toolUseBlock', name: 'tool_2', toolUseId: 'tool-2', input: {} },
        ])
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({
        model,
        tools: [tool1, tool2],
        printer: false,
      })

      await collectGenerator(agent.stream('Use both tools'))

      const context1 = getContext1()
      const context2 = getContext2()

      expect(context1).toBeDefined()
      expect(context2).toBeDefined()

      // Both tools should have the same traceId (same invocation)
      expect(context1!.traceId).toBe(context2!.traceId)

      // Each tool should have a unique spanId
      expect(context1!.spanId).not.toBe(context2!.spanId)
    })

    it('maintains same traceId across multiple cycles', async () => {
      const capturedTraceIds: string[] = []

      const tool: Tool = {
        name: 'capturing_tool',
        description: 'Tool that captures traceId',
        toolSpec: {
          name: 'capturing_tool',
          description: 'Tool that captures traceId',
          inputSchema: { type: 'object', properties: {} },
        },
        // eslint-disable-next-line require-yield
        async *stream(context: ToolContext) {
          if (context.tracing) {
            capturedTraceIds.push(context.tracing.traceId)
          }
          return new ToolResultBlock({
            toolUseId: context.toolUse.toolUseId,
            status: 'success',
            content: [new TextBlock('Done')],
          })
        },
      }

      const model = new MockMessageModel()
        // First cycle - tool use
        .addTurn({ type: 'toolUseBlock', name: 'capturing_tool', toolUseId: 'tool-1', input: {} })
        // Second cycle - another tool use
        .addTurn({ type: 'toolUseBlock', name: 'capturing_tool', toolUseId: 'tool-2', input: {} })
        // Final response
        .addTurn({ type: 'textBlock', text: 'All done' })

      const agent = new Agent({
        model,
        tools: [tool],
        printer: false,
      })

      await collectGenerator(agent.stream('Use the tool twice'))

      expect(capturedTraceIds).toHaveLength(2)
      // All tool calls in the same invocation should share the same traceId
      expect(capturedTraceIds[0]).toBe(capturedTraceIds[1])
    })
  })

  describe('when telemetry is disabled', () => {
    beforeEach(() => {
      // Ensure telemetry is disabled by resetting global state
      _resetGlobalTelemetryHookProvider()
      _resetTracerProvider()
    })

    it('does not pass tracing context to tools', async () => {
      const { tool, getCapturedTracingContext, getCapturedContext } = createContextCapturingTool('test_tool')

      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({
        model,
        tools: [tool],
        // No StrandsTelemetry instantiated, so telemetry is disabled
        printer: false,
      })

      await collectGenerator(agent.stream('Use the tool'))

      const context = getCapturedContext()
      expect(context).toBeDefined()
      expect(context?.toolUse).toBeDefined()
      expect(context?.agent).toBeDefined()

      // Tracing context should NOT be present
      const tracingContext = getCapturedTracingContext()
      expect(tracingContext).toBeUndefined()
    })

    it('does not pass tracing context when StrandsTelemetry is not instantiated', async () => {
      const { tool, getCapturedTracingContext } = createContextCapturingTool('test_tool')

      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({
        model,
        tools: [tool],
        printer: false,
      })

      await collectGenerator(agent.stream('Use the tool'))

      const tracingContext = getCapturedTracingContext()
      expect(tracingContext).toBeUndefined()
    })
  })

  describe('TracingContext structure', () => {
    beforeEach(() => {
      // Enable telemetry by instantiating StrandsTelemetry
      new StrandsTelemetry()
    })

    afterEach(() => {
      // Reset global telemetry state
      _resetGlobalTelemetryHookProvider()
      _resetTracerProvider()
    })

    it('includes all required W3C Trace Context fields', async () => {
      const { tool, getCapturedTracingContext } = createContextCapturingTool('test_tool')

      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({
        model,
        tools: [tool],
        printer: false,
      })

      await collectGenerator(agent.stream('Use the tool'))

      const tracingContext = getCapturedTracingContext()
      expect(tracingContext).toBeDefined()

      // Required fields
      expect(tracingContext).toHaveProperty('traceparent')
      expect(tracingContext).toHaveProperty('traceId')
      expect(tracingContext).toHaveProperty('spanId')
      expect(tracingContext).toHaveProperty('traceFlags')

      // Types
      expect(typeof tracingContext!.traceparent).toBe('string')
      expect(typeof tracingContext!.traceId).toBe('string')
      expect(typeof tracingContext!.spanId).toBe('string')
      expect(typeof tracingContext!.traceFlags).toBe('number')
    })

    it('traceFlags is a valid number', async () => {
      const { tool, getCapturedTracingContext } = createContextCapturingTool('test_tool')

      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'test_tool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({
        model,
        tools: [tool],
        printer: false,
      })

      await collectGenerator(agent.stream('Use the tool'))

      const tracingContext = getCapturedTracingContext()
      expect(tracingContext).toBeDefined()

      // traceFlags should be 0 or 1 (sampled flag)
      expect(tracingContext!.traceFlags).toBeGreaterThanOrEqual(0)
      expect(tracingContext!.traceFlags).toBeLessThanOrEqual(255) // 1 byte max
    })
  })

  describe('tool can use tracing context for HTTP headers', () => {
    beforeEach(() => {
      // Enable telemetry by instantiating StrandsTelemetry
      new StrandsTelemetry()
    })

    afterEach(() => {
      // Reset global telemetry state
      _resetGlobalTelemetryHookProvider()
      _resetTracerProvider()
    })

    it('provides headers suitable for W3C Trace Context propagation', async () => {
      let capturedHeaders: Record<string, string> | undefined

      const httpTool: Tool = {
        name: 'http_tool',
        description: 'Tool that simulates HTTP request with trace headers',
        toolSpec: {
          name: 'http_tool',
          description: 'Tool that simulates HTTP request with trace headers',
          inputSchema: { type: 'object', properties: {} },
        },
        // eslint-disable-next-line require-yield
        async *stream(context: ToolContext) {
          // Simulate building HTTP headers from tracing context
          const headers: Record<string, string> = {}
          if (context.tracing) {
            headers['traceparent'] = context.tracing.traceparent
            if (context.tracing.tracestate) {
              headers['tracestate'] = context.tracing.tracestate
            }
          }
          capturedHeaders = headers

          return new ToolResultBlock({
            toolUseId: context.toolUse.toolUseId,
            status: 'success',
            content: [new TextBlock('HTTP request made')],
          })
        },
      }

      const model = new MockMessageModel()
        .addTurn({ type: 'toolUseBlock', name: 'http_tool', toolUseId: 'tool-1', input: {} })
        .addTurn({ type: 'textBlock', text: 'Done' })

      const agent = new Agent({
        model,
        tools: [httpTool],
        printer: false,
      })

      await collectGenerator(agent.stream('Make HTTP request'))

      expect(capturedHeaders).toBeDefined()
      expect(capturedHeaders!['traceparent']).toBeDefined()
      // traceparent should be in valid W3C format
      expect(capturedHeaders!['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/)
    })
  })
})
