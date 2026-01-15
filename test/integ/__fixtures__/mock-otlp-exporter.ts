/**
 * Mock OTLP exporter for capturing spans in integration tests.
 * Allows tests to inspect span attributes, events, and hierarchy.
 */

import type { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-node'

/**
 * Captured span data for inspection in tests.
 */
export interface CapturedSpan {
  name: string
  traceId: string
  spanId: string
  parentSpanId?: string
  attributes: Record<string, unknown>
  events: Array<{
    name: string
    attributes?: Record<string, unknown>
    timestamp?: number
  }>
  status: {
    code: number
    message?: string
  }
  startTime: number
  endTime: number
  duration: number
}

/**
 * Mock OTLP exporter that captures spans for testing.
 */
export class MockOtlpExporter implements SpanExporter {
  private spans: CapturedSpan[] = []

  async export(spans: ReadableSpan[]): Promise<{ code: number }> {
    for (const span of spans) {
      const capturedSpan: CapturedSpan = {
        name: span.name,
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
        parentSpanId: (span as any).parentSpanId,
        attributes: (span.attributes as Record<string, unknown>) || {},
        events: (span.events || []).map((event) => ({
          name: event.name,
          attributes: (event.attributes as Record<string, unknown>) || undefined,
          timestamp: (event.time as any)?.[0],
        })),
        status: {
          code: span.status?.code || 0,
          ...(span.status?.message ? { message: span.status.message } : {}),
        },
        startTime: (span.startTime as any)?.[0] * 1000 + ((span.startTime as any)?.[1] || 0) / 1000000,
        endTime: (span.endTime as any) ? (span.endTime as any)[0] * 1000 + ((span.endTime as any)[1] || 0) / 1000000 : 0,
        duration: (span.duration as any) ? (span.duration as any)[0] * 1000 + ((span.duration as any)[1] || 0) / 1000000 : 0,
      }
      this.spans.push(capturedSpan)
    }
    return { code: 0 }
  }

  async shutdown(): Promise<void> {
    // No-op
  }

  forceFlush(): Promise<void> {
    return Promise.resolve()
  }

  /**
   * Get all captured spans.
   */
  getSpans(): CapturedSpan[] {
    return this.spans
  }

  /**
   * Get spans by name.
   */
  getSpansByName(name: string): CapturedSpan[] {
    return this.spans.filter((span) => span.name === name)
  }

  /**
   * Get spans by trace ID.
   */
  getSpansByTraceId(traceId: string): CapturedSpan[] {
    return this.spans.filter((span) => span.traceId === traceId)
  }

  /**
   * Find a span by name and attribute value.
   */
  findSpan(name: string, attributeName: string, attributeValue: unknown): CapturedSpan | undefined {
    return this.spans.find(
      (span) => span.name === name && span.attributes[attributeName] === attributeValue
    )
  }

  /**
   * Get parent-child relationships for a trace.
   */
  getSpanHierarchy(traceId: string): Map<string, CapturedSpan[]> {
    const hierarchy = new Map<string, CapturedSpan[]>()
    const traceSpans = this.getSpansByTraceId(traceId)

    for (const span of traceSpans) {
      const parentId = span.parentSpanId || 'root'
      if (!hierarchy.has(parentId)) {
        hierarchy.set(parentId, [])
      }
      hierarchy.get(parentId)!.push(span)
    }

    return hierarchy
  }

  /**
   * Verify span hierarchy (parent-child relationships).
   */
  verifyHierarchy(traceId: string, expectedHierarchy: Record<string, string[]>): boolean {
    const traceSpans = this.getSpansByTraceId(traceId)
    const spansByName = new Map<string, CapturedSpan>()

    for (const span of traceSpans) {
      spansByName.set(span.name, span)
    }

    for (const [parentName, childNames] of Object.entries(expectedHierarchy)) {
      const parentSpan = spansByName.get(parentName)
      if (!parentSpan) {
        return false
      }

      for (const childName of childNames) {
        const childSpan = spansByName.get(childName)
        if (!childSpan || childSpan.parentSpanId !== parentSpan.spanId) {
          return false
        }
      }
    }

    return true
  }

  /**
   * Clear all captured spans.
   */
  clear(): void {
    this.spans = []
  }
}
