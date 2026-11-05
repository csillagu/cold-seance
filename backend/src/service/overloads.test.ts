import { describe, expect, it } from 'vitest'
import { isOverloaded, overloadedDays } from './overloads.ts'

describe('the overload detector (SC-040)', () => {
  it('marks a load above capacity as an overload, and a load equal to it as none (FR-042)', () => {
    expect(isOverloaded(101, 100)).toBe(true)
    expect(isOverloaded(100, 100)).toBe(false)
    expect(isOverloaded(80, 80)).toBe(false)
    expect(isOverloaded(0, 0)).toBe(false)
    expect(isOverloaded(10, 0)).toBe(true)
  })

  it('gives the days on which the load is above the capacity, in order', () => {
    expect(
      overloadedDays([
        { date: '2027-03-01', load: 100, capacity: 80 },
        { date: '2027-03-02', load: 80, capacity: 80 },
        { date: '2027-03-03', load: 10, capacity: 0 },
      ]),
    ).toEqual(['2027-03-01', '2027-03-03'])
  })
})
