import { describe, it, expect } from 'vitest'
import { pinMessageTool, isPinned } from '../pin.js'
import { Message, TextBlock } from '../../types/messages.js'
import type { Agent } from '../../agent/agent.js'

function makeAgent(messages: Message[]): Agent {
  return { messages } as unknown as Agent
}

function makeMessage(text: string): Message {
  return new Message({ role: 'user', content: [new TextBlock(text)] })
}

describe('pinMessageTool', () => {
  it('has the correct name and description', () => {
    expect(pinMessageTool.name).toBe('pin_message')
    expect(pinMessageTool.description).toContain('Pin a message')
  })

  it('pins a message at a valid index', async () => {
    const messages = [makeMessage('first'), makeMessage('second'), makeMessage('third')]
    const agent = makeAgent(messages)

    const result = await pinMessageTool.invoke({ index: 1 }, { agent } as any)

    expect(result).toBe('Pinned message at index 1.')
    expect(isPinned(agent.messages[1]!)).toBe(true)
    expect(isPinned(agent.messages[0]!)).toBe(false)
    expect(isPinned(agent.messages[2]!)).toBe(false)
  })

  it('rejects negative index via schema validation', async () => {
    const agent = makeAgent([makeMessage('only')])

    await expect(pinMessageTool.invoke({ index: -1 }, { agent } as any)).rejects.toThrow()
  })

  it('pins the first message (index 0)', async () => {
    const messages = [makeMessage('first'), makeMessage('second')]
    const agent = makeAgent(messages)

    const result = await pinMessageTool.invoke({ index: 0 }, { agent } as any)

    expect(result).toBe('Pinned message at index 0.')
    expect(isPinned(agent.messages[0]!)).toBe(true)
  })
})
