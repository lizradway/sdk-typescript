import { z } from 'zod'
import { Message } from '../types/messages.js'
import { tool } from '../tools/tool-factory.js'

export function isPinned(message: Message): boolean {
  return message.metadata?.custom?.pinned === true
}

/**
 * Compute the set of indices that are effectively pinned within a range.
 * Includes tool-pair partners of pinned messages to prevent orphaned pairs.
 */
export function computePinnedIndices(messages: Message[], start: number, end: number): Set<number> {
  const pinned = new Set<number>()

  for (let i = start; i < end; i++) {
    if (isPinned(messages[i]!)) {
      pinned.add(i)
    }
  }

  // Expand for tool-pair partners
  for (const idx of [...pinned]) {
    const msg = messages[idx]!
    const hasToolUse = msg.content.some((b) => b.type === 'toolUseBlock')
    const hasToolResult = msg.content.some((b) => b.type === 'toolResultBlock')

    if (hasToolUse && idx + 1 < messages.length) {
      const next = messages[idx + 1]!
      if (next.content.some((b) => b.type === 'toolResultBlock')) {
        pinned.add(idx + 1)
      }
    }
    if (hasToolResult && idx - 1 >= 0) {
      const prev = messages[idx - 1]!
      if (prev.content.some((b) => b.type === 'toolUseBlock')) {
        pinned.add(idx - 1)
      }
    }
  }

  return pinned
}

export function pinMessage(message: Message): Message {
  return new Message({
    role: message.role,
    content: message.content,
    metadata: {
      ...message.metadata,
      custom: { ...message.metadata?.custom, pinned: true },
    },
  })
}

export function unpinMessage(message: Message): Message {
  const { pinned: _, ...restCustom } = message.metadata?.custom ?? {}
  const { custom: __, ...restMetadata } = message.metadata ?? {}
  const hasCustom = Object.keys(restCustom).length > 0
  const hasMetadata = hasCustom || Object.keys(restMetadata).length > 0
  const metadata = hasMetadata ? { ...restMetadata, ...(hasCustom ? { custom: restCustom } : {}) } : undefined

  return new Message({
    role: message.role,
    content: message.content,
    ...(metadata !== undefined ? { metadata } : {}),
  })
}

export const pinMessageTool = tool({
  name: 'pin_message',
  description:
    'Pin a message in the conversation history so it is protected from eviction during context reduction. ' +
    'Use this to preserve important context that should not be summarized or trimmed away.',
  inputSchema: z.object({
    index: z.number().int().min(0).describe('The zero-based index of the message to pin in the conversation history.'),
  }),
  callback: ({ index }, context) => {
    const messages = context!.agent.messages
    messages[index] = pinMessage(messages[index]!)
    return `Pinned message at index ${index}.`
  },
})
