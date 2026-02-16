import type { JSONSchema7 } from 'json-schema'
import { JsonValidationError } from '../errors.js'
import { logger } from '../logging/index.js'

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
 * Handles Date objects and replaces unserializable values with '<replaced>'.
 *
 * @param value - The value to serialize
 * @returns JSON string representation
 */
export function serialize(value: unknown): string {
  try {
    const processed = processValue(value)
    const result = JSON.stringify(processed)
    return result ?? 'undefined'
  } catch (error) {
    logger.warn(`error=<${error}> | failed to encode value, returning empty object`)
    return '{}'
  }
}

/**
 * Process any value, handling containers recursively.
 * Replaces unserializable values with '<replaced>'.
 *
 * @param value - The value to process
 * @returns Processed value safe for JSON serialization
 */
function processValue(value: unknown): unknown {
  // Handle Date objects
  if (value instanceof Date) {
    return value.toISOString()
  }

  // Handle dictionaries (objects)
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    const processed: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj)) {
      processed[key] = processValue(val)
    }
    return processed
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item) => processValue(item))
  }

  // Test if the value is JSON serializable
  try {
    JSON.stringify(value)
    return value
  } catch {
    return '<replaced>'
  }
}
