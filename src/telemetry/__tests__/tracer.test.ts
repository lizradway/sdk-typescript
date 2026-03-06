import { describe, it, expect } from 'vitest'
import { LocalTrace, Tracer } from '../tracer.js'
import { Message, TextBlock } from '../../types/messages.js'
import { textMessage } from '../../__fixtures__/agent-helpers.js'

describe('LocalTrace', () => {
  describe('constructor', () => {
    it('creates a root trace with defaults', () => {
      const trace = new LocalTrace('test-trace', undefined, 50_000)

      expect(trace.name).toBe('test-trace')
      expect(trace.id).toMatch(/^[0-9a-f-]+$/)
      expect(trace.parentId).toBeNull()
      expect(trace.startTime).toBe(50_000)
      expect(trace.endTime).toBeNull()
      expect(trace.children).toStrictEqual([])
      expect(trace.metadata).toStrictEqual({})
    })

    it('links to parent and registers as child', () => {
      const parent = new LocalTrace('parent', undefined, 1000)
      const child = new LocalTrace('child', parent, 2000)

      expect(child.parentId).toBe(parent.id)
      expect(parent.children).toStrictEqual([child])
    })
  })

  describe('end', () => {
    it('records provided end time and computes duration', () => {
      const trace = new LocalTrace('trace', undefined, 100_000)

      trace.end(105_000)

      expect(trace.endTime).toBe(105_000)
      expect(trace.duration).toBe(5000)
    })

    it('uses Date.now when no end time provided', () => {
      const trace = new LocalTrace('trace', undefined, 0)

      trace.end()

      expect(trace.endTime).toBeGreaterThan(0)
      expect(trace.duration).toBe(trace.endTime! - trace.startTime)
    })
  })
})

describe('Tracer local trace management', () => {
  it('starts with empty localTraces', () => {
    const tracer = new Tracer()

    expect(tracer.localTraces).toStrictEqual([])
  })

  it('creates a local trace when starting an agent loop span', () => {
    const tracer = new Tracer()

    tracer.startAgentLoopSpan({ cycleId: 'cycle-1', messages: [textMessage('user', 'Hi')] })

    expect(tracer.localTraces).toHaveLength(1)
    expect(tracer.localTraces[0]!.name).toBe('Cycle 1')
  })

  it('ends the cycle local trace when ending the agent loop span', () => {
    const tracer = new Tracer()
    const span = tracer.startAgentLoopSpan({ cycleId: 'cycle-1', messages: [textMessage('user', 'Hi')] })

    expect(tracer.localTraces[0]!.endTime).toBeNull()

    tracer.endAgentLoopSpan(span)

    expect(tracer.localTraces[0]!.endTime).not.toBeNull()
    expect(tracer.localTraces[0]!.duration).toBeGreaterThanOrEqual(0)
  })

  it('ends the cycle local trace even when span is null', () => {
    const tracer = new Tracer()

    tracer.startAgentLoopSpan({ cycleId: 'cycle-1', messages: [textMessage('user', 'Hi')] })

    expect(tracer.localTraces[0]!.endTime).toBeNull()

    tracer.endAgentLoopSpan(null)

    expect(tracer.localTraces[0]!.endTime).not.toBeNull()
  })

  it('accumulates local traces across multiple cycles', () => {
    const tracer = new Tracer()

    const span1 = tracer.startAgentLoopSpan({ cycleId: 'cycle-1', messages: [textMessage('user', 'Hi')] })
    tracer.endAgentLoopSpan(span1)

    const span2 = tracer.startAgentLoopSpan({ cycleId: 'cycle-2', messages: [textMessage('user', 'Hi')] })
    tracer.endAgentLoopSpan(span2)

    expect(tracer.localTraces).toHaveLength(2)
    expect(tracer.localTraces[0]!.name).toBe('Cycle 1')
    expect(tracer.localTraces[1]!.name).toBe('Cycle 2')
  })

  it('creates a child model local trace under the current cycle trace', () => {
    const tracer = new Tracer()

    tracer.startAgentLoopSpan({ cycleId: 'cycle-1', messages: [textMessage('user', 'Hi')] })
    tracer.startModelInvokeSpan({ messages: [textMessage('user', 'Hi')] })

    const cycleTrace = tracer.localTraces[0]!
    expect(cycleTrace.children).toHaveLength(1)
    expect(cycleTrace.children[0]!.name).toBe('stream_messages')
    expect(cycleTrace.children[0]!.parentId).toBe(cycleTrace.id)
  })

  it('ends the model local trace and attaches output message', () => {
    const tracer = new Tracer()

    tracer.startAgentLoopSpan({ cycleId: 'cycle-1', messages: [textMessage('user', 'Hi')] })
    const modelSpan = tracer.startModelInvokeSpan({ messages: [textMessage('user', 'Hi')] })

    const output = new Message({ role: 'assistant', content: [new TextBlock('Hello')] })
    tracer.endModelInvokeSpan(modelSpan, { output })

    const modelTrace = tracer.localTraces[0]!.children[0]!
    expect(modelTrace.endTime).not.toBeNull()
    expect(modelTrace.message).toBe(output)
  })

  it('ends the model local trace even when span is null', () => {
    const tracer = new Tracer()

    tracer.startAgentLoopSpan({ cycleId: 'cycle-1', messages: [textMessage('user', 'Hi')] })
    tracer.startModelInvokeSpan({ messages: [textMessage('user', 'Hi')] })

    tracer.endModelInvokeSpan(null)

    const modelTrace = tracer.localTraces[0]!.children[0]!
    expect(modelTrace.endTime).not.toBeNull()
  })

  it('creates a child tool local trace under the current cycle trace', () => {
    const tracer = new Tracer()

    tracer.startAgentLoopSpan({ cycleId: 'cycle-1', messages: [textMessage('user', 'Hi')] })
    tracer.startToolCallSpan({ tool: { name: 'calc', toolUseId: 'call-1', input: {} } })

    const cycleTrace = tracer.localTraces[0]!
    expect(cycleTrace.children).toHaveLength(1)
    expect(cycleTrace.children[0]!.name).toBe('Tool: calc')
    expect(cycleTrace.children[0]!.parentId).toBe(cycleTrace.id)
  })

  it('sets tool metadata on the tool local trace', () => {
    const tracer = new Tracer()

    tracer.startAgentLoopSpan({ cycleId: 'cycle-1', messages: [textMessage('user', 'Hi')] })
    tracer.startToolCallSpan({ tool: { name: 'search', toolUseId: 'call-42', input: { q: 'test' } } })

    const toolTrace = tracer.localTraces[0]!.children[0]!
    expect(toolTrace.metadata).toStrictEqual({ toolUseId: 'call-42', toolName: 'search' })
    expect(toolTrace.rawName).toBe('search - call-42')
  })

  it('exposes tool trace as child of cycle trace during tool execution', () => {
    const tracer = new Tracer()

    tracer.startAgentLoopSpan({ cycleId: 'cycle-1', messages: [textMessage('user', 'Hi')] })
    tracer.startToolCallSpan({ tool: { name: 'calc', toolUseId: 'call-1', input: {} } })

    const cycleTrace = tracer.localTraces[0]!
    const toolTrace = cycleTrace.children.find((c) => c.name === 'Tool: calc')!
    expect(toolTrace).toBeDefined()
    expect(toolTrace.name).toBe('Tool: calc')
    expect(toolTrace.endTime).toBeNull()
  })

  it('ends the tool local trace on endToolCallSpan', () => {
    const tracer = new Tracer()

    tracer.startAgentLoopSpan({ cycleId: 'cycle-1', messages: [textMessage('user', 'Hi')] })
    const toolSpan = tracer.startToolCallSpan({ tool: { name: 'calc', toolUseId: 'call-1', input: {} } })

    const toolTrace = tracer.localTraces[0]!.children.find((c) => c.name === 'Tool: calc')!
    expect(toolTrace.endTime).toBeNull()

    tracer.endToolCallSpan(toolSpan)

    expect(toolTrace.endTime).not.toBeNull()
  })

  it('ends the tool local trace even when span is null', () => {
    const tracer = new Tracer()

    tracer.startAgentLoopSpan({ cycleId: 'cycle-1', messages: [textMessage('user', 'Hi')] })
    tracer.startToolCallSpan({ tool: { name: 'calc', toolUseId: 'call-1', input: {} } })

    const toolTrace = tracer.localTraces[0]!.children.find((c) => c.name === 'Tool: calc')!
    expect(toolTrace.endTime).toBeNull()

    tracer.endToolCallSpan(null)

    expect(toolTrace.endTime).not.toBeNull()
  })

  it('clears local trace state when ending agent span', () => {
    const tracer = new Tracer()

    const agentSpan = tracer.startAgentSpan({ messages: [textMessage('user', 'Hi')], agentName: 'agent' })
    tracer.startAgentLoopSpan({ cycleId: 'cycle-1', messages: [textMessage('user', 'Hi')] })
    tracer.startToolCallSpan({ tool: { name: 'calc', toolUseId: 'call-1', input: {} } })

    // Tool trace exists as child of cycle
    expect(tracer.localTraces[0]!.children).toHaveLength(1)

    tracer.endAgentSpan(agentSpan)

    // Starting a new invocation resets traces
    tracer.startAgentSpan({ messages: [textMessage('user', 'Hi')], agentName: 'agent' })
    expect(tracer.localTraces).toHaveLength(0)
  })

  it('builds correct parent-child hierarchy for a full cycle', () => {
    const tracer = new Tracer()

    tracer.startAgentLoopSpan({ cycleId: 'cycle-1', messages: [textMessage('user', 'Hi')] })

    const modelSpan = tracer.startModelInvokeSpan({ messages: [textMessage('user', 'Hi')] })
    tracer.endModelInvokeSpan(modelSpan)

    const toolSpan = tracer.startToolCallSpan({ tool: { name: 'calc', toolUseId: 'call-1', input: {} } })
    tracer.endToolCallSpan(toolSpan)

    const cycleTrace = tracer.localTraces[0]!
    expect(cycleTrace.children).toHaveLength(2)
    expect(cycleTrace.children[0]!.name).toBe('stream_messages')
    expect(cycleTrace.children[1]!.name).toBe('Tool: calc')

    expect(cycleTrace.children[0]!.endTime).not.toBeNull()
    expect(cycleTrace.children[1]!.endTime).not.toBeNull()
  })

  it('does not create model local trace when no cycle trace is active', () => {
    const tracer = new Tracer()

    tracer.startModelInvokeSpan({ messages: [textMessage('user', 'Hi')] })

    expect(tracer.localTraces).toHaveLength(0)
  })
})
