/**
 * OpenTelemetry telemetry support for Strands Agents SDK.
 */

export { Tracer, serialize, mapContentBlocksToOtelParts, getTracer, _resetContextStack } from './tracer.js'
export type { ActiveSpanHandle, EndModelSpanOptions, StartAgentSpanOptions } from './tracer.js'
export { StrandsTelemetry, getOtelResource, isTelemetryEnabled, getGlobalTelemetry, parseOtlpHeaders } from './config.js'
export type { MeterOptions } from './config.js'
export { createEmptyUsage, accumulateUsage, getModelId } from './utils.js'
export { instrumentMcpClient, isInstrumented } from './mcp-instrumentation.js'
export type {
  TelemetryConfig,
  AttributeValue,
  Usage,
  Metrics,
  ToolUse,
  ToolResult,
} from './types.js'
