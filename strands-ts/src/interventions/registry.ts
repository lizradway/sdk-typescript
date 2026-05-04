import {
  BeforeInvocationEvent,
  BeforeToolCallEvent,
  AfterToolCallEvent,
  BeforeModelCallEvent,
  AfterModelCallEvent,
  type HookableEvent,
} from '../hooks/events.js'
import type { HookRegistry } from '../hooks/registry.js'
import type { HookableEventConstructor } from '../hooks/types.js'
import { Message, TextBlock } from '../types/messages.js'
import type { LocalAgent } from '../types/agent.js'
import type { Guide, InterventionAction } from './actions.js'
import { InterventionHandler } from './handler.js'
import { logger } from '../logging/logger.js'

/**
 * A single entry in the intervention audit trail.
 */
export interface AuditRecord {
  handler: string
  eventType: string
  actionType: string
  detail: string
  timestamp: string
}

type LifecycleMethod = 'beforeInvocation' | 'beforeToolCall' | 'afterToolCall' | 'beforeModelCall' | 'afterModelCall'

const EVENT_MAP: ReadonlyArray<[LifecycleMethod, HookableEventConstructor]> = [
  ['beforeInvocation', BeforeInvocationEvent],
  ['beforeToolCall', BeforeToolCallEvent],
  ['afterToolCall', AfterToolCallEvent],
  ['beforeModelCall', BeforeModelCallEvent],
  ['afterModelCall', AfterModelCallEvent],
]

/**
 * Bridges {@link InterventionHandler} instances and the Strands hook system.
 *
 * Registers one hook callback per lifecycle event type, then dispatches to
 * all handlers that override that method — in registration order, with
 * short-circuiting on Deny/Interrupt and accumulation for Guide.
 *
 * Every handler decision is recorded in {@link auditLog}.
 *
 * See {@link InterventionAction} for the action-to-event compatibility matrix.
 */
export class InterventionRegistry {
  private readonly _handlers: InterventionHandler[]
  private readonly _auditLog: AuditRecord[] = []

  constructor(handlers: InterventionHandler[], hookRegistry: HookRegistry) {
    const seen = new Set<string>()
    for (const h of handlers) {
      if (seen.has(h.name)) {
        throw new Error(`Duplicate intervention handler name: '${h.name}'`)
      }
      seen.add(h.name)
    }
    this._handlers = handlers
    this._registerHooks(hookRegistry)
  }

  private _registerHooks(hookRegistry: HookRegistry): void {
    for (const [method, eventType] of EVENT_MAP) {
      if (this._handlers.some((h) => h[method] !== InterventionHandler.prototype[method])) {
        hookRegistry.addCallback(eventType, (event) => this._dispatch(event, method))
      }
    }
  }

  private _initialized = false

  /** Initialize all handlers. Safe to call multiple times — only runs once. */
  async initialize(agent: LocalAgent): Promise<void> {
    if (this._initialized) return
    for (const handler of this._handlers) {
      await handler.initAgent(agent)
    }
    this._initialized = true
  }

  get handlers(): readonly InterventionHandler[] {
    return this._handlers
  }

  get auditLog(): readonly AuditRecord[] {
    return [...this._auditLog]
  }

  /** Clear the audit log. Use this for long-running agents to prevent unbounded memory growth. */
  clearAuditLog(): void {
    this._auditLog.length = 0
  }

  /**
   * Iterate handlers in registration order and resolve the winning action.
   *
   * - Deny / Interrupt short-circuit immediately (remaining handlers are skipped).
   * - Guide feedback strings accumulate across handlers and are applied at the end.
   * - Transform is applied in-place so later handlers see the mutation.
   * - If a handler throws, behavior depends on {@link InterventionHandler.onError}:
   *   `'throw'` (default) rethrows, `'deny'` fails closed, `'proceed'` skips.
   */
  private async _dispatch(event: HookableEvent, method: LifecycleMethod): Promise<void> {
    logger.debug(`event=<${method}> | dispatching to ${this._handlers.length} handler(s)`)
    const guides: Array<{ handlerName: string; action: Guide }> = []
    const apply = this._getApplier(event, method)

    for (const handler of this._handlers) {
      if (handler[method] === InterventionHandler.prototype[method]) continue

      logger.debug(`handler=<${handler.name}>, event=<${method}> | evaluating`)

      let action: InterventionAction | undefined
      let fromError = false
      try {
        // Safe: _registerHooks() only wires each method to its matching event type,
        // so the event is always the correct type for the method being called.
        action = await handler[method](event as never)
      } catch (error) {
        action = this._handleError(handler, method, error)
        if (!action) continue
        fromError = true
      }

      logger.debug(`handler=<${handler.name}>, event=<${method}> | returned ${action.type}`)

      if (action.type === 'guide') {
        guides.push({ handlerName: handler.name, action })
      } else {
        if (!fromError) this._log(handler.name, method, action)
        try {
          if (apply(action, handler.name)) {
            logger.debug(`handler=<${handler.name}>, event=<${method}> | short-circuited`)
            return
          }
        } catch (error) {
          const errorAction = this._handleError(handler, method, error)
          if (errorAction) {
            if (apply(errorAction, handler.name)) {
              return
            }
          }
        }
      }
    }

    // Guide feedback accumulates across handlers. Only logged and applied if
    // no earlier handler short-circuited (deny/interrupt).
    if (guides.length > 0) {
      for (const guide of guides) {
        this._log(guide.handlerName, method, guide.action)
      }
      logger.debug(`event=<${method}> | applying accumulated guide from ${guides.length} handler(s)`)
      const feedback = guides.map((g) => `[${g.handlerName}] ${g.action.feedback}`).join('\n')
      apply({ type: 'guide', feedback }, '')
    }
  }

  /**
   * Returns a function that applies a single action to the event.
   * Returns true if the action short-circuits (deny/interrupt), false otherwise.
   */
  private _getApplier(
    event: HookableEvent,
    method: LifecycleMethod
  ): (action: InterventionAction, handlerName: string) => boolean {
    // beforeInvocation, beforeToolCall: cancel with feedback
    if (event instanceof BeforeInvocationEvent || event instanceof BeforeToolCallEvent) {
      return (action, handlerName) => {
        const actionType = action.type
        switch (actionType) {
          case 'deny':
            event.cancel = `DENIED: ${action.reason}`
            return true
          case 'interrupt':
            // Uses event.cancel as a workaround until native interrupt/resume
            // support lands. See: https://github.com/strands-agents/sdk-typescript/issues/94
            event.cancel = `REQUIRES APPROVAL: ${action.prompt}`
            return true
          case 'guide':
            event.cancel = `GUIDANCE: ${action.feedback}`
            return false
          case 'transform':
            action.apply(event)
            return false
          case 'proceed':
            return false
          default:
            logger.warn(`handler=<${handlerName}>, event=<${method}> | ${actionType} has no effect on this event type`)
            return false
        }
      }
    }

    // beforeModelCall: Guide injects feedback as a user message so the model sees
    // it on this call, rather than cancelling (which would end the invocation).
    if (event instanceof BeforeModelCallEvent) {
      return (action, handlerName) => {
        switch (action.type) {
          case 'deny':
            event.cancel = `DENIED: ${action.reason}`
            return true
          case 'interrupt':
            event.cancel = `REQUIRES APPROVAL: ${action.prompt}`
            return true
          case 'guide':
            // Direct push bypasses MessageAddedEvent and conversation manager.
            // This matches what plugins can do today via event.agent.messages.
            event.agent.messages.push(new Message({ role: 'user', content: [new TextBlock(action.feedback)] }))
            return false
          case 'transform':
            action.apply(event)
            return false
          case 'proceed':
            return false
          default:
            logger.warn(
              `handler=<${handlerName}>, event=<${method}> | ${(action as InterventionAction).type} has no effect on this event type`
            )
            return false
        }
      }
    }

    // afterToolCall: tool already ran, only Transform (e.g. redact result) is meaningful
    if (event instanceof AfterToolCallEvent) {
      return (action, handlerName) => {
        switch (action.type) {
          case 'transform':
            action.apply(event)
            return false
          case 'proceed':
            return false
          default:
            logger.warn(`handler=<${handlerName}>, event=<${method}> | ${action.type} has no effect on this event type`)
            return false
        }
      }
    }

    // afterModelCall: has retry
    if (event instanceof AfterModelCallEvent) {
      return (action, handlerName) => {
        switch (action.type) {
          case 'guide':
            event.retry = true
            // Direct push bypasses MessageAddedEvent and conversation manager, so this
            // message won't trigger context management and could push the context over
            // the limit. LocalAgent doesn't expose a message-append method that goes
            // through the hook pipeline. This matches what plugins can do today.
            event.agent.messages.push(new Message({ role: 'user', content: [new TextBlock(action.feedback)] }))
            return false
          case 'transform':
            action.apply(event)
            return false
          case 'proceed':
            return false
          default:
            logger.warn(`handler=<${handlerName}>, event=<${method}> | ${action.type} has no effect on this event type`)
            return false
        }
      }
    }

    // Fallback for future event types not yet handled above
    return (action, handlerName) => {
      if (action.type !== 'proceed') {
        logger.warn(`handler=<${handlerName}>, event=<${method}> | ${action.type} has no effect on this event type`)
      }
      return false
    }
  }

  /**
   * Handle a handler error based on its onError policy.
   * Returns an action to apply, or undefined to skip the handler.
   * For 'proceed', logs immediately since the caller will skip. For 'deny',
   * returns the action without logging — the caller logs it with the normal path.
   */
  private _handleError(handler: InterventionHandler, method: string, error: unknown): InterventionAction | undefined {
    const errorMsg = error instanceof Error ? error.message : String(error)

    this._auditLog.push({
      handler: handler.name,
      eventType: method,
      actionType: 'ERROR',
      detail: `onError=${handler.onError}: ${errorMsg}`,
      timestamp: new Date().toISOString(),
    })

    if (handler.onError === 'throw') {
      throw error
    } else if (handler.onError === 'deny') {
      return { type: 'deny', reason: `Handler threw: ${errorMsg}` }
    } else {
      return undefined
    }
  }

  private _log(handlerName: string, method: string, action: InterventionAction): void {
    let detail: string
    switch (action.type) {
      case 'proceed':
        detail = action.reason ?? ''
        break
      case 'deny':
        detail = action.reason
        break
      case 'guide':
        detail = action.feedback
        break
      case 'interrupt':
        detail = action.prompt
        break
      case 'transform':
        detail = action.reason ?? ''
        break
    }

    this._auditLog.push({
      handler: handlerName,
      eventType: method,
      actionType: action.type.toUpperCase(),
      detail,
      timestamp: new Date().toISOString(),
    })
  }
}
