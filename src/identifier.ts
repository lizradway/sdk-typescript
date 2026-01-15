/**
 * Identifier validation and generation utilities.
 * Follows the pattern from the Python SDK for consistent ID handling.
 */

/**
 * Identifier types for different entity kinds.
 */
export enum IdentifierType {
  AGENT = 'agent',
  TOOL = 'tool',
  SPAN = 'span',
}

/**
 * Default identifiers for each type.
 */
const DEFAULT_IDENTIFIERS: Record<IdentifierType, string> = {
  [IdentifierType.AGENT]: 'agent',
  [IdentifierType.TOOL]: 'tool',
  [IdentifierType.SPAN]: 'span',
}

/**
 * Generate a random suffix for identifiers.
 */
function generateRandomSuffix(): string {
  return Math.random().toString(36).substring(2, 11)
}

/**
 * Validate and normalize an identifier.
 * If no identifier is provided, generates one using the default prefix.
 *
 * @param identifier - Optional identifier to validate
 * @param type - The type of identifier
 * @returns Validated identifier
 */
export function validateIdentifier(identifier: string | undefined, type: IdentifierType): string {
  if (identifier) {
    return identifier
  }

  const defaultPrefix = DEFAULT_IDENTIFIERS[type]
  return `${defaultPrefix}-${generateRandomSuffix()}`
}
