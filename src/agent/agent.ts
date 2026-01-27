import {
  AgentResult,
  type AgentStreamEvent,
  BedrockModel,
  contentBlockFromData,
  type ContentBlock,
  type ContentBlockData,
  type JSONValue,
  McpClient,
  Message,
  type MessageData,
  type SystemPrompt,
  type SystemPromptData,
  TextBlock,
  type Tool,
  type ToolContext,
  ToolResultBlock,
  type ToolStreamEvent,
  type ToolStreamGenerator,
  ToolUseBlock,
} from '../index.js'
import { systemPromptFromData } from '../types/messages.js'
import { normalizeError, ConcurrentInvocationError } from '../errors.js'
import type { BaseModelConfig, Model, StreamOptions } from '../models/model.js'
import { ToolRegistry } from '../registry/tool-registry.js'
import { AgentState } from './state.js'
import type { AgentData } from '../types/agent.js'
import { AgentPrinter, getDefaultAppender, type Printer } from './printer.js'
import type { HookProvider } from '../hooks/types.js'
import { SlidingWindowConversationManager } from '../conversation-manager/sliding-window-conversation-manager.js'
import { HookRegistryImplementation } from '../hooks/registry.js'
import {
  HookEvent,
  AfterInvocationEvent,
  AfterModelCallEvent,
  AfterToolCallEvent,
  AfterToolsEvent,
  BeforeInvocationEvent,
  BeforeModelCallEvent,
  BeforeToolCallEvent,
  BeforeToolsEvent,
  MessageAddedEvent,
  ModelStreamEventHook,
} from '../hooks/events.js'
import { getTracer, Tracer } from '../telemetry/tracer.js'
import type { Usage } from '../models/streaming.js'
import type { AttributeValue } from '@opentelemetry/api'
import { createEmptyUsage, accumulateUsage, getModelId } from '../telemetry/utils.js'
import { validateIdentifier, IdentifierType } from '../identifier.js'
import { context, trace } from '@opentelemetry/api'

/**
 * Recursive type definition for nested tool arrays.
 * Allows tools to be organized in nested arrays of any depth.
 */
export type ToolList = (Tool | McpClient | ToolList)[]

/**
 * Configuration object for creating a new Agent.
 */
export type AgentConfig = {
  /**
   * The model instance that the agent will use to make decisions.
   * Accepts either a Model instance or a string representing a Bedrock model ID.
   * When a string is provided, it will be used to create a BedrockModel instance.
   *
   * @example
   * ```typescript
   * // Using a string model ID (creates BedrockModel)
   * const agent = new Agent({
   *   model: 'anthropic.claude-3-5-sonnet-20240620-v1:0'
   * })
   *
   * // Using an explicit BedrockModel instance with configuration
   * const agent = new Agent({
   *   model: new BedrockModel({
   *     modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
   *     temperature: 0.7,
   *     maxTokens: 2048
   *   })
   * })
   * ```
   */
  model?: Model<BaseModelConfig> | string
  /** An initial set of messages to seed the agent's conversation history. */
  messages?: Message[] | MessageData[]
  /**
   * An initial set of tools to register with the agent.
   * Accepts nested arrays of tools at any depth, which will be flattened automatically.
   */
  tools?: ToolList
  /**
   * A system prompt which guides model behavior.
   */
  systemPrompt?: SystemPrompt | SystemPromptData
  /** Optional initial state values for the agent. */
  state?: Record<string, JSONValue>
  /**
   * Enable automatic printing of agent output to console.
   * When true, prints text generation, reasoning, and tool usage as they occur.
   * Defaults to true.
   */
  printer?: boolean
  /**
   * Conversation manager for handling message history and context overflow.
   * Defaults to SlidingWindowConversationManager with windowSize of 40.
   */
  conversationManager?: HookProvider
  /**
   * Hook providers to register with the agent.
   * Hooks enable observing and extending agent behavior.
   */
  hooks?: HookProvider[]
  /**
   * Custom trace attributes to include in all spans.
   * These attributes are merged with standard attributes in telemetry spans.
   * Telemetry must be enabled globally via StrandsTelemetry for these to take effect.
   *
   * @example
   * ```typescript
   * // First, initialize global telemetry
   * strandsTelemetry.setupOtlpExporter()
   *
   * // Then create agent with trace attributes
   * const agent = new Agent({
   *   model,
   *   traceAttributes: {
   *     'session.id': 'abc-1234',
   *     'user.id': 'user@example.com',
   *   },
   * })
   * ```
   */
  traceAttributes?: Record<string, AttributeValue>
  /**
   * Optional name for the agent.
   * Defaults to "Strands Agents" if not provided.
   */
  name?: string
  /**
   * Optional unique identifier for the agent.
   * If not provided, a random identifier will be generated.
   */
  agentId?: string
}

/**
 * Arguments for invoking an agent.
 *
 * Supports multiple input formats:
 * - `string` - User text input (wrapped in TextBlock, creates user Message)
 * - `ContentBlock[]` | `ContentBlockData[]` - Array of content blocks (creates single user Message)
 * - `Message[]` | `MessageData[]` - Array of messages (appends all to conversation)
 */
export type InvokeArgs = string | ContentBlock[] | ContentBlockData[] | Message[] | MessageData[]

const DEFAULT_AGENT_NAME = 'Strands Agents'

/**
 * Orchestrates the interaction between a model, a set of tools, and MCP clients.
 * The Agent is responsible for managing the lifecycle of tools and clients
 * and invoking the core decision-making loop.
 */
export class Agent implements AgentData {
  /**
   * The conversation history of messages between user and assistant.
   */
  public readonly messages: Message[]
  /**
   * Agent state storage accessible to tools and application logic.
   * State is not passed to the model during inference.
   */
  public readonly state: AgentState
  /**
   * Conversation manager for handling message history and context overflow.
   */
  public readonly conversationManager: HookProvider
  /**
   * Hook registry for managing event callbacks.
   * Hooks enable observing and extending agent behavior.
   */
  public readonly hooks: HookRegistryImplementation

  /**
   * The model provider used by the agent for inference.
   */
  public model: Model

  /**
   * The system prompt to pass to the model provider.
   */
  public systemPrompt?: SystemPrompt

  /**
   * The name of the agent.
   */
  public name: string

  /**
   * The unique identifier of the agent instance.
   */
  public readonly agentId: string

  private _toolRegistry: ToolRegistry
  private _mcpClients: McpClient[]
  private _initialized: boolean
  private _isInvoking: boolean = false
  private _printer?: Printer
  private _tracer?: Tracer
  private _traceSpan?: import('@opentelemetry/api').Span | undefined
  private _accumulatedTokenUsage: Usage = createEmptyUsage()
  private _inputMessagesForTelemetry: Message[] = []

  /**
   * Creates an instance of the Agent.
   * @param config - The configuration for the agent.
   */
  constructor(config?: AgentConfig) {
    // Initialize public fields
    this.messages = (config?.messages ?? []).map((msg) => (msg instanceof Message ? msg : Message.fromMessageData(msg)))
    this.state = new AgentState(config?.state)
    this.conversationManager = config?.conversationManager ?? new SlidingWindowConversationManager({ windowSize: 40 })
    this.name = config?.name ?? DEFAULT_AGENT_NAME
    this.agentId = validateIdentifier(config?.agentId, IdentifierType.AGENT)

    // Initialize hooks and register conversation manager hooks
    this.hooks = new HookRegistryImplementation()
    this.hooks.addHook(this.conversationManager)
    this.hooks.addAllHooks(config?.hooks ?? [])

    if (typeof config?.model === 'string') {
      this.model = new BedrockModel({ modelId: config.model })
    } else {
      this.model = config?.model ?? new BedrockModel()
    }

    const { tools, mcpClients } = flattenTools(config?.tools ?? [])
    this._toolRegistry = new ToolRegistry(tools)
    this._mcpClients = mcpClients

    if (config?.systemPrompt !== undefined) {
      this.systemPrompt = systemPromptFromData(config.systemPrompt)
    }

    // Create printer if printer is enabled (default: true)
    const printer = config?.printer ?? true
    if (printer) {
      this._printer = new AgentPrinter(getDefaultAppender())
    }

    // Initialize tracer - OTEL returns no-op tracer if not configured
    this._tracer = getTracer({ traceAttributes: config?.traceAttributes })

    this._initialized = false
  }

  public async initialize(): Promise<void> {
    if (this._initialized) {
      return
    }

    await Promise.all(
      this._mcpClients.map(async (client) => {
        const tools = await client.listTools()
        this._toolRegistry.addAll(tools)
      })
    )

    this._initialized = true
  }

  /**
   * Acquires a lock to prevent concurrent invocations.
   * Returns a Disposable that releases the lock when disposed.
   */
  private acquireLock(): { [Symbol.dispose]: () => void } {
    if (this._isInvoking) {
      throw new ConcurrentInvocationError(
        'Agent is already processing an invocation. Wait for the current invoke() or stream() call to complete before invoking again.'
      )
    }
    this._isInvoking = true

    return {
      [Symbol.dispose]: (): void => {
        this._isInvoking = false
      },
    }
  }

  /**
   * Starts a trace span for the agent invocation.
   * Stores the span on the instance for use in the event loop.
   *
   * @param messages - The input messages
   * @returns The created span, or undefined if telemetry is disabled
   */
  private _startAgentTraceSpan(messages: Message[]): import('@opentelemetry/api').Span | undefined {
    if (!this._tracer) {
      return undefined
    }
    
    // Reset accumulated token usage for this invocation
    this._accumulatedTokenUsage = createEmptyUsage()
    
    // Reset input messages for telemetry (will be captured when user messages are added)
    this._inputMessagesForTelemetry = []
    
    // Get the model ID from the model
    const modelId = getModelId(this.model)
    
    const handle = this._tracer.startAgentSpan({
      messages,
      agentName: this.name,
      agentId: this.agentId,
      modelId,
      tools: this.tools,
      systemPrompt: this.systemPrompt,
    })
    
    return handle
  }

  /**
   * Ends the trace span for the agent invocation.
   *
   * @param error - Optional error to record
   * @param response - Optional response message to record
   * @param stopReason - Optional stop reason (finish_reason) for the response
   */
  private _endAgentTraceSpan(error?: Error, response?: Message, stopReason?: string): void {
    if (!this._tracer || !this._traceSpan) {
      return
    }

    const span = this._traceSpan
    this._traceSpan = undefined // Prevent double-ending if called again

    this._tracer.endAgentSpan(span, response, error, this._accumulatedTokenUsage, stopReason)
  }

  /**
   * The tools this agent can use.
   */
  get tools(): Tool[] {
    return this._toolRegistry.values()
  }

  /**
   * The tool registry for managing the agent's tools.
   */
  get toolRegistry(): ToolRegistry {
    return this._toolRegistry
  }

  /**
   * Invokes the agent and returns the final result.
   *
   * This is a convenience method that consumes the stream() method and returns
   * only the final AgentResult. Use stream() if you need access to intermediate
   * streaming events.
   *
   * @param args - Arguments for invoking the agent
   * @returns Promise that resolves to the final AgentResult
   *
   * @example
   * ```typescript
   * const agent = new Agent({ model, tools })
   * const result = await agent.invoke('What is 2 + 2?')
   * console.log(result.lastMessage) // Agent's response
   * ```
   */
  public async invoke(args: InvokeArgs): Promise<AgentResult> {
    const gen = this.stream(args)
    let result = await gen.next()
    while (!result.done) {
      result = await gen.next()
    }
    return result.value
  }

  /**
   * Streams the agent execution, yielding events and returning the final result.
   *
   * The agent loop manages the conversation flow by:
   * 1. Streaming model responses and yielding all events
   * 2. Executing tools when the model requests them
   * 3. Continuing the loop until the model completes without tool use
   *
   * Use this method when you need access to intermediate streaming events.
   * For simple request/response without streaming, use invoke() instead.
   *
   * An explicit goal of this method is to always leave the message array in a way that
   * the agent can be reinvoked with a user prompt after this method completes. To that end
   * assistant messages containing tool uses are only added after tool execution succeeds
   * with valid toolResponses
   *
   * @param args - Arguments for invoking the agent
   * @returns Async generator that yields AgentStreamEvent objects and returns AgentResult
   *
   * @example
   * ```typescript
   * const agent = new Agent({ model, tools })
   *
   * for await (const event of agent.stream('Hello')) {
   *   console.log('Event:', event.type)
   * }
   * // Messages array is mutated in place and contains the full conversation
   * ```
   */
  public async *stream(args: InvokeArgs): AsyncGenerator<AgentStreamEvent, AgentResult, undefined> {
    using _lock = this.acquireLock()

    await this.initialize()

    // Delegate to _stream and process events through printer and hooks
    const streamGenerator = this._stream(args)
    let result = await streamGenerator.next()

    while (!result.done) {
      const event = result.value

      // Invoke hook callbacks for Hook Events (except MessageAddedEvent which invokes in _appendMessage)
      if (event instanceof HookEvent && !(event instanceof MessageAddedEvent)) {
        await this.hooks.invokeCallbacks(event)
      }

      this._printer?.processEvent(event)
      yield event
      result = await streamGenerator.next()
    }

    // Yield final result as last event
    yield result.value

    return result.value
  }

  /**
   * Internal implementation of the agent streaming logic.
   * Separated to centralize printer event processing in the public stream method.
   *
   * @param args - Arguments for invoking the agent
   * @returns Async generator that yields AgentStreamEvent objects and returns AgentResult
   */
  private async *_stream(args: InvokeArgs): AsyncGenerator<AgentStreamEvent, AgentResult, undefined> {
    let currentArgs: InvokeArgs | undefined = args
    let result: AgentResult | undefined

    // Emit event before the loop starts
    yield new BeforeInvocationEvent({ agent: this })

    // Normalize input to get the user messages for telemetry
    const inputMessages = this._normalizeInput(args)
    
    // Start agent trace span with the input messages (for Langfuse input capture)
    const traceSpan = this._startAgentTraceSpan(inputMessages)
    if (traceSpan) {
      this._traceSpan = traceSpan
    }

    try {
      // Execute agent loop - child spans will be linked to agent span via context stack
      result = yield* this._executeAgentLoop(currentArgs)
      
      return result
    } catch (error) {
      // End agent span with error
      this._endAgentTraceSpan(error as Error, undefined, undefined)
      throw error
    } finally {
      // End agent span on success (idempotent - won't double-end if catch already ended it)
      this._endAgentTraceSpan(undefined, result?.lastMessage, result?.stopReason)
      // Always emit final event
      yield new AfterInvocationEvent({ agent: this })
    }
  }

  /**
   * Execute the main agent loop within the agent span context.
   * This is called from _stream() and runs within the agent span's context,
   * ensuring all child spans (event loop cycles, model calls, tool calls) inherit the trace ID.
   *
   * @param initialArgs - Arguments for the first invocation
   * @returns Async generator that yields AgentStreamEvent objects and returns AgentResult
   */
  private async *_executeAgentLoop(initialArgs?: InvokeArgs): AsyncGenerator<AgentStreamEvent, AgentResult, undefined> {
    let currentArgs: InvokeArgs | undefined = initialArgs

    // Main agent loop - continues until model stops without requesting tools
    let cycleCount = 0
    while (true) {
      cycleCount++
      const cycleId = `cycle-${cycleCount}`

      // Create event loop cycle span if telemetry is enabled
      // Context stack handles parenting automatically
      const cycleSpan = this._tracer?.startEventLoopCycleSpan({ cycleId, messages: this.messages })

      try {
        const modelResult = yield* this.invokeModel(currentArgs)
        currentArgs = undefined // Only pass args on first invocation
        if (modelResult.stopReason !== 'toolUse') {
          // Loop terminates - no tool use requested
          // Add assistant message now that we're returning
          yield await this._appendMessage(modelResult.message)

          // End cycle span if telemetry is enabled
          if (cycleSpan && this._tracer) {
            this._tracer.endEventLoopCycleSpan(cycleSpan)
          }

          return new AgentResult({
            stopReason: modelResult.stopReason,
            lastMessage: modelResult.message,
          })
        }

        // Execute tools sequentially
        const toolResultMessage = yield* this.executeTools(modelResult.message, this._toolRegistry)

        // Add assistant message with tool uses right before adding tool results
        // This ensures we don't have dangling tool use messages if tool execution fails
        yield await this._appendMessage(modelResult.message)
        yield await this._appendMessage(toolResultMessage)

        // End cycle span if telemetry is enabled
        if (cycleSpan && this._tracer) {
          this._tracer.endEventLoopCycleSpan(cycleSpan)
        }

        // Continue loop
      } catch (error) {
        // End cycle span with error if telemetry is enabled
        if (cycleSpan && this._tracer) {
          this._tracer.endEventLoopCycleSpan(cycleSpan, error as Error)
        }

        throw error
      }
    }
  }

  /**
   * Normalizes agent invocation input into an array of messages to append.
   *
   * @param args - Optional arguments for invoking the model
   * @returns Array of messages to append to the conversation
   */
  private _normalizeInput(args?: InvokeArgs): Message[] {
    if (args !== undefined) {
      if (typeof args === 'string') {
        // String input: wrap in TextBlock and create user Message
        return [
          new Message({
            role: 'user',
            content: [new TextBlock(args)],
          }),
        ]
      } else if (Array.isArray(args) && args.length > 0) {
        const firstElement = args[0]!

        // Check if it's Message[] or MessageData[]
        if ('role' in firstElement && typeof firstElement.role === 'string') {
          // Check if it's a Message instance or MessageData
          if (firstElement instanceof Message) {
            // Message[] input: return all messages
            return args as Message[]
          } else {
            // MessageData[] input: convert to Message[]
            return (args as MessageData[]).map((data) => Message.fromMessageData(data))
          }
        } else {
          // It's ContentBlock[] or ContentBlockData[]
          // Check if it's ContentBlock instances or ContentBlockData
          let contentBlocks: ContentBlock[]
          if ('type' in firstElement && typeof firstElement.type === 'string') {
            // ContentBlock[] input: use as-is
            contentBlocks = args as ContentBlock[]
          } else {
            // ContentBlockData[] input: convert using helper function
            contentBlocks = (args as ContentBlockData[]).map(contentBlockFromData)
          }

          return [
            new Message({
              role: 'user',
              content: contentBlocks,
            }),
          ]
        }
      }
    }
    // undefined or empty array: no messages to append
    return []
  }

  /**
   * Invokes the model provider and streams all events.
   *
   * @param args - Optional arguments for invoking the model
   * @param eventLoopCycleSpan - Optional event loop cycle span to use as parent for model invocation span
   * @returns Object containing the assistant message and stop reason
   */
  private async *invokeModel(
    args?: InvokeArgs,
  ): AsyncGenerator<AgentStreamEvent, { message: Message; stopReason: string }, undefined> {
    // Normalize input and append messages to conversation
    const messagesToAppend = this._normalizeInput(args)
    for (const message of messagesToAppend) {
      yield await this._appendMessage(message)
    }

    const toolSpecs = this._toolRegistry.values().map((tool) => tool.toolSpec)
    const streamOptions: StreamOptions = { toolSpecs }
    if (this.systemPrompt !== undefined) {
      streamOptions.systemPrompt = this.systemPrompt
    }

    yield new BeforeModelCallEvent({ agent: this })

    try {
      const { message, stopReason } = yield* this._streamFromModel(this.messages, streamOptions)

      yield new AfterModelCallEvent({ agent: this, stopData: { message, stopReason } })

      return { message, stopReason }
    } catch (error) {
      const modelError = normalizeError(error)

      // Create error event
      const errorEvent = new AfterModelCallEvent({ agent: this, error: modelError })

      // Yield error event - stream will invoke hooks
      yield errorEvent

      // After yielding, hooks have been invoked and may have set retryModelCall
      if (errorEvent.retryModelCall) {
        return yield* this.invokeModel(args)
      }

      // Re-throw error
      throw error
    }
  }

  /**
   * Streams events from the model and fires ModelStreamEventHook for each event.
   * Context stack handles span parenting automatically.
   *
   * @param messages - Messages to send to the model
   * @param streamOptions - Options for streaming
   * @returns Object containing the assistant message and stop reason
   */
  private async *_streamFromModel(
    messages: Message[],
    streamOptions: StreamOptions,
  ): AsyncGenerator<AgentStreamEvent, { message: Message; stopReason: string }, undefined> {
    // Start model span if telemetry is enabled
    // Context stack handles parenting automatically
    const modelId = getModelId(this.model)
    
    const modelSpan = this._tracer?.startModelInvokeSpan({ messages, modelId })
    
    try {
      const streamGenerator = this.model.streamAggregated(messages, streamOptions)
      let result = await streamGenerator.next()

      while (!result.done) {
        const event = result.value

        // Yield hook event for observability
        yield new ModelStreamEventHook({ agent: this, event })

        // Yield the actual model event
        yield event
        result = await streamGenerator.next()
      }

      // Accumulate token usage from metadata if available
      if (result.value.metadata?.usage) {
        const usage = result.value.metadata.usage
        accumulateUsage(this._accumulatedTokenUsage, usage)
      }

      // End model span on success
      if (modelSpan && this._tracer) {
        this._tracer.endModelInvokeSpan(modelSpan, {
          output: result.value.message,
          stopReason: result.value.stopReason,
        })
      }

      // result.done is true, result.value contains the return value
      return result.value
    } catch (error) {
      // End model span on error to prevent span leaks
      if (modelSpan && this._tracer) {
        this._tracer.endModelInvokeSpan(modelSpan, {
          error: normalizeError(error),
        })
      }
      throw error
    }
  }

  /**
   * Executes tools sequentially and streams all tool events.
   *
   * @param assistantMessage - The assistant message containing tool use blocks
   * @param toolRegistry - Registry containing available tools
   * @returns User message containing tool results
   */
  private async *executeTools(
    assistantMessage: Message,
    toolRegistry: ToolRegistry
  ): AsyncGenerator<AgentStreamEvent, Message, undefined> {
    yield new BeforeToolsEvent({ agent: this, message: assistantMessage })

    // Extract tool use blocks from assistant message
    const toolUseBlocks = assistantMessage.content.filter(
      (block): block is ToolUseBlock => block.type === 'toolUseBlock'
    )

    if (toolUseBlocks.length === 0) {
      // No tool use blocks found even though stopReason is toolUse
      throw new Error('Model indicated toolUse but no tool use blocks found in message')
    }

    const toolResultBlocks: ToolResultBlock[] = []

    for (const toolUseBlock of toolUseBlocks) {
      const toolResultBlock = yield* this.executeTool(toolUseBlock, toolRegistry)
      toolResultBlocks.push(toolResultBlock)

      // Yield the tool result block as it's created
      yield toolResultBlock
    }

    // Create user message with tool results
    const toolResultMessage: Message = new Message({
      role: 'user',
      content: toolResultBlocks,
    })

    yield new AfterToolsEvent({ agent: this, message: toolResultMessage })

    return toolResultMessage
  }

  /**
   * Executes a single tool and returns the result.
   * If the tool is not found or fails to return a result, returns an error ToolResult
   * instead of throwing an exception. This allows the agent loop to continue and
   * let the model handle the error gracefully.
   *
   * @param toolUseBlock - Tool use block to execute
   * @param toolRegistry - Registry containing available tools
   * @returns Tool result block
   */
  private async *executeTool(
    toolUseBlock: ToolUseBlock,
    toolRegistry: ToolRegistry
  ): AsyncGenerator<AgentStreamEvent, ToolResultBlock, undefined> {
    const tool = toolRegistry.find((t) => t.name === toolUseBlock.name)

    // Create toolUse object for hook events
    const toolUse = {
      name: toolUseBlock.name,
      toolUseId: toolUseBlock.toolUseId,
      input: toolUseBlock.input,
    }

    yield new BeforeToolCallEvent({ agent: this, toolUse, tool })

    if (!tool) {
      // Tool not found - return error result instead of throwing
      const errorResult = new ToolResultBlock({
        toolUseId: toolUseBlock.toolUseId,
        status: 'error',
        content: [new TextBlock(`Tool '${toolUseBlock.name}' not found in registry`)],
      })

      yield new AfterToolCallEvent({ agent: this, toolUse, tool, result: errorResult })

      return errorResult
    }

    // Execute tool and collect result
    const toolContext: ToolContext = {
      toolUse: {
        name: toolUseBlock.name,
        toolUseId: toolUseBlock.toolUseId,
        input: toolUseBlock.input,
      },
      agent: this,
    }

    // Start tool call span if telemetry is enabled
    // Context stack handles parenting automatically
    const toolSpan = this._tracer?.startToolCallSpan({ tool: toolUse })

    try {
      // Execute tool with the tool span as active context for trace propagation
      // This allows MCP instrumentation to find the active span and inject trace context
      const toolGenerator = toolSpan 
        ? this._executeToolWithActiveSpan(tool, toolContext, toolSpan)
        : tool.stream(toolContext)

      // Use yield* to delegate to the tool generator and capture the return value
      const toolResult = yield* toolGenerator

      if (!toolResult) {
        // Tool didn't return a result - return error result instead of throwing
        const errorResult = new ToolResultBlock({
          toolUseId: toolUseBlock.toolUseId,
          status: 'error',
          content: [new TextBlock(`Tool '${toolUseBlock.name}' did not return a result`)],
        })

        yield new AfterToolCallEvent({ agent: this, toolUse, tool, result: errorResult })

        // End tool span with error if telemetry is enabled
        if (toolSpan && this._tracer) {
          this._tracer.endToolCallSpan(toolSpan, errorResult)
        }

        return errorResult
      }

      yield new AfterToolCallEvent({ agent: this, toolUse, tool, result: toolResult })

      // End tool span with success if telemetry is enabled
      if (toolSpan && this._tracer) {
        this._tracer.endToolCallSpan(toolSpan, toolResult)
      }

      // Tool already returns ToolResultBlock directly
      return toolResult
    } catch (error) {
      // Tool execution failed with error
      const toolError = normalizeError(error)
      const errorResult = new ToolResultBlock({
        toolUseId: toolUseBlock.toolUseId,
        status: 'error',
        content: [new TextBlock(toolError.message)],
        error: toolError,
      })

      yield new AfterToolCallEvent({ agent: this, toolUse, tool, result: errorResult, error: toolError })

      // End tool span with error if telemetry is enabled
      if (toolSpan && this._tracer) {
        this._tracer.endToolCallSpan(toolSpan, errorResult, toolError)
      }

      return errorResult
    }
  }

  /**
   * Execute a tool with the tool span set as active context.
   * This enables MCP instrumentation to find the active span and inject trace context.
   *
   * The key insight is that we need to wrap the ITERATION of the generator, not just
   * the creation of it. The generator is lazy - it doesn't execute until we iterate.
   *
   * @param tool - The tool to execute
   * @param toolContext - The tool execution context
   * @param toolSpan - The tool span to set as active
   * @returns AsyncGenerator yielding tool results
   */
  private async *_executeToolWithActiveSpan(
    tool: Tool,
    toolContext: ToolContext,
    toolSpan: import('@opentelemetry/api').Span
  ): ToolStreamGenerator {
    // Set the tool span as active in the OpenTelemetry context
    // trace.setSpan returns a NEW context with the span set
    const spanContext = trace.setSpan(context.active(), toolSpan)
    
    // Get the generator from the tool
    const toolGenerator = tool.stream(toolContext)
    
    // Iterate over the generator within the active span context
    // This ensures the context is active when callTool() is actually invoked
    let result = await context.with(spanContext, async () => {
      return await toolGenerator.next()
    })
    
    while (!result.done) {
      // Yield intermediate events (ToolStreamEvent)
      yield result.value as ToolStreamEvent
      // Keep the context active for each iteration
      result = await context.with(spanContext, async () => {
        return await toolGenerator.next()
      })
    }
    
    // Return the final value (ToolResultBlock)
    return result.value
  }

  /**
   * Appends a message to the conversation history, invokes MessageAddedEvent hook,
   * and returns the event for yielding.
   *
   * @param message - The message to append
   * @returns MessageAddedEvent to be yielded (hook already invoked)
   */
  private async _appendMessage(message: Message): Promise<MessageAddedEvent> {
    this.messages.push(message)
    const event = new MessageAddedEvent({ agent: this, message })
    // Invoke hooks immediately for message tracking
    await this.hooks.invokeCallbacks(event)
    // Return event for yielding (stream will skip hook invocation for MessageAddedEvent)
    return event
  }
}

/**
 * Recursively flattens nested arrays of tools into a single flat array.
 * @param tools - Tools or nested arrays of tools
 * @returns Flat array of tools and MCP clients
 */
function flattenTools(toolList: ToolList): { tools: Tool[]; mcpClients: McpClient[] } {
  const tools: Tool[] = []
  const mcpClients: McpClient[] = []

  for (const item of toolList) {
    if (Array.isArray(item)) {
      const { tools: nestedTools, mcpClients: nestedMcpClients } = flattenTools(item)
      tools.push(...nestedTools)
      mcpClients.push(...nestedMcpClients)
    } else if (item instanceof McpClient) {
      mcpClients.push(item)
    } else {
      tools.push(item)
    }
  }

  return { tools, mcpClients }
}
