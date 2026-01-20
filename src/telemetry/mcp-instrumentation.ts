/**
 * MCP instrumentation for distributed tracing.
 *
 * This module patches MCP client calls to inject OpenTelemetry context,
 * enabling distributed tracing across agent and MCP server boundaries.
 *
 * Based on the Python SDK implementation:
 * https://github.com/strands-agents/sdk-python/blob/main/src/strands/tools/mcp/mcp_instrumentation.py
 */

import { context, propagation, trace } from '@opentelemetry/api'
import { logger } from '../logging/index.js'
import type { McpClient } from '../mcp.js'
import type { McpTool } from '../tools/mcp-tool.js'
import type { JSONValue } from '../types/json.js'

/**
 * Symbol to track if a client has been instrumented.
 */
const INSTRUMENTED_SYMBOL = Symbol('mcp-instrumented')

/**
 * Carrier object for OpenTelemetry context propagation.
 */
interface ContextCarrier {
  [key: string]: string | string[] | undefined
}

/**
 * Patches an MCP client to inject OpenTelemetry context into tool calls.
 * This enables distributed tracing by propagating trace context to MCP servers.
 *
 * @param mcpClient - The MCP client to instrument
 */
export function instrumentMcpClient(mcpClient: McpClient): void {
  // Check if already instrumented
  if ((mcpClient as unknown as Record<symbol, boolean>)[INSTRUMENTED_SYMBOL]) {
    logger.warn('mcp_client=<already_instrumented> | skipping duplicate instrumentation')
    return
  }

  // Mark as instrumented
  ;(mcpClient as unknown as Record<symbol, boolean>)[INSTRUMENTED_SYMBOL] = true
  logger.warn('mcp_client=<instrumented> | mcp client instrumentation applied')

  // Store original callTool method
  const originalCallTool = mcpClient.callTool.bind(mcpClient)

  // Patch callTool to inject tracing context
  mcpClient.callTool = async function (tool: McpTool, args: JSONValue): Promise<JSONValue> {
    try {
      // Get current OpenTelemetry context
      const currentContext = context.active()
      const currentSpan = trace.getSpan(currentContext)

      // Check if we have an active span OR if there's a span in the context
      // The span might not be "active" but still present in the context
      const spanToUse = currentSpan || trace.getActiveSpan()

      // Only inject context if we have a span with a valid trace ID
      if (spanToUse && spanToUse.spanContext().traceId) {
        // Create carrier for context propagation
        const carrier: ContextCarrier = {}

        // Inject current context into carrier (this will include the span)
        propagation.inject(currentContext, carrier)

        // Prepare arguments with _meta field for context propagation
        let enhancedArgs = args

        if (args === null || args === undefined) {
          enhancedArgs = { _meta: carrier as unknown as JSONValue }
        } else if (typeof args === 'object' && !Array.isArray(args)) {
          // Add _meta field to existing arguments
          enhancedArgs = {
            ...args,
            _meta: carrier as unknown as JSONValue,
          }
        }

        logger.warn(
          `trace_id=<${spanToUse.spanContext().traceId}>, span_id=<${spanToUse.spanContext().spanId}> | injecting otel context into mcp tool call`
        )

        return await originalCallTool(tool, enhancedArgs)
      }

      logger.warn('no_active_span=<true> | skipping context injection for mcp tool call')
      // No active span, call without context injection
      return await originalCallTool(tool, args)
    } catch (error) {
      logger.warn(`error=<${error}> | failed to inject context into mcp tool call`)
      // Fall back to original call on error
      return await originalCallTool(tool, args)
    }
  }
}

/**
 * Checks if an MCP client has been instrumented.
 *
 * @param mcpClient - The MCP client to check
 * @returns True if the client has been instrumented
 */
export function isInstrumented(mcpClient: McpClient): boolean {
  return !!(mcpClient as unknown as Record<symbol, boolean>)[INSTRUMENTED_SYMBOL]
}
