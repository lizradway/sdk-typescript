/**
 * Hook-based telemetry provider for Strands Agents SDK.
 *
 * @internal This class is used internally when StrandsTelemetry is instantiated.
 */

import { TracerHookAdapter } from './tracer-hook-adapter.js'
import { Tracer } from './tracer.js'
import type { ActiveSpanHandle } from './tracer.js'
import type { TracerSpan } from './types.js'

/**
 * Configuration options for TelemetryHookProvider.
 * @internal
 */
export interface TelemetryHookProviderConfig {
  /**
   * Enable cycle spans in the trace hierarchy.
   */
  enableCycleSpans?: boolean
}

/**
 * Internal hook-based telemetry provider that creates OpenTelemetry spans
 * for agent lifecycle events.
 *
 * @internal
 */
export class TelemetryHookProvider extends TracerHookAdapter {
  constructor(config?: TelemetryHookProviderConfig) {
    super(new Tracer(), { enableCycleSpans: config?.enableCycleSpans ?? true })
  }

  /**
   * Get the current agent span (for testing/debugging).
   * @internal
   */
  get agentSpan(): TracerSpan {
    return this._agentSpan as TracerSpan
  }

  /**
   * Get the current cycle span (for testing/debugging).
   * @internal
   */
  get cycleSpan(): TracerSpan | undefined {
    const handle = this._cycleSpan as ActiveSpanHandle | undefined
    return handle?.span as TracerSpan | undefined
  }

  /**
   * Get the current model span (for testing/debugging).
   * @internal
   */
  get modelSpan(): TracerSpan {
    return this._modelSpan as TracerSpan
  }
}
