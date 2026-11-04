import { describe, expect, it } from 'vitest'
import { changeFields, holidayChanges, weekendDaysOf } from './calendars.ts'
import { ServiceError } from './errors.ts'

// The calendar module's checks of what a change holds, which need no database. The module's rules
// against the database, and its test cases, are in test/integration/calendars.test.ts.

function refusal(run: () => unknown): ServiceError {
  try {
    run()
  } catch (error) {
    if (error instanceof ServiceError) return error
    throw error
  }
  throw new Error('expected a ServiceError')
}

describe('changeFields', () => {
  const allowed = new Set(['addHolidays', 'removeHolidays'])

  it('answers the fields of a change that holds only allowed fields', () => {
    const change = { addHolidays: ['2027-03-03'] }
    expect(changeFields(change, allowed, 'a calendar')).toBe(change)
    expect(changeFields({}, allowed, 'a calendar')).toEqual({})
  })

  it.each([null, 'add', 3, ['2027-03-03']])('refuses %j, which is not an object', (change) => {
    const error = refusal(() => changeFields(change, allowed, 'a calendar'))
    expect(error.kind).toBe('invalid')
    expect(error.message).toBe('A change of a calendar is an object')
  })

  it('refuses a field it does not hold, naming it and what it holds', () => {
    const error = refusal(() => changeFields({ hours: 4, addHolidays: [] }, allowed, 'a calendar'))
    expect(error.kind).toBe('invalid')
    expect(error.message).toBe(
      'A change of a calendar cannot hold hours; it holds only addHolidays, removeHolidays',
    )
  })
})

describe('weekendDaysOf', () => {
  it('answers the days Monday first, whatever order they were given in', () => {
    expect(weekendDaysOf(['sunday', 'friday', 'saturday'])).toEqual([
      'friday',
      'saturday',
      'sunday',
    ])
  })

  it('takes no weekend at all, and six days of it', () => {
    expect(weekendDaysOf([])).toEqual([])
    expect(
      weekendDaysOf(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
    ).toHaveLength(6)
  })

  it.each([
    ['not a list', 'saturday', 'The weekend days are a list of days of the week'],
    ['an unknown day', ['saturday', 'Sunday'], 'A weekend day is a day of the week'],
    ['a day that is not text', [6], 'A weekend day is a day of the week'],
    ['a day twice', ['saturday', 'saturday'], 'The weekend days name saturday twice'],
    [
      'every day of the week',
      ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      'The weekend cannot be every day of the week',
    ],
  ])('refuses %s', (_, value, message) => {
    const error = refusal(() => weekendDaysOf(value))
    expect(error.kind).toBe('invalid')
    expect(error.message).toContain(message)
  })
})

describe('holidayChanges', () => {
  it('answers nothing to add or remove when neither is given', () => {
    expect(holidayChanges({})).toEqual({ add: [], remove: [] })
  })

  it('answers the dates to add and remove, each date once', () => {
    expect(
      holidayChanges({
        addHolidays: ['2027-03-03', '2027-03-04', '2027-03-03'],
        removeHolidays: ['2027-12-25'],
      }),
    ).toEqual({ add: ['2027-03-03', '2027-03-04'], remove: ['2027-12-25'] })
  })

  it.each([
    ['a lone date', { addHolidays: '2027-03-03' }, 'The holidays to add'],
    ['a date and a time', { addHolidays: ['2027-03-03T09:00'] }, 'The holidays to add'],
    ['a date that does not exist', { removeHolidays: ['2027-02-29'] }, 'The holidays to remove'],
    ['a date that is not text', { removeHolidays: [20270303] }, 'The holidays to remove'],
  ])('refuses %s', (_, fields, what) => {
    const error = refusal(() => holidayChanges(fields))
    expect(error.kind).toBe('invalid')
    expect(error.message).toBe(`${what} are a list of whole days, each a date, YYYY-MM-DD`)
  })

  it('refuses a date both added and removed', () => {
    const error = refusal(() =>
      holidayChanges({ addHolidays: ['2027-03-03'], removeHolidays: ['2027-03-03'] }),
    )
    expect(error.kind).toBe('invalid')
    expect(error.message).toBe(
      'A holiday cannot be both added and removed in one change: 2027-03-03',
    )
  })
})
