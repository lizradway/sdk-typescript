import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { trace } from '@opentelemetry/api'

// Increase max listeners to avoid warning during tests (each module reload adds a beforeExit listener)
process.setMaxListeners(20)

describe('config', () => {
  const originalEnv = { ...process.env }
  const originalListeners = process.listeners('beforeExit')

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    // Clean up beforeExit listeners added during tests
    const currentListeners = process.listeners('beforeExit')
    currentListeners.forEach((listener) => {
      if (!originalListeners.includes(listener)) {
        process.removeListener('beforeExit', listener)
      }
    })
  })

  describe('telemetry.config', () => {
    describe('setupOtlpExporter', () => {
      it('should configure OTLP exporter with default settings', async () => {
        // OTEL SDK uses http://localhost:4318/v1/traces by default
        const { telemetry } = await import('../index.js')

        const result = telemetry.config.setupOtlpExporter()

        expect(result).toBe(telemetry.config)
        expect(trace.getTracerProvider()).toBeDefined()
      })

      it('should configure OTLP exporter when endpoint is passed as option', async () => {
        const { telemetry } = await import('../index.js')

        const result = telemetry.config.setupOtlpExporter({ endpoint: 'http://custom:4318/v1/traces' })

        expect(result).toBe(telemetry.config)
      })

      it('should use headers from options when provided', async () => {
        const { telemetry } = await import('../index.js')

        const result = telemetry.config.setupOtlpExporter({
          endpoint: 'http://localhost:4318/v1/traces',
          headers: { Authorization: 'Bearer token123' },
        })

        expect(result).toBe(telemetry.config)
      })

      it('should let OTEL SDK handle env vars when no options provided', async () => {
        // OTEL SDK automatically reads OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'
        process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Bearer token123,X-Custom=value'
        const { telemetry } = await import('../index.js')

        const result = telemetry.config.setupOtlpExporter()

        expect(result).toBe(telemetry.config)
      })
    })

    describe('setupConsoleExporter', () => {
      it('should configure console exporter', async () => {
        const { telemetry } = await import('../index.js')

        const result = telemetry.config.setupConsoleExporter()

        expect(result).toBe(telemetry.config)
      })

      it('should work without setupOtlpExporter being called first', async () => {
        const { telemetry } = await import('../index.js')

        const result = telemetry.config.setupConsoleExporter()

        expect(result).toBe(telemetry.config)
      })
    })

    describe('method chaining', () => {
      it('should support chaining multiple setup methods', async () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'
        const { telemetry } = await import('../index.js')

        const result = telemetry.config.setupOtlpExporter().setupConsoleExporter()

        expect(result).toBe(telemetry.config)
      })

      it('should support console exporter first then OTLP', async () => {
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'
        const { telemetry } = await import('../index.js')

        const result = telemetry.config.setupConsoleExporter().setupOtlpExporter()

        expect(result).toBe(telemetry.config)
      })
    })

    describe('resource configuration', () => {
      it('should use default service name when OTEL_SERVICE_NAME is not set', async () => {
        delete process.env.OTEL_SERVICE_NAME
        const { telemetry } = await import('../index.js')

        const result = telemetry.config.setupConsoleExporter()

        expect(result).toBe(telemetry.config)
      })

      it('should use custom service name from environment', async () => {
        process.env.OTEL_SERVICE_NAME = 'my-custom-service'
        const { telemetry } = await import('../index.js')

        const result = telemetry.config.setupConsoleExporter()

        expect(result).toBe(telemetry.config)
      })

      it('should use custom service namespace from environment', async () => {
        process.env.OTEL_SERVICE_NAMESPACE = 'my-namespace'
        const { telemetry } = await import('../index.js')

        const result = telemetry.config.setupConsoleExporter()

        expect(result).toBe(telemetry.config)
      })

      it('should use custom deployment environment from environment', async () => {
        process.env.OTEL_DEPLOYMENT_ENVIRONMENT = 'production'
        const { telemetry } = await import('../index.js')

        const result = telemetry.config.setupConsoleExporter()

        expect(result).toBe(telemetry.config)
      })
    })

    describe('tracer provider initialization', () => {
      it('should reuse existing tracer provider on multiple setup calls', async () => {
        const { telemetry } = await import('../index.js')

        // First setup
        telemetry.config.setupConsoleExporter()
        const provider1 = trace.getTracerProvider()

        // Second setup should reuse the same provider
        telemetry.config.setupOtlpExporter()
        const provider2 = trace.getTracerProvider()

        expect(provider1).toBe(provider2)
      })
    })
  })

  describe('telemetry.tracer', () => {
    it('should return a tracer from the global API', async () => {
      const { telemetry } = await import('../index.js')

      const tracer = telemetry.tracer

      expect(tracer).toBeDefined()
      expect(typeof tracer.startSpan).toBe('function')
    })

    it('should return the same tracer instance on multiple accesses', async () => {
      const { telemetry } = await import('../index.js')

      const tracer1 = telemetry.tracer
      const tracer2 = telemetry.tracer

      expect(tracer1).toBe(tracer2)
    })

    it('should use strands-agents as the service name', async () => {
      const { telemetry } = await import('../index.js')
      const getTracerSpy = vi.spyOn(trace, 'getTracer')

      const _tracer = telemetry.tracer

      expect(getTracerSpy).toHaveBeenCalledWith('strands-agents')
      expect(_tracer).toBeDefined()
      getTracerSpy.mockRestore()
    })
  })
})
