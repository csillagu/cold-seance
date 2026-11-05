import { WEEKDAYS } from '../db/schema.ts'

/** A day of the week, as the global calendar names its weekend days. */
type Weekday = (typeof WEEKDAYS)[number]

/**
 * The weekend of the global calendar until a system admin first sets it. Which days are the
 * weekend is not stated for a fresh deployment; Saturday and Sunday is the calendar module's
 * choice (SC-008).
 */
export const DEFAULT_WEEKEND_DAYS: readonly Weekday[] = ['saturday', 'sunday']

/**
 * A date as a whole number of days since 1970-01-01, which the scheduler counts with: the next day
 * is one more, whatever the month or year.
 */
export type DayNumber = number

const MS_PER_DAY = 86_400_000

/** The day number of a date, `YYYY-MM-DD`, from year 1 to 9999. */
export function toDay(date: string): DayNumber {
  const [year = 1, month = 1, day = 1] = date.split('-').map(Number)
  const value = new Date(0)
  // setUTCFullYear, not Date.UTC, which reads years 0 to 99 as 1900 to 1999.
  value.setUTCFullYear(year, month - 1, day)
  return Math.round(value.getTime() / MS_PER_DAY)
}

/** The date of a day number, `YYYY-MM-DD`. */
export function fromDay(day: DayNumber): string {
  const value = new Date(day * MS_PER_DAY)
  const year = String(value.getUTCFullYear()).padStart(4, '0')
  const month = String(value.getUTCMonth() + 1).padStart(2, '0')
  const date = String(value.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${date}`
}

/** The last date a task can have: the last date `YYYY-MM-DD` writes. */
export const LAST_DAY: DayNumber = toDay('9999-12-31')

/** The day of the week of a day number, as the global calendar names it. */
export function weekdayOf(day: DayNumber): Weekday {
  // 1970-01-01 was a Thursday, the fourth day of a week that starts on Monday.
  return WEEKDAYS[(((day + 3) % 7) + 7) % 7] ?? 'thursday'
}

/**
 * The forbidden dates of one task (FR-007): the global calendar's weekend days and company
 * holidays, which are forbidden for every task (FR-010), and the days off of each person assigned
 * to it (FR-008). A task with nobody assigned has the global calendar's alone (FR-009), and so
 * does an assigned person who has not filled in their own calendar, while the others' own
 * calendars still apply (FR-146).
 */
export class ForbiddenDates {
  readonly #weekend: ReadonlySet<Weekday>
  readonly #dates: ReadonlySet<DayNumber>

  constructor(weekendDays: Iterable<Weekday>, dates: Iterable<string>) {
    this.#weekend = new Set(weekendDays)
    this.#dates = new Set([...dates].map(toDay))
  }

  /** Whether the day is forbidden for the task. */
  has(day: DayNumber): boolean {
    return this.#weekend.has(weekdayOf(day)) || this.#dates.has(day)
  }

  /** The first day after `day` that is not forbidden, or `null` if there is none by 9999-12-31. */
  nextWorkingDay(day: DayNumber): DayNumber | null {
    for (let next = day + 1; next <= LAST_DAY; next++) {
      if (!this.has(next)) return next
    }
    return null
  }

  /**
   * The finish of a task that starts on `start` and takes `duration` working days (FR-144): the
   * day its last working day falls on, counting from `start` and skipping its forbidden dates, or
   * `null` if it runs past 9999-12-31.
   */
  finishOf(start: DayNumber, duration: number): DayNumber | null {
    let left = duration
    for (let day = start; day <= LAST_DAY; day++) {
      if (!this.has(day)) left--
      if (left === 0) return day
    }
    return null
  }

  /** How many working days the task has from `start` to `finish`, both included. */
  workingDaysIn(start: DayNumber, finish: DayNumber): number {
    let count = 0
    for (let day = start; day <= finish; day++) {
      if (!this.has(day)) count++
    }
    return count
  }
}
