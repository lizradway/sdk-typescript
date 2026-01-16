/**
 * OpenTelemetry telemetry support for Strands Agents SDK.
 */

export { Tracer, serialize, mapContentBlocksToOtelParts, getTracer } from './tracer.js'
export { StrandsTelemetry, getOtelResource, getGlobalTelemetryHookProvider } from './config.js'
export type { StrandsTelemetryConfig } from './config.js'
// TelemetryHookProvider is internal - not exported publicly
// Users configure telemetry via StrandsTelemetry
export type {
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
  OtlpExporterOptions,
  MeterOptions,
} from './types.js'

// Custom tracer interface for custom telemetry backends
export { TracerHookAdapter } from './tracer-hook-adapter.js'
export type { TracerHookAdapterConfig } from './tracer-hook-adapter.js'
export type {
  ITracer,
  TracerSpanHandle,
  StartSpanEvent,
  EndSpanEvent,
  StartSpanContext,
  EndSpanContext,
} from './tracer-interface.js'

// Custom meter interface for custom metrics backends
export { MeterHookAdapter } from './meter-hook-adapter.js'
export type { MeterHookAdapterConfig } from './meter-hook-adapter.js'
export type {
  IMeter,
  RecordModelCallParams,
  RecordToolExecutionParams,
  RecordAgentInvocationParams,
  RecordCycleParams,
} from './meter-interface.js'
