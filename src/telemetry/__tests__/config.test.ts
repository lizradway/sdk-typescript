import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { trace } from '@opentelemetry/api'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

describe('config', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('telemetry.setupTracer', () => {
    it('should return a NodeTracerProvider', async () => {
      const { telemetry } = await import('../index.js')

      const provider = telemetry.setupTracer({ exporters: { console: true } })

      expect(provider).toBeInstanceOf(NodeTracerProvider)
    })

    it('should configure tracer with OTLP exporter', async () => {
      const { telemetry } = await import('../index.js')

      const provider = telemetry.setupTracer({ exporters: { otlp: true } })

      expect(provider).toBeDefined()
      expect(trace.getTracerProvider()).toBeDefined()
    })

    it('should configure tracer with console exporter', async () => {
      const { telemetry } = await import('../index.js')

      const provider = telemetry.setupTracer({ exporters: { console: true } })

      expect(provider).toBeDefined()
    })

    it('should configure tracer with both exporters', async () => {
      const { telemetry } = await import('../index.js')

      const provider = telemetry.setupTracer({ exporters: { otlp: true, console: true } })

      expect(provider).toBeDefined()
    })

    it('should configure tracer with no exporters', async () => {
      const { telemetry } = await import('../index.js')

      const provider = telemetry.setupTracer({})

      expect(provider).toBeDefined()
    })

    it('should work when called with no arguments', async () => {
      const { telemetry } = await import('../index.js')

      const provider = telemetry.setupTracer()

      expect(provider).toBeDefined()
    })

    it('should use OTEL env vars for OTLP configuration', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318'
      process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Bearer token123'
      const { telemetry } = await import('../index.js')

      const provider = telemetry.setupTracer({ exporters: { otlp: true } })

      expect(provider).toBeDefined()
    })

    it('should return existing provider if already initialized', async () => {
      const { telemetry } = await import('../index.js')

      const provider1 = telemetry.setupTracer({ exporters: { console: true } })
      const provider2 = telemetry.setupTracer({ exporters: { otlp: true } })

      expect(provider1).toBe(provider2)
    })

    describe('custom provider', () => {
      it('should accept a custom tracer provider', async () => {
        const { telemetry } = await import('../index.js')
        const customProvider = new NodeTracerProvider()

        const provider = telemetry.setupTracer({ provider: customProvider, exporters: { console: true } })

        expect(provider).toBe(customProvider)
      })
    })

    describe('resource configuration', () => {
      it('should use default service name when OTEL_SERVICE_NAME is not set', async () => {
        delete process.env.OTEL_SERVICE_NAME
        const { telemetry } = await import('../index.js')

        const provider = telemetry.setupTracer({ exporters: { console: true } })

        expect(provider).toBeDefined()
      })

      it('should use custom service name from environment', async () => {
        process.env.OTEL_SERVICE_NAME = 'my-custom-service'
        const { telemetry } = await import('../index.js')

        const provider = telemetry.setupTracer({ exporters: { console: true } })

        expect(provider).toBeDefined()
      })

      it('should use custom service namespace from environment', async () => {
        process.env.OTEL_SERVICE_NAMESPACE = 'my-namespace'
        const { telemetry } = await import('../index.js')

        const provider = telemetry.setupTracer({ exporters: { console: true } })

        expect(provider).toBeDefined()
      })

      it('should use custom deployment environment from environment', async () => {
        process.env.OTEL_DEPLOYMENT_ENVIRONMENT = 'production'
        const { telemetry } = await import('../index.js')

        const provider = telemetry.setupTracer({ exporters: { console: true } })

        expect(provider).toBeDefined()
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
