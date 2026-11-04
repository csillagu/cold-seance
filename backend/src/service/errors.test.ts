import { describe, expect, it } from 'vitest'
import { NOT_VISIBLE_MESSAGE, notVisible, ServiceError } from './errors.ts'

describe('ServiceError', () => {
  it('carries its kind and its message', () => {
    const error = new ServiceError('not-found', 'No task T-9')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ServiceError')
    expect(error.kind).toBe('not-found')
    expect(error.message).toBe('No task T-9')
  })
})

describe('notVisible', () => {
  it('says plainly that the project is not visible, and nothing vaguer (FR-017)', () => {
    const error = notVisible()
    expect(error.kind).toBe('not-visible')
    expect(error.message).toBe(NOT_VISIBLE_MESSAGE)
    expect(error.message).toBe('This project is not visible to you')
    expect(error.message).not.toMatch(/not found|deleted|no permission/i)
  })
})
