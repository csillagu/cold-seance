import { describe, expect, it } from 'vitest'
import { dateVariance, GlobalWorkingDays } from './variance.ts'

// The variance of one date (SC-044, FR-066), counted in working days of the global calendar
// (SRC-244), without a database: the rest of the calculator is tested against PostgreSQL in
// test/integration/variance.test.ts. 2027-03-01 is a Monday.

const weekend = new GlobalWorkingDays({ weekendDays: ['saturday', 'sunday'], holidays: [] })

describe('GlobalWorkingDays.between', () => {
  it('counts the working days to a later date as positive', () => {
    expect(weekend.between('2027-03-01', '2027-03-02')).toBe(1)
    expect(weekend.between('2027-03-10', '2027-03-12')).toBe(2)
  })

  it('counts them as negative to an earlier date, and as 0 to the same date', () => {
    expect(weekend.between('2027-03-02', '2027-03-01')).toBe(-1)
    expect(weekend.between('2027-03-01', '2027-03-01')).toBe(0)
  })

  it('leaves out the weekend: Friday to Monday is one working day, either way', () => {
    expect(weekend.between('2027-03-05', '2027-03-08')).toBe(1)
    expect(weekend.between('2027-03-08', '2027-03-05')).toBe(-1)
  })

  it('counts whole weeks as their working days, across months and a leap day', () => {
    expect(weekend.between('2027-03-01', '2027-03-15')).toBe(10)
    expect(weekend.between('2028-02-25', '2028-03-03')).toBe(5)
    expect(weekend.between('2027-03-01', '2028-02-28')).toBe(260)
  })

  it('counts 0 for a move onto a day off that passes no working day', () => {
    expect(weekend.between('2027-03-05', '2027-03-06')).toBe(0)
    expect(weekend.between('2027-03-06', '2027-03-07')).toBe(0)
  })

  it('leaves out company holidays, and counts a holiday on a weekend day once', () => {
    const calendar = new GlobalWorkingDays({
      weekendDays: ['saturday', 'sunday'],
      holidays: ['2027-03-03', '2027-03-06', '2027-03-03'],
    })
    expect(calendar.between('2027-03-01', '2027-03-05')).toBe(3)
    expect(calendar.between('2027-03-05', '2027-03-01')).toBe(-3)
    expect(calendar.between('2027-03-01', '2027-03-08')).toBe(4)
  })

  it("follows the global calendar's own weekend days", () => {
    const friSat = new GlobalWorkingDays({ weekendDays: ['friday', 'saturday'], holidays: [] })
    // Thursday 2027-03-04 to Sunday 2027-03-07: only Sunday is a working day.
    expect(friSat.between('2027-03-04', '2027-03-07')).toBe(1)
    const none = new GlobalWorkingDays({ weekendDays: [], holidays: [] })
    expect(none.between('2027-03-05', '2027-03-08')).toBe(3)
  })
})

describe('dateVariance', () => {
  it('is the planned date minus the baseline where there is no actual date', () => {
    expect(dateVariance(weekend, '2027-03-01', '2027-03-02', null)).toBe(1)
  })

  it('is the actual date minus the baseline where there is one, whatever the plan says', () => {
    expect(dateVariance(weekend, '2027-03-02', '2027-03-02', '2027-03-01')).toBe(-1)
  })

  it('is null where the baseline has no date, or neither the plan nor the actual dates do', () => {
    expect(dateVariance(weekend, null, '2027-03-02', null)).toBeNull()
    expect(dateVariance(weekend, '2027-03-01', null, null)).toBeNull()
  })
})
