import { describe, expect, it } from 'vitest'
import { ForbiddenDates, fromDay, LAST_DAY, toDay, weekdayOf } from './working-days.ts'

const weekend = ['saturday', 'sunday'] as const

/** The date of a day number, or `null` for none. */
const dateOf = (day: number | null) => (day === null ? null : fromDay(day))

describe('day numbers', () => {
  it('turns a date into a day number and back, the first and last years included', () => {
    for (const date of ['1970-01-01', '2027-03-01', '2028-02-29', '0001-01-01', '9999-12-31']) {
      expect(dateOf(toDay(date))).toBe(date)
    }
    expect(toDay('1970-01-01')).toBe(0)
    expect(toDay('1969-12-31')).toBe(-1)
    expect(toDay('2027-03-02') - toDay('2027-03-01')).toBe(1)
    expect(toDay('2027-03-01') - toDay('2027-02-28')).toBe(1)
    expect(fromDay(LAST_DAY)).toBe('9999-12-31')
  })

  it('reads years before 100 as they are, not as 1900 and after', () => {
    expect(fromDay(toDay('0050-06-15'))).toBe('0050-06-15')
  })

  it('names the day of the week, before 1970 too', () => {
    expect(weekdayOf(toDay('2027-03-01'))).toBe('monday')
    expect(weekdayOf(toDay('2027-03-07'))).toBe('sunday')
    expect(weekdayOf(toDay('1970-01-01'))).toBe('thursday')
    expect(weekdayOf(toDay('1969-12-29'))).toBe('monday')
  })
})

describe('ForbiddenDates', () => {
  const forbidden = new ForbiddenDates(weekend, ['2027-03-03'])

  it('forbids the weekend days and the dates given, and nothing else', () => {
    expect(forbidden.has(toDay('2027-03-03'))).toBe(true)
    expect(forbidden.has(toDay('2027-03-06'))).toBe(true)
    expect(forbidden.has(toDay('2027-03-07'))).toBe(true)
    expect(forbidden.has(toDay('2027-03-02'))).toBe(false)
  })

  it('finds the next working day after a day, skipping the forbidden ones', () => {
    expect(dateOf(forbidden.nextWorkingDay(toDay('2027-03-01')))).toBe('2027-03-02')
    expect(dateOf(forbidden.nextWorkingDay(toDay('2027-03-02')))).toBe('2027-03-04')
    expect(dateOf(forbidden.nextWorkingDay(toDay('2027-03-05')))).toBe('2027-03-08')
  })

  it('finds no next working day past 9999-12-31', () => {
    expect(forbidden.nextWorkingDay(LAST_DAY)).toBeNull()
    // 9999-12-31 is a Friday: nothing after the Thursday before it but that day.
    expect(dateOf(forbidden.nextWorkingDay(LAST_DAY - 1))).toBe('9999-12-31')
  })

  it('counts a duration over the working days from the start, the start included', () => {
    const finish = (start: string, days: number) => dateOf(forbidden.finishOf(toDay(start), days))
    expect(finish('2027-03-01', 1)).toBe('2027-03-01')
    // Monday, Tuesday and Thursday: the holiday on Wednesday is skipped.
    expect(finish('2027-03-01', 3)).toBe('2027-03-04')
    expect(finish('2027-03-04', 3)).toBe('2027-03-08')
    // A start on a forbidden day is not counted.
    expect(finish('2027-03-06', 1)).toBe('2027-03-08')
  })

  it('finds no finish past 9999-12-31', () => {
    expect(forbidden.finishOf(toDay('9999-12-30'), 3)).toBeNull()
    expect(forbidden.finishOf(toDay('2027-03-01'), 2_147_483_647)).toBeNull()
  })

  it('counts the working days between two days, both included', () => {
    expect(forbidden.workingDaysIn(toDay('2027-03-01'), toDay('2027-03-08'))).toBe(5)
    expect(forbidden.workingDaysIn(toDay('2027-03-06'), toDay('2027-03-07'))).toBe(0)
    expect(forbidden.workingDaysIn(toDay('2027-03-02'), toDay('2027-03-01'))).toBe(0)
  })
})
