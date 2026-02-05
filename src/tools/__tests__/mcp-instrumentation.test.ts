import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { instrumentMcpClient } from '../mcp-instrumentation.js'
import type { McpClient } from '../../mcp.js'
import type { McpTool } from '../mcp-tool.js'
import type { JSONValue } from '../../types/json.js'
import { context, trace, TraceFlags } from '@opentelemetry/api'
import type { SpanContext } from '@opentelemetry/api'

describe('mcp-instrumentation', () => {
  let mockMcpClient: McpClient
  let originalCallTool: (tool: McpTool, args: JSONValue) => Promise<JSONValue>

  beforeEach(() => {
    originalCallTool = vi.fn().mockResolvedValue({ result: 'success' })
    mockMcpClient = {
      callTool: originalCallTool,
    } as unknown as McpClient
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('instrumentMcpClient', () => {
    it('should not instrument the same client twice', () => {
      instrumentMcpClient(mockMcpClient)
      const firstCallTool = mockMcpClient.callTool

      instrumentMcpClient(mockMcpClient)

      // The callTool should be the same (not wrapped again)
      expect(mockMcpClient.callTool).toBe(firstCallTool)
    })

    it('should call original callTool when no active span', async () => {
      instrumentMcpClient(mockMcpClient)

      const mockTool = { name: 'test-tool' } as McpTool
      const args = { key: 'value' }

      await mockMcpClient.callTool(mockTool, args)

      expect(originalCallTool).toHaveBeenCalledWith(mockTool, args)
    })

    it('should handle null args', async () => {
      instrumentMcpClient(mockMcpClient)

      const mockTool = { name: 'test-tool' } as McpTool

      // Mock an active span
      const mockSpan = {
        spanContext: () =>
          ({
            traceId: '1234567890abcdef1234567890abcdef',
            spanId: '1234567890abcdef',
            traceFlags: TraceFlags.SAMPLED,
          }) as SpanContext,
      }
      vi.spyOn(trace, 'getSpan').mockReturnValue(mockSpan as unknown as ReturnType<typeof trace.getSpan>)
      vi.spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan as unknown as ReturnType<typeof trace.getActiveSpan>)

      await mockMcpClient.callTool(mockTool, null)

      // Should have been called with enhanced args containing _meta
      expect(originalCallTool).toHaveBeenCalled()
      const callArgs = (originalCallTool as ReturnType<typeof vi.fn>).mock.calls[0]!
      expect(callArgs[1]).toHaveProperty('_meta')
    })

    it('should handle undefined args', async () => {
      instrumentMcpClient(mockMcpClient)

      const mockTool = { name: 'test-tool' } as McpTool

      // Mock an active span
      const mockSpan = {
        spanContext: () =>
          ({
            traceId: '1234567890abcdef1234567890abcdef',
            spanId: '1234567890abcdef',
            traceFlags: TraceFlags.SAMPLED,
          }) as SpanContext,
      }
      vi.spyOn(trace, 'getSpan').mockReturnValue(mockSpan as unknown as ReturnType<typeof trace.getSpan>)
      vi.spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan as unknown as ReturnType<typeof trace.getActiveSpan>)

      await mockMcpClient.callTool(mockTool, undefined as unknown as JSONValue)

      // Should have been called with enhanced args containing _meta
      expect(originalCallTool).toHaveBeenCalled()
      const callArgs = (originalCallTool as ReturnType<typeof vi.fn>).mock.calls[0]!
      expect(callArgs[1]).toHaveProperty('_meta')
    })

    it('should add _meta to object args when span is active', async () => {
      instrumentMcpClient(mockMcpClient)

      const mockTool = { name: 'test-tool' } as McpTool
      const args = { key: 'value' }

      // Mock an active span
      const mockSpan = {
        spanContext: () =>
          ({
            traceId: '1234567890abcdef1234567890abcdef',
            spanId: '1234567890abcdef',
            traceFlags: TraceFlags.SAMPLED,
          }) as SpanContext,
      }
      vi.spyOn(trace, 'getSpan').mockReturnValue(mockSpan as unknown as ReturnType<typeof trace.getSpan>)
      vi.spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan as unknown as ReturnType<typeof trace.getActiveSpan>)

      await mockMcpClient.callTool(mockTool, args)

      expect(originalCallTool).toHaveBeenCalled()
      const callArgs = (originalCallTool as ReturnType<typeof vi.fn>).mock.calls[0]!
      expect(callArgs[1]).toHaveProperty('key', 'value')
      expect(callArgs[1]).toHaveProperty('_meta')
    })

    it('should not modify array args', async () => {
      instrumentMcpClient(mockMcpClient)

      const mockTool = { name: 'test-tool' } as McpTool
      const args = [1, 2, 3]

      // Mock an active span
      const mockSpan = {
        spanContext: () =>
          ({
            traceId: '1234567890abcdef1234567890abcdef',
            spanId: '1234567890abcdef',
            traceFlags: TraceFlags.SAMPLED,
          }) as SpanContext,
      }
      vi.spyOn(trace, 'getSpan').mockReturnValue(mockSpan as unknown as ReturnType<typeof trace.getSpan>)
      vi.spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan as unknown as ReturnType<typeof trace.getActiveSpan>)

      await mockMcpClient.callTool(mockTool, args)

      // Array args should be passed through unchanged
      expect(originalCallTool).toHaveBeenCalledWith(mockTool, args)
    })

    it('should handle errors gracefully and fall back to original call', async () => {
      instrumentMcpClient(mockMcpClient)

      const mockTool = { name: 'test-tool' } as McpTool
      const args = { key: 'value' }

      // Mock context.active() to throw an error
      vi.spyOn(context, 'active').mockImplementation(() => {
        throw new Error('Context error')
      })

      await mockMcpClient.callTool(mockTool, args)

      // Should fall back to original call
      expect(originalCallTool).toHaveBeenCalledWith(mockTool, args)
    })

    it('should skip context injection when span has no trace ID', async () => {
      instrumentMcpClient(mockMcpClient)

      const mockTool = { name: 'test-tool' } as McpTool
      const args = { key: 'value' }

      // Mock a span with empty trace ID
      const mockSpan = {
        spanContext: () =>
          ({
            traceId: '',
            spanId: '',
            traceFlags: TraceFlags.NONE,
          }) as SpanContext,
      }
      vi.spyOn(trace, 'getSpan').mockReturnValue(mockSpan as unknown as ReturnType<typeof trace.getSpan>)
      vi.spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan as unknown as ReturnType<typeof trace.getActiveSpan>)

      await mockMcpClient.callTool(mockTool, args)

      // Should call without _meta since trace ID is empty
      expect(originalCallTool).toHaveBeenCalledWith(mockTool, args)
    })
  })
})
