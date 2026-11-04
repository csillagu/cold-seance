import { describe, expect, it, vi } from 'vitest'
import { localToday } from './task-status.ts'

// The date an actual start or finish is recorded with: today in the deployment's time zone. The
// transitions themselves are tested against the database in test/integration/task-status.test.ts.

describe('localToday', () => {
  it("answers the date of the given moment in the process's time zone, as YYYY-MM-DD", () => {
    const moment = new Date(2027, 2, 1, 23, 59, 59)
    expect(localToday(moment)).toBe('2027-03-01')
    expect(localToday(new Date(2027, 11, 31, 0, 0, 0))).toBe('2027-12-31')
  })

  it('pads the year, month and day', () => {
    const moment = new Date(2027, 0, 5)
    moment.setFullYear(987)
    expect(localToday(moment)).toBe('0987-01-05')
  })

  it('answers today when given no moment', () => {
    vi.useFakeTimers({ now: new Date(2027, 5, 15, 12, 0, 0) })
    try {
      expect(localToday()).toBe('2027-06-15')
    } finally {
      vi.useRealTimers()
    }
  })
})
