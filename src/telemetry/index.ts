/**
 * OpenTelemetry telemetry support for Strands Agents SDK.
 */

export { Tracer, serialize, mapContentBlocksToOtelParts, getTracer } from './tracer.js'
export { StrandsTelemetry, getOtelResource } from './config.js'
export type { OtlpExporterOptions, MeterOptions } from './config.js'
// TelemetryHookProvider is internal - not exported publicly
// Users configure telemetry via AgentConfig.telemetryConfig
export type {
  TelemetryConfig,
  AttributeValue,
  Usage,
  Metrics,
  ToolUse,
  ToolResult,
  SpanStatus,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  InterruptResponseBlock,
  UnknownBlock,
  OtelPart,
  TracerSpan,
} from './types.js'

// Custom tracer interface for custom telemetry backends
export { TracerHookAdapter } from './tracer-hook-adapter.js'
export type { TracerHookAdapterConfig } from './tracer-hook-adapter.js'
export type {
  ITracer,
  TracerSpanHandle,
  StartAgentSpanParams,
  EndAgentSpanParams,
  StartModelSpanParams,
  EndModelSpanParams,
  StartToolSpanParams,
  EndToolSpanParams,
  StartCycleSpanParams,
  EndCycleSpanParams,
} from './tracer-interface.js'

// Custom meter interface for custom metrics backends
export { MeterHookAdapter } from './meter-hook-adapter.js'
export type { MeterHookAdapterConfig } from './meter-hook-adapter.js'
export type {
  IMeter,
  TokenUsage,
  RecordModelCallParams,
  RecordToolExecutionParams,
  RecordAgentInvocationParams,
  RecordCycleParams,
} from './meter-interface.js'
