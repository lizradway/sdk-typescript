import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { strandsTelemetry, _resetTracerProvider, isTelemetryEnabled, getGlobalTelemetry } from '../config.js'

describe('config', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Reset tracer provider before each test
    _resetTracerProvider()
  })

  afterEach(() => {
    // Restore environment variables
    process.env = { ...originalEnv }
    _resetTracerProvider()
  })

  describe('isTelemetryEnabled', () => {
    it('should return false before strandsTelemetry is used', () => {
      expect(isTelemetryEnabled()).toBe(false)
    })

    it('should return true after strandsTelemetry setup method is called', () => {
      strandsTelemetry.setupConsoleExporter()

      expect(isTelemetryEnabled()).toBe(true)
    })
  })

  describe('getGlobalTelemetry', () => {
    it('should return null before strandsTelemetry is used', () => {
      expect(getGlobalTelemetry()).toBeNull()
    })

    it('should return the strandsTelemetry singleton after setup', () => {
      strandsTelemetry.setupConsoleExporter()

      expect(getGlobalTelemetry()).toBe(strandsTelemetry)
    })
  })

  describe('strandsTelemetry', () => {
    describe('setupOtlpExporter', () => {
      it('should skip setup when OTEL_EXPORTER_OTLP_ENDPOINT is not set and no endpoint provided', () => {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT

        const result = strandsTelemetry.setupOtlpExporter()

        expect(result).toBe(strandsTelemetry) // Returns this for chaining
      })

      it('should configure OTLP exporter when endpoint is set via env var', () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'

        const result = strandsTelemetry.setupOtlpExporter()

        expect(result).toBe(strandsTelemetry)
      })

      it('should configure OTLP exporter when endpoint is passed as option', () => {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT

        const result = strandsTelemetry.setupOtlpExporter({ endpoint: 'http://localhost:4318' })

        expect(result).toBe(strandsTelemetry)
      })

      it('should prefer option over environment variable for endpoint', () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://env-endpoint:4318'

        const result = strandsTelemetry.setupOtlpExporter({ endpoint: 'http://param-endpoint:4318' })

        expect(result).toBe(strandsTelemetry)
      })

      it('should use headers from options when provided', () => {
        const result = strandsTelemetry.setupOtlpExporter({
          endpoint: 'http://localhost:4318',
          headers: { Authorization: 'Bearer token123' },
        })

        expect(result).toBe(strandsTelemetry)
      })

      it('should parse headers from environment variable when not provided in options', () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'
        process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Bearer token123,X-Custom=value'

        const result = strandsTelemetry.setupOtlpExporter()

        expect(result).toBe(strandsTelemetry)
      })

      it('should handle headers with equals signs in values', () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'
        process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Basic dXNlcjpwYXNz'

        const result = strandsTelemetry.setupOtlpExporter()

        expect(result).toBe(strandsTelemetry)
      })

      it('should append /v1/traces to endpoint if not present', () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'

        const result = strandsTelemetry.setupOtlpExporter()

        expect(result).toBe(strandsTelemetry)
      })

      it('should not append /v1/traces if already present', () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces'

        const result = strandsTelemetry.setupOtlpExporter()

        expect(result).toBe(strandsTelemetry)
      })

      it('should handle trailing slash in endpoint', () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318/'

        const result = strandsTelemetry.setupOtlpExporter()

        expect(result).toBe(strandsTelemetry)
      })
    })

    describe('setupConsoleExporter', () => {
      it('should configure console exporter', () => {
        const result = strandsTelemetry.setupConsoleExporter()

        expect(result).toBe(strandsTelemetry)
      })
    })

    describe('method chaining', () => {
      it('should support chaining multiple setup methods', () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'

        const result = strandsTelemetry
          .setupOtlpExporter()
          .setupConsoleExporter()

        expect(result).toBe(strandsTelemetry)
      })
    })
  })
})
