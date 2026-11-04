import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Database, Executor } from '../db/client.ts'
import {
  absences,
  accounts,
  companyHolidays,
  globalCalendar,
  personalHolidays,
  WEEKDAYS,
} from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import { isSystemAdmin, isUuid } from './system-admins.ts'
import { isDate } from './tasks.ts'

/** A day of the week, as the global calendar names its weekend days. */
export type Weekday = (typeof WEEKDAYS)[number]

export { WEEKDAYS }

/**
 * The weekend of the global calendar until a system admin first sets it. Which days are the
 * weekend is not stated for a fresh deployment; Saturday and Sunday is this module's choice.
 */
export const DEFAULT_WEEKEND_DAYS: readonly Weekday[] = ['saturday', 'sunday']

/** The one global calendar (FR-040): the weekend days, Monday first, and the company holidays. */
export interface GlobalCalendar {
  weekendDays: Weekday[]
  /** The company holidays, `YYYY-MM-DD`, earliest first. */
  holidays: string[]
}

/** A person's own calendar (FR-039): only holidays, never a weekend of its own (SRC-162). */
export interface PersonalCalendar {
  accountId: string
  /** The person's holidays, `YYYY-MM-DD`, earliest first. */
  holidays: string[]
}

/** A person's capacity (FR-037), as a whole percentage of full time. */
export interface Capacity {
  accountId: string
  capacity: number
}

/** An absence (FR-038): whole days (DD-011) from `from` to `to`, both included, `YYYY-MM-DD`. */
export interface Absence {
  id: string
  accountId: string
  from: string
  to: string
}

/** The lowest and highest capacity a person can have, in percent. */
export const MIN_CAPACITY = 0
export const MAX_CAPACITY = 100

/** What a change to the global calendar can hold; anything else is refused. */
const GLOBAL_CHANGE_FIELDS = new Set(['weekendDays', 'addHolidays', 'removeHolidays'])

/** What a change to a person's own calendar can hold; anything else is refused. */
const PERSONAL_CHANGE_FIELDS = new Set(['addHolidays', 'removeHolidays'])

/** The fields of an absence; anything else is refused, a part of a day included (DD-011). */
const ABSENCE_FIELDS = new Set(['from', 'to'])

/**
 * The calendar and availability module of the service layer (SC-008, DD-039). It keeps:
 *
 * - the one global calendar, of the company holidays and the weekend days (FR-040, FR-131), which
 *   anyone with an account can read and only system admins can change (FR-041);
 * - each person's own calendar of holidays, as many as they want and no weekend of its own
 *   (FR-039);
 * - each person's capacity (FR-037) and their absences in whole days (FR-038, DD-011).
 *
 * A person's calendar, capacity and absences are read and changed by the person and by system
 * admins (FR-150). Who else may read them is not stated, so everyone else is refused. Every change
 * is recorded in the audit log (FR-116), in the same transaction; a change that changes nothing
 * records nothing.
 */
export class CalendarService {
  readonly #db: Database
  readonly #audit: AuditLogService

  constructor(db: Database, audit: AuditLogService) {
    this.#db = db
    this.#audit = audit
  }

  /** The global calendar, the same for everyone with an account (FR-040). */
  async globalCalendar(caller: Caller): Promise<GlobalCalendar> {
    await this.#requireAccount(caller)
    return readGlobalCalendar(this.#db)
  }

  /**
   * Changes the global calendar: sets its weekend days (`weekendDays`, FR-131), adds company
   * holidays (`addHolidays`) and removes them (`removeHolidays`) (FR-041), all at once or not at
   * all. Refused to anyone but a system admin, before anything they sent is looked at (FR-041).
   * Adding a holiday the calendar has, or removing one it does not have, changes nothing.
   */
  async changeGlobalCalendar(caller: Caller, change: unknown): Promise<GlobalCalendar> {
    if (!(await isSystemAdmin(this.#db, caller.accountId))) {
      throw new ServiceError(
        'forbidden',
        'Only system admins can change the company holidays and the weekend days',
      )
    }
    const fields = changeFields(change, GLOBAL_CHANGE_FIELDS, 'the global calendar')
    const weekendDays =
      fields.weekendDays === undefined ? undefined : weekendDaysOf(fields.weekendDays)
    const { add, remove } = holidayChanges(fields)

    return this.#db.transaction(async (tx) => {
      // The row is made first, so that concurrent changes of the weekend wait for each other.
      await tx
        .insert(globalCalendar)
        .values({ weekendDays: [...DEFAULT_WEEKEND_DAYS] })
        .onConflictDoNothing()
      const [row] = await tx
        .select({ weekendDays: globalCalendar.weekendDays })
        .from(globalCalendar)
        .for('update')
      const previous = inWeekOrder(row?.weekendDays ?? DEFAULT_WEEKEND_DAYS)
      const details: Record<string, unknown> = {}
      if (weekendDays !== undefined && !sameDays(previous, weekendDays)) {
        await tx.update(globalCalendar).set({ weekendDays })
        details['weekendDays'] = { from: previous, to: weekendDays }
      }
      const added = add.length
        ? (
            await tx
              .insert(companyHolidays)
              .values(add.map((date) => ({ date })))
              .onConflictDoNothing()
              .returning({ date: companyHolidays.date })
          ).map((r) => r.date)
        : []
      const removed = remove.length
        ? (
            await tx
              .delete(companyHolidays)
              .where(inArray(companyHolidays.date, remove))
              .returning({ date: companyHolidays.date })
          ).map((r) => r.date)
        : []
      if (added.length) details['addedHolidays'] = added.sort()
      if (removed.length) details['removedHolidays'] = removed.sort()
      if (Object.keys(details).length) {
        await this.#audit.record(tx, caller, {
          action: 'global-calendar.changed',
          subject: { type: 'global-calendar', id: 'global' },
          details,
        })
      }
      return readGlobalCalendar(tx)
    })
  }

  /** A person's own calendar of holidays (FR-039), for the person and system admins. */
  async personalCalendarOf(caller: Caller, accountId: string): Promise<PersonalCalendar> {
    await this.#requireSelfOrSystemAdmin(caller, accountId, 'read')
    await this.#requireExisting(this.#db, accountId)
    return { accountId, holidays: await readPersonalHolidays(this.#db, accountId) }
  }

  /**
   * Changes a person's own calendar: adds holidays (`addHolidays`) and removes them
   * (`removeHolidays`), as many as they want (FR-039), all at once or not at all. Only the person
   * and system admins may (FR-150). A person's own calendar has no weekend of its own (SRC-162),
   * so a change that tries to set one is refused, as is anything else it does not hold.
   */
  async changePersonalCalendar(
    caller: Caller,
    accountId: string,
    change: unknown,
  ): Promise<PersonalCalendar> {
    await this.#requireSelfOrSystemAdmin(caller, accountId, 'change')
    if (isRecord(change) && Object.hasOwn(change, 'weekendDays')) {
      throw new ServiceError(
        'invalid',
        "A person's own calendar has no weekend of its own: the weekend is set in the global calendar",
      )
    }
    const fields = changeFields(change, PERSONAL_CHANGE_FIELDS, "a person's own calendar")
    const { add, remove } = holidayChanges(fields)

    return this.#db.transaction(async (tx) => {
      await this.#requireExisting(tx, accountId, true)
      const added = add.length
        ? (
            await tx
              .insert(personalHolidays)
              .values(add.map((date) => ({ accountId, date })))
              .onConflictDoNothing()
              .returning({ date: personalHolidays.date })
          ).map((r) => r.date)
        : []
      const removed = remove.length
        ? (
            await tx
              .delete(personalHolidays)
              .where(
                and(
                  eq(personalHolidays.accountId, accountId),
                  inArray(personalHolidays.date, remove),
                ),
              )
              .returning({ date: personalHolidays.date })
          ).map((r) => r.date)
        : []
      if (added.length || removed.length) {
        const details: Record<string, unknown> = {}
        if (added.length) details['addedHolidays'] = added.sort()
        if (removed.length) details['removedHolidays'] = removed.sort()
        await this.#audit.record(tx, caller, {
          action: 'personal-calendar.changed',
          subject: { type: 'account', id: accountId },
          details,
        })
      }
      return { accountId, holidays: await readPersonalHolidays(tx, accountId) }
    })
  }

  /** A person's capacity (FR-037), for the person and system admins. */
  async capacityOf(caller: Caller, accountId: string): Promise<Capacity> {
    await this.#requireSelfOrSystemAdmin(caller, accountId, 'read')
    const [row] = await this.#db
      .select({ capacity: accounts.capacity })
      .from(accounts)
      .where(eq(accounts.id, accountId))
    if (!row) throw noSuchAccount()
    return { accountId, capacity: row.capacity }
  }

  /**
   * Sets a person's capacity (FR-037), a whole percentage of full time from `MIN_CAPACITY` to
   * `MAX_CAPACITY`. Only the person and system admins may (FR-150).
   */
  async setCapacity(caller: Caller, accountId: string, capacity: unknown): Promise<Capacity> {
    await this.#requireSelfOrSystemAdmin(caller, accountId, 'change')
    if (
      typeof capacity !== 'number' ||
      !Number.isInteger(capacity) ||
      capacity < MIN_CAPACITY ||
      capacity > MAX_CAPACITY
    ) {
      throw new ServiceError(
        'invalid',
        `A capacity is a whole percentage from ${MIN_CAPACITY} to ${MAX_CAPACITY}`,
      )
    }
    return this.#db.transaction(async (tx) => {
      const [previous] = await tx
        .select({ capacity: accounts.capacity })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .for('update')
      if (!previous) throw noSuchAccount()
      if (previous.capacity !== capacity) {
        await tx.update(accounts).set({ capacity }).where(eq(accounts.id, accountId))
        await this.#audit.record(tx, caller, {
          action: 'account.capacity-set',
          subject: { type: 'account', id: accountId },
          details: { capacity, previous: previous.capacity },
        })
      }
      return { accountId, capacity }
    })
  }

  /** A person's absences, earliest first (FR-038), for the person and system admins. */
  async absencesOf(caller: Caller, accountId: string): Promise<Absence[]> {
    await this.#requireSelfOrSystemAdmin(caller, accountId, 'read')
    await this.#requireExisting(this.#db, accountId)
    return this.#db
      .select(absenceColumns)
      .from(absences)
      .where(eq(absences.accountId, accountId))
      .orderBy(asc(absences.startsOn), asc(absences.endsOn), asc(absences.id))
  }

  /**
   * Records an absence of a person, such as vacation or sick leave, in whole days from `from` to
   * `to`, both included (FR-038, DD-011). Only the person and system admins may (FR-150).
   */
  async recordAbsence(caller: Caller, accountId: string, absence: unknown): Promise<Absence> {
    await this.#requireSelfOrSystemAdmin(caller, accountId, 'change')
    const fields = changeFields(absence, ABSENCE_FIELDS, 'an absence')
    const { from, to } = fields
    if (!isDate(from) || !isDate(to)) {
      throw new ServiceError(
        'invalid',
        'An absence is in whole days: its first and last day are each a date, YYYY-MM-DD',
      )
    }
    if (to < from) {
      throw new ServiceError('invalid', 'The last day of an absence cannot be before its first')
    }
    return this.#db.transaction(async (tx) => {
      await this.#requireExisting(tx, accountId, true)
      const [created] = await tx
        .insert(absences)
        .values({ accountId, startsOn: from, endsOn: to })
        .returning(absenceColumns)
      if (!created) throw new Error('The new absence was not returned')
      await this.#audit.record(tx, caller, {
        action: 'absence.recorded',
        subject: { type: 'absence', id: created.id },
        details: { accountId, from, to },
      })
      return created
    })
  }

  /** Removes one of a person's absences (FR-038). Only the person and system admins may (FR-150). */
  async removeAbsence(caller: Caller, accountId: string, absenceId: string): Promise<void> {
    await this.#requireSelfOrSystemAdmin(caller, accountId, 'change')
    if (!isUuid(absenceId)) throw noSuchAbsence()
    await this.#db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(absences)
        .where(and(eq(absences.id, absenceId), eq(absences.accountId, accountId)))
        .returning(absenceColumns)
      if (!removed) throw noSuchAbsence()
      await this.#audit.record(tx, caller, {
        action: 'absence.removed',
        subject: { type: 'absence', id: removed.id },
        details: { accountId, from: removed.from, to: removed.to },
      })
    })
  }

  async #requireAccount(caller: Caller): Promise<void> {
    const [account] = isUuid(caller.accountId)
      ? await this.#db
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.id, caller.accountId))
      : []
    if (!account) {
      throw new ServiceError('forbidden', 'Only people with an account can see the global calendar')
    }
  }

  /**
   * Refused before anything else is checked, so a refusal tells nothing about other accounts or
   * what they hold.
   */
  async #requireSelfOrSystemAdmin(
    caller: Caller,
    accountId: string,
    doing: 'read' | 'change',
  ): Promise<void> {
    if (caller.accountId === accountId && isUuid(accountId)) return
    if (!(await isSystemAdmin(this.#db, caller.accountId))) {
      throw new ServiceError(
        'forbidden',
        doing === 'change'
          ? "Only the person themselves and system admins can change a person's capacity, absences and calendar"
          : "Only the person themselves and system admins can see a person's capacity, absences and calendar",
      )
    }
    if (!isUuid(accountId)) throw noSuchAccount()
  }

  /** Refuses an account that does not exist; with `lock`, holds it until the transaction ends. */
  async #requireExisting(executor: Executor, accountId: string, lock = false): Promise<void> {
    const query = executor
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId))
    const [account] = lock ? await query.for('share') : await query
    if (!account) throw noSuchAccount()
  }
}

const absenceColumns = {
  id: absences.id,
  accountId: absences.accountId,
  from: absences.startsOn,
  to: absences.endsOn,
} as const

async function readGlobalCalendar(executor: Executor): Promise<GlobalCalendar> {
  const [row] = await executor
    .select({ weekendDays: globalCalendar.weekendDays })
    .from(globalCalendar)
  const holidays = await executor
    .select({ date: companyHolidays.date })
    .from(companyHolidays)
    .orderBy(asc(companyHolidays.date))
  return {
    weekendDays: inWeekOrder(row?.weekendDays ?? DEFAULT_WEEKEND_DAYS),
    holidays: holidays.map((h) => h.date),
  }
}

async function readPersonalHolidays(executor: Executor, accountId: string): Promise<string[]> {
  const rows = await executor
    .select({ date: personalHolidays.date })
    .from(personalHolidays)
    .where(eq(personalHolidays.accountId, accountId))
    .orderBy(asc(personalHolidays.date))
  return rows.map((r) => r.date)
}

function noSuchAccount(): ServiceError {
  return new ServiceError('not-found', 'There is no such account')
}

function noSuchAbsence(): ServiceError {
  return new ServiceError('not-found', 'There is no such absence')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The fields of a change, refusing a change that is not an object or holds a field it cannot.
 * Exported for its unit tests.
 */
export function changeFields(
  change: unknown,
  allowed: ReadonlySet<string>,
  what: string,
): Record<string, unknown> {
  if (!isRecord(change)) throw new ServiceError('invalid', `A change of ${what} is an object`)
  const unknown = Object.keys(change).filter((key) => !allowed.has(key))
  if (unknown.length) {
    throw new ServiceError(
      'invalid',
      `A change of ${what} cannot hold ${unknown.join(', ')}; it holds only ${[...allowed].join(', ')}`,
    )
  }
  return change
}

/**
 * The weekend days a change sets: weekday names, each once, not all seven, so that a week keeps
 * at least one working day. Answered Monday first. Exported for its unit tests.
 */
export function weekendDaysOf(value: unknown): Weekday[] {
  const names = WEEKDAYS.join(', ')
  if (!Array.isArray(value)) {
    throw new ServiceError('invalid', `The weekend days are a list of days of the week: ${names}`)
  }
  const days: Weekday[] = []
  for (const item of value) {
    const day = WEEKDAYS.find((known) => known === item)
    if (day === undefined) {
      throw new ServiceError('invalid', `A weekend day is a day of the week: ${names}`)
    }
    if (days.includes(day)) {
      throw new ServiceError('invalid', `The weekend days name ${day} twice`)
    }
    days.push(day)
  }
  if (days.length === WEEKDAYS.length) {
    throw new ServiceError('invalid', 'The weekend cannot be every day of the week')
  }
  return inWeekOrder(days)
}

/**
 * The holidays a change adds and removes, each a date, `YYYY-MM-DD`, and none both added and
 * removed. A date given twice in one list counts once. Exported for its unit tests.
 */
export function holidayChanges(fields: Record<string, unknown>): {
  add: string[]
  remove: string[]
} {
  const add = datesOf(fields['addHolidays'], 'The holidays to add')
  const remove = datesOf(fields['removeHolidays'], 'The holidays to remove')
  const both = add.filter((date) => remove.includes(date))
  if (both.length) {
    throw new ServiceError(
      'invalid',
      `A holiday cannot be both added and removed in one change: ${both.join(', ')}`,
    )
  }
  return { add, remove }
}

function datesOf(value: unknown, what: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every(isDate)) {
    throw new ServiceError('invalid', `${what} are a list of whole days, each a date, YYYY-MM-DD`)
  }
  return [...new Set(value)]
}

function inWeekOrder(days: readonly Weekday[]): Weekday[] {
  return WEEKDAYS.filter((day) => days.includes(day))
}

function sameDays(a: readonly Weekday[], b: readonly Weekday[]): boolean {
  return a.length === b.length && a.every((day, i) => day === b[i])
}
