import type { Storage } from '../vended-plugins/context-offloader/storage.js'

/**
 * Configuration for the tool result cache component within the contextManager facade.
 */
export type ToolResultCacheFacadeConfig = {
  /** Token threshold above which tool results are cached externally. Defaults to 2500. */
  threshold?: number
  /** Number of tokens to keep as an inline preview. Defaults to 500. */
  previewTokens?: number
}

/**
 * Configuration for the compression component within the contextManager facade.
 */
export type CompressionFacadeConfig = {
  /** Ratio of context window usage (0–1] that triggers proactive compression. Defaults to 0.7. */
  threshold?: number
  /** What replaces evicted messages in L0. Defaults to "truncate". */
  strategy?: 'truncate' | 'summarize'
  /** Number of initial messages pinned in L0 (never evicted). Defaults to 1. */
  protectedMessages?: number
}

/**
 * Full configuration object for the contextManager facade.
 */
export type ContextManagerConfig = {
  /** Strategy name. Only "auto" is supported in v1. */
  strategy?: 'auto'
  /** Storage backend for cached tool results. Defaults to InMemoryStorage. */
  storage?: Storage
  /**
   * Tool result cache configuration.
   * - `false`: disable tool result caching entirely.
   * - Object: customize cache threshold and preview size.
   * - Omitted: enabled with defaults (threshold=2500, previewTokens=500).
   */
  toolResultCache?: false | ToolResultCacheFacadeConfig
  /**
   * Compression configuration.
   * - `false`: disable proactive compression (only reactive overflow recovery).
   * - Object: customize compression threshold, strategy, and message protection.
   * - Omitted: enabled with defaults (threshold=0.7, strategy="truncate", protectedMessages=1).
   */
  compression?: false | CompressionFacadeConfig
}

/**
 * The `contextManager` parameter type accepted by {@link AgentConfig}.
 *
 * - `"auto"`: enables tool result caching and proactive compression with benchmark-validated defaults.
 * - `ContextManagerConfig`: fine-grained control over strategy, storage, caching, and compression.
 * - `undefined` (default): no context management facade.
 */
export type ContextManagerParam = 'auto' | ContextManagerConfig
