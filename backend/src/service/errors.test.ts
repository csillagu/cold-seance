import { describe, expect, it } from 'vitest'
import { ServiceError } from './errors.ts'

describe('ServiceError', () => {
  it('carries its kind and its message', () => {
    const error = new ServiceError('not-found', 'No task T-9')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ServiceError')
    expect(error.kind).toBe('not-found')
    expect(error.message).toBe('No task T-9')
  })
})
