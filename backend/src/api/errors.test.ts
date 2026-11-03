import { describe, expect, it } from 'vitest'
import { errorBody } from './errors.ts'

describe('errorBody', () => {
  it('names the status as HTTP does', () => {
    expect(errorBody(403, 'No')).toEqual({ statusCode: 403, error: 'Forbidden', message: 'No' })
  })

  it('falls back to a plain name for a status HTTP does not name', () => {
    expect(errorBody(499, 'Odd')).toEqual({ statusCode: 499, error: 'Error', message: 'Odd' })
  })
})
