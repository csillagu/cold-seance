// Reading the fields of what GitHub answers, which the tool does not trust to have any shape.

export function objectField(json: unknown, name: string): unknown {
  if (typeof json !== 'object' || json === null) return undefined
  const value: unknown = Reflect.get(json, name)
  return value
}

export function stringField(json: unknown, name: string): string | undefined {
  const value = objectField(json, name)
  return typeof value === 'string' ? value : undefined
}

export function numberField(json: unknown, name: string): number | undefined {
  const value = objectField(json, name)
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

export function arrayField(json: unknown, name: string): unknown[] {
  const value = objectField(json, name)
  return Array.isArray(value) ? (value as unknown[]) : []
}
