import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getOtelResource, StrandsTelemetry, _resetTracerProvider, initializeTracerProvider, getTracerProvider, isTelemetryEnabled, getGlobalTelemetry } from '../config.js'

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

  describe('getOtelResource', () => {
    it('should create resource with default values', () => {
      delete process.env.OTEL_SERVICE_NAME
      delete process.env.OTEL_SERVICE_NAMESPACE
      delete process.env.OTEL_DEPLOYMENT_ENVIRONMENT

      const resource = getOtelResource()

      expect(resource.attributes['service.name']).toBe('strands-agents')
      expect(resource.attributes['service.namespace']).toBe('strands')
      expect(resource.attributes['deployment.environment']).toBe('development')
      expect(resource.attributes['telemetry.sdk.name']).toBe('opentelemetry')
      expect(resource.attributes['telemetry.sdk.language']).toBe('typescript')
    })

    it('should use environment variables when set', () => {
      process.env.OTEL_SERVICE_NAME = 'my-service'
      process.env.OTEL_SERVICE_NAMESPACE = 'my-namespace'
      process.env.OTEL_DEPLOYMENT_ENVIRONMENT = 'production'

      const resource = getOtelResource()

      expect(resource.attributes['service.name']).toBe('my-service')
      expect(resource.attributes['service.namespace']).toBe('my-namespace')
      expect(resource.attributes['deployment.environment']).toBe('production')
    })
  })

  describe('initializeTracerProvider', () => {
    it('should create a tracer provider', () => {
      const provider = initializeTracerProvider()

      expect(provider).toBeDefined()
    })

    it('should return cached provider on subsequent calls', () => {
      const provider1 = initializeTracerProvider()
      const provider2 = initializeTracerProvider()

      expect(provider1).toBe(provider2)
    })
  })

  describe('getTracerProvider', () => {
    it('should return null before initialization', () => {
      expect(getTracerProvider()).toBeNull()
    })

    it('should return provider after initialization', () => {
      initializeTracerProvider()

      expect(getTracerProvider()).not.toBeNull()
    })
  })

  describe('isTelemetryEnabled', () => {
    it('should return false before StrandsTelemetry is instantiated', () => {
      expect(isTelemetryEnabled()).toBe(false)
    })

    it('should return true after StrandsTelemetry is instantiated', () => {
      new StrandsTelemetry()

      expect(isTelemetryEnabled()).toBe(true)
    })
  })

  describe('getGlobalTelemetry', () => {
    it('should return null before StrandsTelemetry is instantiated', () => {
      expect(getGlobalTelemetry()).toBeNull()
    })

    it('should return the StrandsTelemetry instance after instantiation', () => {
      const telemetry = new StrandsTelemetry()

      expect(getGlobalTelemetry()).toBe(telemetry)
    })

    it('should return the most recent StrandsTelemetry instance', () => {
      const telemetry1 = new StrandsTelemetry()
      const telemetry2 = new StrandsTelemetry()

      expect(getGlobalTelemetry()).toBe(telemetry2)
      expect(getGlobalTelemetry()).not.toBe(telemetry1)
    })
  })

  describe('StrandsTelemetry', () => {
    describe('constructor', () => {
      it('should initialize tracer provider', () => {
        const telemetry = new StrandsTelemetry()

        expect(telemetry).toBeDefined()
        expect(getTracerProvider()).not.toBeNull()
      })
    })

    describe('setupOtlpExporter', () => {
      it('should skip setup when OTEL_EXPORTER_OTLP_ENDPOINT is not set', () => {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT

        const telemetry = new StrandsTelemetry()
        const result = telemetry.setupOtlpExporter()

        expect(result).toBe(telemetry) // Returns this for chaining
      })

      it('should configure OTLP exporter when endpoint is set', () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'

        const telemetry = new StrandsTelemetry()
        const result = telemetry.setupOtlpExporter()

        expect(result).toBe(telemetry)
      })

      it('should parse headers from environment variable', () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'
        process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Bearer token123,X-Custom=value'

        const telemetry = new StrandsTelemetry()
        const result = telemetry.setupOtlpExporter()

        expect(result).toBe(telemetry)
      })

      it('should handle headers with equals signs in values', () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'
        process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Basic dXNlcjpwYXNz'

        const telemetry = new StrandsTelemetry()
        const result = telemetry.setupOtlpExporter()

        expect(result).toBe(telemetry)
      })

      it('should append /v1/traces to endpoint if not present', () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'

        const telemetry = new StrandsTelemetry()
        const result = telemetry.setupOtlpExporter()

        expect(result).toBe(telemetry)
      })

      it('should not append /v1/traces if already present', () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces'

        const telemetry = new StrandsTelemetry()
        const result = telemetry.setupOtlpExporter()

        expect(result).toBe(telemetry)
      })

      it('should handle trailing slash in endpoint', () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318/'

        const telemetry = new StrandsTelemetry()
        const result = telemetry.setupOtlpExporter()

        expect(result).toBe(telemetry)
      })
    })

    describe('setupConsoleExporter', () => {
      it('should configure console exporter', () => {
        const telemetry = new StrandsTelemetry()
        const result = telemetry.setupConsoleExporter()

        expect(result).toBe(telemetry)
      })
    })

    describe('setupMeter', () => {
      it('should initialize meter without exporters', () => {
        const telemetry = new StrandsTelemetry()
        const result = telemetry.setupMeter()

        expect(result).toBe(telemetry)
      })

      it('should enable console metrics exporter', () => {
        const telemetry = new StrandsTelemetry()
        const result = telemetry.setupMeter({ console: true })

        expect(result).toBe(telemetry)
      })

      it('should skip OTLP metrics exporter when endpoint not set', () => {
        delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT

        const telemetry = new StrandsTelemetry()
        const result = telemetry.setupMeter({ otlp: true })

        expect(result).toBe(telemetry)
      })

      it('should enable OTLP metrics exporter when endpoint is set', () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'

        const telemetry = new StrandsTelemetry()
        const result = telemetry.setupMeter({ otlp: true })

        expect(result).toBe(telemetry)
      })

      it('should enable both exporters', () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'

        const telemetry = new StrandsTelemetry()
        const result = telemetry.setupMeter({ console: true, otlp: true })

        expect(result).toBe(telemetry)
      })
    })

    describe('flush', () => {
      it('should flush tracer provider', async () => {
        const telemetry = new StrandsTelemetry()

        await expect(telemetry.flush()).resolves.not.toThrow()
      })

      it('should flush meter provider when configured', async () => {
        const telemetry = new StrandsTelemetry()
        telemetry.setupMeter()

        await expect(telemetry.flush()).resolves.not.toThrow()
      })
    })

    describe('method chaining', () => {
      it('should support chaining multiple setup methods', () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'

        const telemetry = new StrandsTelemetry()
          .setupOtlpExporter()
          .setupConsoleExporter()
          .setupMeter({ console: true, otlp: true })

        expect(telemetry).toBeInstanceOf(StrandsTelemetry)
      })
    })
  })
})
