import { describe, expect, it } from 'vitest'
import type { AssignedTask } from './daily-person-load.ts'
import type { Calendars } from './scheduler.ts'
import { type FitInputs, fits, rateEligibility } from './unassigned-ratings.ts'

const fitting =
  (...people: string[]) =>
  (person: string) =>
    people.includes(person)

describe('rateEligibility (FR-045)', () => {
  it('is red when no valid combination fits', () => {
    expect(rateEligibility({ any: ['a', 'b'] }, fitting())).toBe('red')
    expect(rateEligibility('a', fitting())).toBe('red')
    // Every combination of A AND (B OR C) takes A.
    expect(rateEligibility({ all: ['a', { any: ['b', 'c'] }] }, fitting('b', 'c'))).toBe('red')
  })

  it('is amber when some combinations fit and others overload someone (SRC-201)', () => {
    expect(rateEligibility({ any: ['a', 'b'] }, fitting('b'))).toBe('amber')
    expect(rateEligibility({ all: ['a', { any: ['b', 'c'] }] }, fitting('a', 'c'))).toBe('amber')
    expect(rateEligibility({ any: [{ all: ['a', 'b'] }, 'c'] }, fitting('c'))).toBe('amber')
  })

  it('is green when no combination overloads anyone', () => {
    expect(rateEligibility({ any: ['a', 'b'] }, fitting('a', 'b'))).toBe('green')
    expect(rateEligibility('a', fitting('a'))).toBe('green')
    expect(rateEligibility({ all: ['a', { any: ['b', 'c'] }] }, fitting('a', 'b', 'c'))).toBe(
      'green',
    )
  })

  it('reads an AND as needing every operand, and an OR one of them', () => {
    expect(rateEligibility({ all: ['a', 'b'] }, fitting('a'))).toBe('red')
    expect(rateEligibility({ any: [{ all: ['a', 'b'] }, { all: ['c'] }] }, fitting('a', 'b'))).toBe(
      'amber',
    )
  })
})

const calendars = (personal: Record<string, string[]> = {}): Calendars => ({
  weekendDays: ['saturday', 'sunday'],
  holidays: [],
  personalHolidays: new Map(Object.entries(personal)),
})

const assigned = (load: number, plannedStart: string, plannedFinish: string): AssignedTask => ({
  id: 't',
  projectId: 'p',
  title: 'T',
  plannedStart,
  plannedFinish,
  load,
  assignees: ['a'],
})

const inputs = (overrides: Partial<FitInputs> = {}): FitInputs => ({
  tasks: [],
  calendars: calendars(),
  absences: [],
  capacity: 100,
  ...overrides,
})

// Monday 2027-03-01 to Friday 2027-03-05.
const week = { plannedStart: '2027-03-01', plannedFinish: '2027-03-05' }

describe('fits', () => {
  it('fits someone with nothing else on', () => {
    expect(fits({ ...week, load: 100 }, 'a', inputs())).toBe(true)
  })

  it('fits up to the capacity, and not above it (FR-042)', () => {
    const busy = inputs({ tasks: [assigned(40, '2027-03-03', '2027-03-03')] })
    expect(fits({ ...week, load: 60 }, 'a', busy)).toBe(true)
    expect(fits({ ...week, load: 61 }, 'a', busy)).toBe(false)
    expect(fits({ ...week, load: 100 }, 'a', inputs({ capacity: 80 }))).toBe(false)
  })

  it('does not fit someone absent on one of its days (FR-151)', () => {
    const absent = inputs({ absences: [{ from: '2027-03-04', to: '2027-03-04' }] })
    expect(fits({ ...week, load: 10 }, 'a', absent)).toBe(false)
    expect(fits({ ...week, load: 0 }, 'a', absent)).toBe(true)
  })

  it('leaves out weekend days and the days off of the person, on which the task would not run', () => {
    const weekendWork = inputs({ tasks: [assigned(100, '2027-03-06', '2027-03-07')] })
    expect(
      fits(
        { plannedStart: '2027-03-05', plannedFinish: '2027-03-08', load: 100 },
        'a',
        weekendWork,
      ),
    ).toBe(true)
    // An absence on 2027-03-03 does not count for a person who has that day off, since the task
    // would not run on it with them assigned; it does for one who works that day.
    const dayOff = inputs({
      calendars: calendars({ a: ['2027-03-03'] }),
      absences: [{ from: '2027-03-03', to: '2027-03-03' }],
    })
    expect(fits({ ...week, load: 100 }, 'a', dayOff)).toBe(true)
    expect(fits({ ...week, load: 100 }, 'b', dayOff)).toBe(false)
  })
})
