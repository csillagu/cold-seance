import { describe, expect, it } from 'vitest'
import { dateVariance, daysBetween } from './variance.ts'

// The variance of one date (SC-044, FR-066), without a database: the rest of the calculator is
// tested against PostgreSQL in test/integration/variance.test.ts.

describe('daysBetween', () => {
  it('counts the calendar days from one date to a later one as positive', () => {
    expect(daysBetween('2027-03-01', '2027-03-02')).toBe(1)
    expect(daysBetween('2027-03-10', '2027-03-12')).toBe(2)
  })

  it('counts them as negative to an earlier date, and as 0 to the same date', () => {
    expect(daysBetween('2027-03-02', '2027-03-01')).toBe(-1)
    expect(daysBetween('2027-03-01', '2027-03-01')).toBe(0)
  })

  it('counts every calendar day across a weekend, a month and a leap day', () => {
    expect(daysBetween('2027-03-05', '2027-03-08')).toBe(3)
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
  })
})

describe('dateVariance', () => {
  it('is the planned date minus the baseline where there is no actual date', () => {
    expect(dateVariance('2027-03-01', '2027-03-02', null)).toBe(1)
  })

  it('is the actual date minus the baseline where there is one, whatever the plan says', () => {
    expect(dateVariance('2027-03-02', '2027-03-02', '2027-03-01')).toBe(-1)
  })

  it('is null where the baseline has no date, or neither the plan nor the actual dates do', () => {
    expect(dateVariance(null, '2027-03-02', null)).toBeNull()
    expect(dateVariance('2027-03-01', null, null)).toBeNull()
  })
})
