import type { ToolSpec, ToolUse } from './types.js'
import { TextBlock, ToolResultBlock } from '../types/messages.js'
import type { AgentData } from '../types/agent.js'
import { normalizeError } from '../errors.js'

export type { ToolSpec } from './types.js'

/**
 * Tracing context for distributed tracing across tool boundaries.
 * Tools can use this to propagate trace context to external services
 * and create child spans for sub-operations within the tool.
 *
 * @example
 * ```typescript
 * // HTTP API tool - adds W3C Trace Context headers
 * class HttpApiTool extends Tool {
 *   async *stream(toolContext: ToolContext) {
 *     const headers: Record<string, string> = {}
 *     if (toolContext.tracing) {
 *       headers['traceparent'] = toolContext.tracing.traceparent
 *       if (toolContext.tracing.tracestate) {
 *         headers['tracestate'] = toolContext.tracing.tracestate
 *       }
 *     }
 *     const response = await fetch(url, { headers })
 *     // ...
 *   }
 * }
 *
 * // Tool with child spans for sub-operations
 * class DatabaseTool extends Tool {
 *   async *stream(toolContext: ToolContext) {
 *     const result = await toolContext.tracing?.withSpan('db-query', async () => {
 *       return await db.query('SELECT * FROM users')
 *     })
 *     // ...
 *   }
 * }
 * ```
 */
export interface TracingContext {
  /**
   * W3C Trace Context traceparent header value.
   * Format: `{version}-{trace-id}-{parent-id}-{trace-flags}`
   * Example: `00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01`
   * @see https://www.w3.org/TR/trace-context/#traceparent-header
   */
  traceparent: string

  /**
   * W3C Trace Context tracestate header value (optional).
   * Vendor-specific trace information.
   * @see https://www.w3.org/TR/trace-context/#tracestate-header
   */
  tracestate?: string

  /**
   * The trace ID (32 hex characters).
   * Extracted from traceparent for convenience.
   */
  traceId: string

  /**
   * The span ID / parent ID (16 hex characters).
   * Extracted from traceparent for convenience.
   */
  spanId: string

  /**
   * Trace flags (1 byte as number).
   * Bit 0 = sampled flag.
   */
  traceFlags: number

  /**
   * Create a child span for a sub-operation within the tool.
   * The child span will be parented to the current tool span.
   *
   * @param name - Name of the child span (e.g., 'db-query', 'api-call')
   * @param fn - Async function to execute within the span
   * @returns The result of the function
   *
   * @example
   * ```typescript
   * const result = await toolContext.tracing?.withSpan('fetch-data', async () => {
   *   return await fetchFromApi()
   * })
   * ```
   */
  withSpan<T>(name: string, fn: () => Promise<T>): Promise<T>
}

/**
 * Context provided to tool implementations during execution.
 * Contains framework-level state and information from the agent invocation.
 */
export interface ToolContext {
  /**
   * The tool use request that triggered this tool execution.
   * Contains the tool name, toolUseId, and input parameters.
   */
  toolUse: ToolUse

  /**
   * The agent instance that is executing this tool.
   * Provides access to agent state and other agent-level information.
   */
  agent: AgentData

  /**
   * Tracing context for distributed tracing (optional).
   * Present when telemetry is enabled and a tool span exists.
   * Tools can use this to propagate trace context to external services.
   *
   * @example
   * ```typescript
   * // Add W3C Trace Context headers to HTTP requests
   * if (toolContext.tracing) {
   *   headers['traceparent'] = toolContext.tracing.traceparent
   * }
   * ```
   */
  tracing?: TracingContext
}

/**
 * Data for a tool stream event.
 */
export interface ToolStreamEventData {
  /**
   * Discriminator for tool stream events.
   */
  type: 'toolStreamEvent'

  /**
   * Caller-provided data for the progress update.
   * Can be any type of data the tool wants to report.
   */
  data?: unknown
}

/**
 * Event yielded during tool execution to report streaming progress.
 * Tools can yield zero or more of these events before returning the final ToolResult.
 *
 * @example
 * ```typescript
 * const streamEvent = new ToolStreamEvent({
 *   data: 'Processing step 1...'
 * })
 *
 * // Or with structured data
 * const streamEvent = new ToolStreamEvent({
 *   data: { progress: 50, message: 'Halfway complete' }
 * })
 * ```
 */
export class ToolStreamEvent implements ToolStreamEventData {
  /**
   * Discriminator for tool stream events.
   */
  readonly type = 'toolStreamEvent' as const

  /**
   * Caller-provided data for the progress update.
   * Can be any type of data the tool wants to report.
   */
  readonly data?: unknown

  constructor(eventData: { data?: unknown }) {
    if (eventData.data !== undefined) {
      this.data = eventData.data
    }
  }
}

/**
 * Type alias for the async generator returned by tool stream methods.
 * Yields ToolStreamEvents during execution and returns a ToolResultBlock.
 */
export type ToolStreamGenerator = AsyncGenerator<ToolStreamEvent, ToolResultBlock, undefined>

/**
 * Interface for tool implementations.
 * Tools are used by agents to interact with their environment and perform specific actions.
 *
 * The Tool interface provides a streaming execution model where tools can yield
 * progress events during execution before returning a final result.
 *
 * Most implementations should use FunctionTool rather than implementing this interface directly.
 */
export abstract class Tool {
  /**
   * The unique name of the tool.
   * This MUST match the name in the toolSpec.
   */
  abstract name: string
  /**
   * Human-readable description of what the tool does.
   * This helps the model understand when to use the tool.
   *
   * This MUST match the description in the toolSpec.description.
   */
  abstract description: string
  /**
   * OpenAPI JSON specification for the tool.
   * Defines the tool's name, description, and input schema.
   */
  abstract toolSpec: ToolSpec

  /**
   * Executes the tool with streaming support.
   * Yields zero or more ToolStreamEvents during execution, then returns
   * exactly one ToolResultBlock as the final value.
   *
   * @param toolContext - Context information including the tool use request and invocation state
   * @returns Async generator that yields ToolStreamEvents and returns a ToolResultBlock
   *
   * @example
   * ```typescript
   * const context = {
   *   toolUse: {
   *     name: 'calculator',
   *     toolUseId: 'calc-123',
   *     input: { operation: 'add', a: 5, b: 3 }
   *   },
   * }
   *
   * // The return value is only accessible via explicit .next() calls
   * const generator = tool.stream(context)
   * for await (const event of generator) {
   *   // Only yields are captured here
   *   console.log('Progress:', event.data)
   * }
   * // Or manually handle the return value:
   * let result = await generator.next()
   * while (!result.done) {
   *   console.log('Progress:', result.value.data)
   *   result = await generator.next()
   * }
   * console.log('Final result:', result.value.status)
   * ```
   */
  abstract stream(toolContext: ToolContext): ToolStreamGenerator
}

/**
 * Extended tool interface that supports direct invocation with type-safe input and output.
 * This interface is useful for testing and standalone tool execution.
 *
 * @typeParam TInput - Type for the tool's input parameters
 * @typeParam TReturn - Type for the tool's return value
 */
export interface InvokableTool<TInput, TReturn> extends Tool {
  /**
   * Invokes the tool directly with type-safe input and returns the unwrapped result.
   *
   * Unlike stream(), this method:
   * - Returns the raw result (not wrapped in ToolResult)
   * - Consumes async generators and returns only the final value
   * - Lets errors throw naturally (not wrapped in error ToolResult)
   *
   * @param input - The input parameters for the tool
   * @param context - Optional tool execution context
   * @returns The unwrapped result
   */
  invoke(input: TInput, context?: ToolContext): Promise<TReturn>
}

/**
 * Creates an error ToolResultBlock from an error object.
 * Ensures all errors are normalized to Error objects and includes the original error
 * in the ToolResultBlock for inspection by hooks, error handlers, and event loop.
 *
 * TODO: Implement consistent logging format as defined in #30
 * This error should be logged to the caller using the established logging pattern.
 *
 * @param error - The error that occurred (can be Error object or any thrown value)
 * @param toolUseId - The tool use ID for the ToolResultBlock
 * @returns A ToolResultBlock with error status, error message content, and original error object
 */
export function createErrorResult(error: unknown, toolUseId: string): ToolResultBlock {
  // Ensure error is an Error object (wrap non-Error values)
  const errorObject = normalizeError(error)

  return new ToolResultBlock({
    toolUseId,
    status: 'error',
    content: [new TextBlock(`Error: ${errorObject.message}`)],
    error: errorObject,
  })
}
