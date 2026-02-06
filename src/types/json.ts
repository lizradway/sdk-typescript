import type { JSONSchema7 } from 'json-schema'
import { JsonValidationError } from '../errors.js'
import { logger } from '../logging/index.js'

/** Maximum recursion depth for JSON encoding to prevent stack overflow. */
const MAX_JSON_ENCODE_DEPTH = 50

/**
 * Represents any valid JSON value.
 * This type ensures type safety for JSON-serializable data.
 *
 * @example
 * ```typescript
 * const value: JSONValue = { key: 'value', nested: { arr: [1, 2, 3] } }
 * const text: JSONValue = 'hello'
 * const num: JSONValue = 42
 * const bool: JSONValue = true
 * const nothing: JSONValue = null
 * ```
 */
export type JSONValue = string | number | boolean | null | { [key: string]: JSONValue } | JSONValue[]

/**
 * Represents a JSON Schema definition.
 * Used for defining the structure of tool inputs and outputs.
 *
 * This is based on JSON Schema Draft 7 specification.
 *
 * @example
 * ```typescript
 * const schema: JSONSchema = {
 *   type: 'object',
 *   properties: {
 *     name: { type: 'string' },
 *     age: { type: 'number' }
 *   },
 *   required: ['name']
 * }
 * ```
 */
export type JSONSchema = JSONSchema7

/**
 * Creates a deep copy of a value using JSON serialization.
 *
 * @param value - The value to copy
 * @returns A deep copy of the value
 * @throws Error if the value cannot be JSON serialized
 */
export function deepCopy(value: unknown): JSONValue {
  try {
    return JSON.parse(JSON.stringify(value)) as JSONValue
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to serialize tool result: ${errorMessage}`)
  }
}

/**
 * Creates a deep copy of a value with explicit validation for non-serializable types.
 * Uses JSON.stringify's replacer to detect and report non-serializable values with path information.
 *
 * @param value - The value to copy
 * @param contextPath - Context path for error messages (e.g., 'initialState', 'value for key "config"')
 * @returns A deep copy of the value
 * @throws JsonValidationError if value contains functions, symbols, or undefined values
 */
export function deepCopyWithValidation(value: unknown, contextPath: string = 'value'): JSONValue {
  const pathStack: string[] = []

  const replacer = (key: string, val: unknown): unknown => {
    // Build current path
    let currentPath = contextPath
    if (key !== '') {
      // Check if parent is array (numeric key pattern)
      const isArrayIndex = /^\d+$/.test(key)
      if (isArrayIndex) {
        currentPath = pathStack.length > 0 ? `${pathStack[pathStack.length - 1]}[${key}]` : `${contextPath}[${key}]`
      } else {
        currentPath = pathStack.length > 0 ? `${pathStack[pathStack.length - 1]}.${key}` : `${contextPath}.${key}`
      }
    }

    // Check for non-serializable types
    if (typeof val === 'function') {
      throw new JsonValidationError(`${currentPath} contains a function which cannot be serialized`)
    }

    if (typeof val === 'symbol') {
      throw new JsonValidationError(`${currentPath} contains a symbol which cannot be serialized`)
    }

    if (val === undefined) {
      throw new JsonValidationError(`${currentPath} is undefined which cannot be serialized`)
    }

    // Track path for nested objects/arrays
    if (val !== null && typeof val === 'object') {
      pathStack.push(currentPath)
    }

    return val
  }

  try {
    const serialized = JSON.stringify(value, replacer)
    return JSON.parse(serialized) as JSONValue
  } catch (error) {
    // If it's our validation error, re-throw it
    if (error instanceof JsonValidationError) {
      throw error
    }
    // Otherwise, wrap it
    const errorMessage = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to serialize value: ${errorMessage}`)
  }
}

/**
 * Serialize objects to JSON strings.
 * Handles circular references and special types like Date, Error, Map, Set, etc.
 *
 * @param value - The value to serialize
 * @returns JSON string representation
 */
export function serialize(value: unknown): string {
  try {
    const seen = new WeakSet<object>()
    const processed = processValue(value, seen, 0)
    const result = JSON.stringify(processed)
    return result ?? 'undefined'
  } catch (error) {
    logger.warn(`error=<${error}> | failed to encode value, returning empty object`)
    return '{}'
  }
}

/**
 * Process any value, handling containers recursively.
 * Handles special types and circular references.
 *
 * @param value - The value to process
 * @param seen - WeakSet tracking visited objects for circular reference detection
 * @param depth - Current recursion depth
 * @returns Processed value safe for JSON serialization
 */
function processValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  // Limit recursion depth to prevent memory issues
  if (depth > MAX_JSON_ENCODE_DEPTH) {
    return '<max depth reached>'
  }

  if (value === null) return null
  if (value === undefined) return undefined

  if (value instanceof Date) return value.toISOString()

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }

  if (value instanceof Map) {
    if (seen.has(value)) return '<replaced>'
    seen.add(value)
    return {
      __type__: 'Map',
      value: Array.from(value.entries()).map(([k, v]) => [
        processValue(k, seen, depth + 1),
        processValue(v, seen, depth + 1),
      ]),
    }
  }

  if (value instanceof Set) {
    if (seen.has(value)) return '<replaced>'
    seen.add(value)
    return {
      __type__: 'Set',
      value: Array.from(value).map((item) => processValue(item, seen, depth + 1)),
    }
  }

  if (value instanceof RegExp) {
    return { __type__: 'RegExp', source: value.source, flags: value.flags }
  }

  if (typeof value === 'bigint') {
    return { __type__: 'BigInt', value: value.toString() }
  }

  if (typeof value === 'symbol') {
    return { __type__: 'Symbol', value: value.toString() }
  }

  if (typeof value === 'function') {
    return { __type__: 'Function', name: (value as unknown as Record<string, unknown>).name ?? 'anonymous' }
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    if (seen.has(value as object)) return '<replaced>'
    seen.add(value as object)

    const obj = value as Record<string, unknown>

    if (typeof obj.toJSON === 'function') {
      try {
        return processValue(obj.toJSON(), seen, depth + 1)
      } catch {
        // Fall through to default object handling
      }
    }

    if (typeof obj.toString === 'function' && obj.toString !== Object.prototype.toString) {
      try {
        return obj.toString()
      } catch {
        // Fall through to default object handling
      }
    }

    const processed: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj)) {
      processed[key] = processValue(val, seen, depth + 1)
    }
    return processed
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return '<replaced>'
    seen.add(value)
    return value.map((item) => processValue(item, seen, depth + 1))
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  try {
    JSON.stringify(value)
    return value
  } catch {
    return '<replaced>'
  }
}
