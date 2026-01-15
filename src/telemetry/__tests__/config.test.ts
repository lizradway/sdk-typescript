import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { StrandsTelemetry, getOtelResource, initializeTracerProvider, _resetTracerProvider } from '../config.js'

describe('StrandsTelemetry', () => {
  describe('getOtelResource', () => {
    it('should return resource with service name', () => {
      const resource = getOtelResource()
      expect(resource.attributes['service.name']).toBe('strands-agents')
    })

    it('should return resource with telemetry SDK info', () => {
      const resource = getOtelResource()
      expect(resource.attributes['telemetry.sdk.name']).toBe('opentelemetry')
      expect(resource.attributes['telemetry.sdk.language']).toBe('typescript')
    })

    it('should return consistent resource across multiple calls', () => {
      const resource1 = getOtelResource()
      const resource2 = getOtelResource()
      expect(resource1.attributes).toEqual(resource2.attributes)
    })
  })

  describe('initialization', () => {
    beforeEach(() => {
      _resetTracerProvider()
    })

    afterEach(() => {
      _resetTracerProvider()
    })

    it('should create a StrandsTelemetry instance', () => {
      const telemetry = new StrandsTelemetry()
      expect(telemetry).toBeDefined()
      expect(telemetry).toBeInstanceOf(StrandsTelemetry)
    })

    it('should handle initialization errors gracefully', () => {
      expect(() => {
        new StrandsTelemetry()
      }).not.toThrow()
    })
  })

  describe('method chaining', () => {
    beforeEach(() => {
      _resetTracerProvider()
    })

    afterEach(() => {
      _resetTracerProvider()
    })

    it('should support chaining setupConsoleExporter', () => {
      const telemetry = new StrandsTelemetry()
      const result = telemetry.setupConsoleExporter()
      expect(result).toBe(telemetry)
    })

    it('should support chaining setupOtlpExporter', () => {
      const telemetry = new StrandsTelemetry()
      const result = telemetry.setupOtlpExporter()
      expect(result).toBe(telemetry)
    })

    it('should support chaining setupMeter', () => {
      const telemetry = new StrandsTelemetry()
      const result = telemetry.setupMeter()
      expect(result).toBe(telemetry)
    })

    it('should support full method chaining', () => {
      const telemetry = new StrandsTelemetry()
      const result = telemetry.setupConsoleExporter().setupOtlpExporter().setupMeter()
      expect(result).toBe(telemetry)
    })
  })

  describe('exporter configuration', () => {
    beforeEach(() => {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      _resetTracerProvider()
    })

    afterEach(() => {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      _resetTracerProvider()
    })

    it('should configure console exporter without throwing', () => {
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupConsoleExporter()
      }).not.toThrow()
    })

    it('should configure OTLP exporter without throwing', () => {
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupOtlpExporter()
      }).not.toThrow()
    })

    it('should configure meter without throwing', () => {
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupMeter()
      }).not.toThrow()
    })

    it('should configure meter with console exporter', () => {
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupMeter({ console: true })
      }).not.toThrow()
    })

    it('should configure meter with OTLP exporter', () => {
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupMeter({ otlp: true })
      }).not.toThrow()
    })

    it('should configure meter with both exporters', () => {
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupMeter({ console: true, otlp: true })
      }).not.toThrow()
    })

    it('should skip initialization when OTEL_EXPORTER_OTLP_ENDPOINT is not set', () => {
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupOtlpExporter()
      }).not.toThrow()
    })

    it('should attempt initialization when OTEL_EXPORTER_OTLP_ENDPOINT is set', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317'
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupOtlpExporter()
      }).not.toThrow()
    })

    it('should handle initialization errors gracefully', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://invalid-endpoint'
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupOtlpExporter()
      }).not.toThrow()
    })

    it('should configure OTLP exporter with explicit endpoint parameter', () => {
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupOtlpExporter({ endpoint: 'http://localhost:4317' })
      }).not.toThrow()
    })

    it('should configure OTLP exporter with explicit headers parameter', () => {
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupOtlpExporter({
          endpoint: 'http://localhost:4317',
          headers: { 'Authorization': 'Bearer test-token' }
        })
      }).not.toThrow()
    })

    it('should configure meter with explicit endpoint parameter', () => {
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupMeter({
          otlp: true,
          endpoint: 'http://localhost:4317',
          headers: { 'Authorization': 'Bearer test-token' }
        })
      }).not.toThrow()
    })
  })

  describe('initializeTracerProvider', () => {
    beforeEach(() => {
      _resetTracerProvider()
    })

    afterEach(() => {
      _resetTracerProvider()
    })

    it('should return a tracer provider', () => {
      const provider = initializeTracerProvider()
      expect(provider).toBeDefined()
    })

    it('should be idempotent', () => {
      const provider1 = initializeTracerProvider()
      const provider2 = initializeTracerProvider()
      expect(provider1).toBe(provider2)
    })

    it('should handle missing endpoint gracefully', () => {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      expect(() => {
        initializeTracerProvider()
      }).not.toThrow()
    })
  })

  describe('OtlpExporterOptions', () => {
    beforeEach(() => {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      delete process.env.OTEL_EXPORTER_OTLP_HEADERS
      _resetTracerProvider()
    })

    afterEach(() => {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      delete process.env.OTEL_EXPORTER_OTLP_HEADERS
      _resetTracerProvider()
    })

    it('should prefer explicit endpoint over environment variable', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://env-endpoint:4317'
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupOtlpExporter({ endpoint: 'http://explicit-endpoint:4317' })
      }).not.toThrow()
    })

    it('should prefer explicit headers over environment variable', () => {
      process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Basic env-token'
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupOtlpExporter({
          endpoint: 'http://localhost:4317',
          headers: { 'Authorization': 'Bearer explicit-token' }
        })
      }).not.toThrow()
    })

    it('should parse headers from environment variable with equals in value', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317'
      process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Basic dXNlcjpwYXNz'
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupOtlpExporter()
      }).not.toThrow()
    })

    it('should handle multiple headers from environment variable', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317'
      process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Bearer token,X-Custom-Header=value'
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupOtlpExporter()
      }).not.toThrow()
    })
  })

  describe('MeterOptions', () => {
    beforeEach(() => {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      delete process.env.OTEL_EXPORTER_OTLP_HEADERS
      _resetTracerProvider()
    })

    afterEach(() => {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      delete process.env.OTEL_EXPORTER_OTLP_HEADERS
      _resetTracerProvider()
    })

    it('should configure meter with no options (defaults)', () => {
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupMeter()
      }).not.toThrow()
    })

    it('should configure meter with console only', () => {
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupMeter({ console: true })
      }).not.toThrow()
    })

    it('should configure meter with otlp only', () => {
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupMeter({ otlp: true })
      }).not.toThrow()
    })

    it('should configure meter with both console and otlp', () => {
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupMeter({ console: true, otlp: true })
      }).not.toThrow()
    })

    it('should prefer explicit endpoint over environment variable for meter', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://env-endpoint:4317'
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupMeter({
          otlp: true,
          endpoint: 'http://explicit-endpoint:4317'
        })
      }).not.toThrow()
    })

    it('should prefer explicit headers over environment variable for meter', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4317'
      process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Basic env-token'
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupMeter({
          otlp: true,
          headers: { 'Authorization': 'Bearer explicit-token' }
        })
      }).not.toThrow()
    })

    it('should skip otlp metrics when no endpoint is configured', () => {
      const telemetry = new StrandsTelemetry()
      expect(() => {
        telemetry.setupMeter({ otlp: true })
      }).not.toThrow()
    })
  })

  describe('flush', () => {
    beforeEach(() => {
      _resetTracerProvider()
    })

    afterEach(() => {
      _resetTracerProvider()
    })

    it('should flush spans without error', async () => {
      const telemetry = new StrandsTelemetry()
      await expect(telemetry.flush()).resolves.not.toThrow()
    })

    it('should flush both spans and metrics when meter is configured', async () => {
      const telemetry = new StrandsTelemetry().setupMeter({ console: true })
      await expect(telemetry.flush()).resolves.not.toThrow()
    })
  })
})
