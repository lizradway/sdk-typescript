import type { ContextManagerParam, ContextManagerConfig } from './context-manager-config.js'
import type { ConversationManager } from '../conversation-manager/conversation-manager.js'
import type { Plugin } from '../plugins/plugin.js'
import { SlidingWindowConversationManager } from '../conversation-manager/sliding-window-conversation-manager.js'
import { SummarizingConversationManager } from '../conversation-manager/summarizing-conversation-manager.js'
import { ContextOffloader } from '../vended-plugins/context-offloader/plugin.js'
import { InMemoryStorage } from '../vended-plugins/context-offloader/storage.js'

export type ResolvedContextManager = {
  conversationManager: ConversationManager | undefined
  plugins: Plugin[]
}

/**
 * Resolve a `contextManager` parameter into concrete plugins and a conversation manager.
 *
 * @param param - The contextManager config (string shorthand or object)
 * @param userConversationManager - User-provided conversation manager, if any
 * @param userPlugins - User-provided plugins array, used for dedup checking
 */
export function resolveContextManager(
  param: ContextManagerParam,
  userConversationManager?: ConversationManager,
  userPlugins?: Plugin[]
): ResolvedContextManager {
  const config: ContextManagerConfig = param === 'auto' ? {} : param

  const plugins: Plugin[] = []
  let conversationManager: ConversationManager | undefined

  // --- Resolve conversation manager (compression) ---
  if (userConversationManager) {
    // User controls their own CM — facade does not override it
    conversationManager = undefined
  } else if (config.compression === false) {
    // Compression explicitly disabled — use bare default (no proactive compression)
    conversationManager = new SlidingWindowConversationManager({ windowSize: 40 })
  } else {
    const compression = config.compression ?? {}
    const threshold = compression.threshold ?? 0.7
    const strategy = compression.strategy ?? 'truncate'

    if (strategy === 'summarize') {
      conversationManager = new SummarizingConversationManager({
        proactiveCompression: { compressionThreshold: threshold },
      })
    } else {
      conversationManager = new SlidingWindowConversationManager({
        windowSize: 40,
        proactiveCompression: { compressionThreshold: threshold },
        protectedMessages: compression.protectedMessages ?? 1,
      })
    }
  }

  // --- Resolve tool result cache (ContextOffloader plugin) ---
  if (config.toolResultCache !== false) {
    const hasUserOffloader = userPlugins?.some((p) => p.name === 'strands:context-offloader')
    if (!hasUserOffloader) {
      const cacheConfig = config.toolResultCache ?? {}
      const storage = config.storage ?? new InMemoryStorage()
      plugins.push(
        new ContextOffloader({
          storage,
          maxResultTokens: cacheConfig.threshold ?? 2500,
          previewTokens: cacheConfig.previewTokens ?? 500,
          includeRetrievalTool: true,
        })
      )
    }
  }

  return { conversationManager, plugins }
}
