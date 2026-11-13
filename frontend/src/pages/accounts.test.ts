import { describe, expect, it } from 'vitest'
import { ApiError } from '../api.ts'
import { endOfDay, messageOf, UNAVAILABLE } from './accounts.ts'

describe('the account screens’ helpers', () => {
  it('give a refusal’s own message, and say the tool could not be reached otherwise', () => {
    const refused = new ApiError(409, { message: 'That GitHub account is linked to someone else' })
    expect(messageOf(refused)).toBe('That GitHub account is linked to someone else')
    expect(messageOf(new ApiError(500, undefined))).toBe(UNAVAILABLE)
    expect(messageOf(new TypeError('Failed to fetch'))).toBe(UNAVAILABLE)
  })

  it('end a token’s expiry date at the start of the next day, in local time', () => {
    expect(endOfDay('2027-03-31')).toEqual(new Date(2027, 3, 1))
    expect(endOfDay('2027-12-31')).toEqual(new Date(2028, 0, 1))
  })
})
