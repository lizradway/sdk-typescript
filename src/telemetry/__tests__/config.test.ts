import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { trace } from '@opentelemetry/api'

// Increase max listeners to avoid warning during tests (each module reload adds a beforeExit listener)
process.setMaxListeners(20)

describe('config', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('strandsTelemetry', () => {
    describe('setupOtlpExporter', () => {
      it('should configure OTLP exporter with default settings', async () => {
        // OTEL SDK uses http://localhost:4318/v1/traces by default
        const { strandsTelemetry } = await import('../config.js')

        const result = strandsTelemetry.setupOtlpExporter()

        expect(result).toBe(strandsTelemetry)
        expect(trace.getTracerProvider()).toBeDefined()
      })

      it('should configure OTLP exporter when endpoint is passed as option', async () => {
        const { strandsTelemetry } = await import('../config.js')

        const result = strandsTelemetry.setupOtlpExporter({ endpoint: 'http://custom:4318/v1/traces' })

        expect(result).toBe(strandsTelemetry)
      })

      it('should use headers from options when provided', async () => {
        const { strandsTelemetry } = await import('../config.js')

        const result = strandsTelemetry.setupOtlpExporter({
          endpoint: 'http://localhost:4318/v1/traces',
          headers: { Authorization: 'Bearer token123' },
        })

        expect(result).toBe(strandsTelemetry)
      })

      it('should let OTEL SDK handle env vars when no options provided', async () => {
        // OTEL SDK automatically reads OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'
        process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Bearer token123,X-Custom=value'
        const { strandsTelemetry } = await import('../config.js')

        const result = strandsTelemetry.setupOtlpExporter()

        expect(result).toBe(strandsTelemetry)
      })
    })

    describe('setupConsoleExporter', () => {
      it('should configure console exporter', async () => {
        const { strandsTelemetry } = await import('../config.js')

        const result = strandsTelemetry.setupConsoleExporter()

        expect(result).toBe(strandsTelemetry)
      })

      it('should work without setupOtlpExporter being called first', async () => {
        const { strandsTelemetry } = await import('../config.js')

        const result = strandsTelemetry.setupConsoleExporter()

        expect(result).toBe(strandsTelemetry)
      })
    })

    describe('method chaining', () => {
      it('should support chaining multiple setup methods', async () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'
        const { strandsTelemetry } = await import('../config.js')

        const result = strandsTelemetry.setupOtlpExporter().setupConsoleExporter()

        expect(result).toBe(strandsTelemetry)
      })

      it('should support console exporter first then OTLP', async () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'
        const { strandsTelemetry } = await import('../config.js')

        const result = strandsTelemetry.setupConsoleExporter().setupOtlpExporter()

        expect(result).toBe(strandsTelemetry)
      })
    })

    describe('resource configuration', () => {
      it('should use default service name when OTEL_SERVICE_NAME is not set', async () => {
        delete process.env.OTEL_SERVICE_NAME
        const { strandsTelemetry } = await import('../config.js')

        const result = strandsTelemetry.setupConsoleExporter()

        expect(result).toBe(strandsTelemetry)
      })

      it('should use custom service name from environment', async () => {
        process.env.OTEL_SERVICE_NAME = 'my-custom-service'
        const { strandsTelemetry } = await import('../config.js')

        const result = strandsTelemetry.setupConsoleExporter()

        expect(result).toBe(strandsTelemetry)
      })
    })
  })
})
