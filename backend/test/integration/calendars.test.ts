import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import {
  absences,
  accounts,
  auditLog,
  companyHolidays,
  globalCalendar,
  personalHolidays,
  projectMembers,
} from '../../src/db/schema.ts'
import { type CalendarService, DEFAULT_WEEKEND_DAYS } from '../../src/service/calendars.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { createServices } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, insertProject, seedProject } from '../helpers/projects.ts'

// The calendar and availability module (SC-008) against a real PostgreSQL: its rules, then the
// test cases of FR-037 to FR-041, FR-131 and FR-150 through the REST API.

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const by = (account: { id: string }): Caller => ({ accountId: account.id, channel: 'ui' })

async function refused(promise: Promise<unknown>, kind: ServiceError['kind']) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  if (!(error instanceof ServiceError)) {
    throw new Error(`expected a ServiceError, got ${String(error)}`)
  }
  expect(error.kind).toBe(kind)
  return error
}

/** The days from `first` to `last`, both included, `YYYY-MM-DD`. */
function daysFrom(first: string, last: string): string[] {
  const days: string[] = []
  for (let d = new Date(`${first}T00:00:00Z`); d <= new Date(`${last}T00:00:00Z`);) {
    days.push(d.toISOString().slice(0, 10))
    d = new Date(d.getTime() + 86_400_000)
  }
  return days
}

/** Monday to Friday, by the day of the week of a `YYYY-MM-DD` date. */
const isWorkingDay = (date: string) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())

describe('the calendar service', () => {
  let x: TestDatabase
  let service: CalendarService
  let root: Seeded
  let alice: Seeded
  let bob: Seeded

  beforeAll(async () => {
    x = await createTestDatabase()
    service = createServices(x.db).calendars
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
  })

  beforeEach(async () => {
    // Each test gets its own people; the global calendar is reset, since there is only one.
    alice = await seedAccount(x.db, { username: `alice-${randomUUID()}` })
    bob = await seedAccount(x.db, { username: `bob-${randomUUID()}` })
    await x.db.delete(companyHolidays)
    await x.db.delete(globalCalendar)
    await x.db.delete(auditLog)
  })

  afterAll(async () => {
    await x?.drop()
  })

  const audit = () => x.db.select().from(auditLog)

  describe('the global calendar', () => {
    it('is Saturday and Sunday with no holidays until a system admin changes it', async () => {
      expect(await service.globalCalendar(by(alice))).toEqual({
        weekendDays: ['saturday', 'sunday'],
        holidays: [],
      })
      expect(DEFAULT_WEEKEND_DAYS).toEqual(['saturday', 'sunday'])
      expect(await x.db.select().from(globalCalendar)).toEqual([])
    })

    it('is refused to a caller with no account', async () => {
      const error = await refused(service.globalCalendar(by({ id: randomUUID() })), 'forbidden')
      expect(error.message).toBe('Only people with an account can see the global calendar')
      await refused(service.globalCalendar(by({ id: 'not-a-uuid' })), 'forbidden')
    })

    it('lets a system admin set the weekend days, answered Monday first, and records it', async () => {
      const calendar = await service.changeGlobalCalendar(by(root), {
        weekendDays: ['saturday', 'friday'],
      })
      expect(calendar).toEqual({ weekendDays: ['friday', 'saturday'], holidays: [] })
      expect(await service.globalCalendar(by(bob))).toEqual(calendar)
      expect(await audit()).toMatchObject([
        {
          actorAccountId: root.id,
          channels: ['ui'],
          projectId: null,
          action: 'global-calendar.changed',
          subjectType: 'global-calendar',
          subjectId: 'global',
          details: { weekendDays: { from: ['saturday', 'sunday'], to: ['friday', 'saturday'] } },
        },
      ])
    })

    it('takes a weekend of no days at all', async () => {
      expect(
        (await service.changeGlobalCalendar(by(root), { weekendDays: [] })).weekendDays,
      ).toEqual([])
    })

    it('adds and removes company holidays in one change, earliest first, and records both', async () => {
      await service.changeGlobalCalendar(by(root), { addHolidays: ['2027-12-25'] })
      const calendar = await service.changeGlobalCalendar(by(root), {
        addHolidays: ['2027-12-26', '2027-03-03', '2027-03-03'],
        removeHolidays: ['2027-12-25'],
      })
      expect(calendar.holidays).toEqual(['2027-03-03', '2027-12-26'])
      expect((await audit()).map((e) => e.details)).toEqual([
        { addedHolidays: ['2027-12-25'] },
        { addedHolidays: ['2027-03-03', '2027-12-26'], removedHolidays: ['2027-12-25'] },
      ])
    })

    it('records nothing for a change that changes nothing', async () => {
      await service.changeGlobalCalendar(by(root), { addHolidays: ['2027-03-03'] })
      await x.db.delete(auditLog)
      const calendar = await service.changeGlobalCalendar(by(root), {
        weekendDays: ['sunday', 'saturday'],
        addHolidays: ['2027-03-03'],
        removeHolidays: ['2027-04-01'],
      })
      expect(calendar).toEqual({ weekendDays: ['saturday', 'sunday'], holidays: ['2027-03-03'] })
      expect(await audit()).toEqual([])
      expect(await service.changeGlobalCalendar(by(root), {})).toEqual(calendar)
      expect(await audit()).toEqual([])
    })

    it('refuses a change from anyone but a system admin, before looking at it', async () => {
      const projectAdmin = alice
      await seedProject(x.db, projectAdmin)
      for (const change of [{ addHolidays: ['2027-03-03'] }, { weekendDays: ['friday'] }, 'junk']) {
        const error = await refused(
          service.changeGlobalCalendar(by(projectAdmin), change),
          'forbidden',
        )
        expect(error.message).toBe(
          'Only system admins can change the company holidays and the weekend days',
        )
      }
      await refused(service.changeGlobalCalendar(by({ id: randomUUID() }), {}), 'forbidden')
      expect(await service.globalCalendar(by(bob))).toEqual({
        weekendDays: ['saturday', 'sunday'],
        holidays: [],
      })
      expect(await audit()).toEqual([])
    })

    it.each([
      [
        'a weekend that is every day',
        {
          weekendDays: [
            'monday',
            'tuesday',
            'wednesday',
            'thursday',
            'friday',
            'saturday',
            'sunday',
          ],
        },
      ],
      ['an unknown day', { weekendDays: ['caturday'] }],
      ['a holiday that is not a date', { addHolidays: ['2027-03-03', 'christmas'] }],
      [
        'a holiday both added and removed',
        { addHolidays: ['2027-03-03'], removeHolidays: ['2027-03-03'] },
      ],
      ['a field the calendar does not hold', { addHolidays: ['2027-03-03'], name: 'Easter' }],
      ['a change that is not an object', ['2027-03-03']],
    ])('refuses %s and changes nothing', async (_, change) => {
      await refused(service.changeGlobalCalendar(by(root), change), 'invalid')
      expect(await service.globalCalendar(by(root))).toEqual({
        weekendDays: ['saturday', 'sunday'],
        holidays: [],
      })
      expect(await audit()).toEqual([])
    })

    it('makes concurrent changes of the weekend wait for each other', async () => {
      await Promise.all([
        service.changeGlobalCalendar(by(root), { weekendDays: ['friday', 'saturday'] }),
        service.changeGlobalCalendar(by(root), { weekendDays: ['sunday'] }),
      ])
      // Whichever ran second saw what the first set.
      const weekend = (from: string[], to: string[]) => ({ weekendDays: { from, to } })
      const fridaySaturday = ['friday', 'saturday']
      const weekendDefault = ['saturday', 'sunday']
      expect([
        [weekend(weekendDefault, fridaySaturday), weekend(fridaySaturday, ['sunday'])],
        [weekend(weekendDefault, ['sunday']), weekend(['sunday'], fridaySaturday)],
      ]).toContainEqual((await audit()).map((e) => e.details))
      expect(await x.db.select().from(globalCalendar)).toHaveLength(1)
    })
  })

  describe("a person's own calendar", () => {
    it('starts empty and holds the holidays the person adds, earliest first', async () => {
      expect(await service.personalCalendarOf(by(alice), alice.id)).toEqual({
        accountId: alice.id,
        holidays: [],
      })
      const calendar = await service.changePersonalCalendar(by(alice), alice.id, {
        addHolidays: ['2027-03-15', '2027-03-01'],
      })
      expect(calendar).toEqual({ accountId: alice.id, holidays: ['2027-03-01', '2027-03-15'] })
      expect(await service.personalCalendarOf(by(alice), alice.id)).toEqual(calendar)
      expect(await audit()).toMatchObject([
        {
          actorAccountId: alice.id,
          projectId: null,
          action: 'personal-calendar.changed',
          subjectType: 'account',
          subjectId: alice.id,
          details: { addedHolidays: ['2027-03-01', '2027-03-15'] },
        },
      ])
    })

    it('removes holidays, and records nothing for a change that changes nothing', async () => {
      await service.changePersonalCalendar(by(alice), alice.id, {
        addHolidays: ['2027-03-01', '2027-03-02'],
      })
      const calendar = await service.changePersonalCalendar(by(alice), alice.id, {
        removeHolidays: ['2027-03-01', '2027-05-05'],
      })
      expect(calendar.holidays).toEqual(['2027-03-02'])
      await service.changePersonalCalendar(by(alice), alice.id, {
        addHolidays: ['2027-03-02'],
        removeHolidays: ['2027-05-05'],
      })
      expect((await audit()).map((e) => e.details)).toEqual([
        { addedHolidays: ['2027-03-01', '2027-03-02'] },
        { removedHolidays: ['2027-03-01'] },
      ])
    })

    it('adds and removes more holidays than one statement can take, in either calendar', async () => {
      const many = daysFrom('1900-01-01', '2009-12-31')
      expect(many.length).toBeGreaterThan(40_000)
      const own = await service.changePersonalCalendar(by(alice), alice.id, { addHolidays: many })
      expect(own.holidays).toEqual(many)
      const company = await service.changeGlobalCalendar(by(root), { addHolidays: many })
      expect(company.holidays).toEqual(many)
      expect(
        (await service.changePersonalCalendar(by(alice), alice.id, { removeHolidays: many }))
          .holidays,
      ).toEqual([])
      expect(
        (await service.changeGlobalCalendar(by(root), { removeHolidays: many })).holidays,
      ).toEqual([])
    })

    it("keeps each person's holidays apart from everyone else's and from the global calendar", async () => {
      await service.changePersonalCalendar(by(alice), alice.id, { addHolidays: ['2027-03-01'] })
      expect((await service.personalCalendarOf(by(bob), bob.id)).holidays).toEqual([])
      expect((await service.globalCalendar(by(bob))).holidays).toEqual([])
    })

    it('refuses a weekend of its own, whatever else the change holds, and changes nothing', async () => {
      for (const change of [
        { weekendDays: ['friday'] },
        { weekendDays: [], addHolidays: ['2027-03-01'] },
      ]) {
        const error = await refused(
          service.changePersonalCalendar(by(alice), alice.id, change),
          'invalid',
        )
        expect(error.message).toBe(
          "A person's own calendar has no weekend of its own: the weekend is set in the global calendar",
        )
      }
      expect((await service.personalCalendarOf(by(alice), alice.id)).holidays).toEqual([])
      expect(await audit()).toEqual([])
    })

    it.each([
      ['a holiday that is not a date', { addHolidays: ['2027-13-01'] }],
      ['a part of a day', { addHolidays: ['2027-03-01T12:00'] }],
      ['a field it does not hold', { holidays: ['2027-03-01'] }],
      ['a change that is not an object', null],
    ])('refuses %s', async (_, change) => {
      await refused(service.changePersonalCalendar(by(alice), alice.id, change), 'invalid')
      expect(await audit()).toEqual([])
    })

    it("lets a system admin read and change anyone's, and records the admin as the one who did", async () => {
      await service.changePersonalCalendar(by(root), alice.id, { addHolidays: ['2027-03-15'] })
      expect((await service.personalCalendarOf(by(root), alice.id)).holidays).toEqual([
        '2027-03-15',
      ])
      expect(await audit()).toMatchObject([{ actorAccountId: root.id, subjectId: alice.id }])
    })

    it('refuses anyone else, reading or changing, before looking at what they sent', async () => {
      const read = await refused(service.personalCalendarOf(by(bob), alice.id), 'forbidden')
      expect(read.message).toBe(
        "Only the person themselves and system admins can see a person's absences and calendar",
      )
      const change = await refused(
        service.changePersonalCalendar(by(bob), alice.id, 'junk'),
        'forbidden',
      )
      expect(change.message).toBe(
        "Only the person themselves and system admins can change a person's capacity, absences and calendar",
      )
      // An account that does not exist is refused the same way, so nothing tells it apart.
      await refused(service.personalCalendarOf(by(bob), randomUUID()), 'forbidden')
      await refused(service.personalCalendarOf(by(bob), 'not-a-uuid'), 'forbidden')
    })

    it('answers not found to a system admin for an account that does not exist', async () => {
      const error = await refused(service.personalCalendarOf(by(root), randomUUID()), 'not-found')
      expect(error.message).toBe('There is no such account')
      await refused(service.personalCalendarOf(by(root), 'not-a-uuid'), 'not-found')
      await refused(
        service.changePersonalCalendar(by(root), randomUUID(), { addHolidays: ['2027-03-01'] }),
        'not-found',
      )
      // A caller whose own account is gone cannot add holidays to it either.
      const gone = randomUUID()
      await refused(
        service.changePersonalCalendar(by({ id: gone }), gone, { addHolidays: ['2027-03-01'] }),
        'not-found',
      )
    })
  })

  describe("a person's capacity", () => {
    it('is 100% until set, and the person sets their own', async () => {
      expect(await service.capacityOf(by(alice), alice.id)).toEqual({
        accountId: alice.id,
        capacity: 100,
      })
      expect(await service.setCapacity(by(alice), alice.id, 80)).toEqual({
        accountId: alice.id,
        capacity: 80,
      })
      expect((await service.capacityOf(by(alice), alice.id)).capacity).toBe(80)
      expect(await audit()).toMatchObject([
        {
          actorAccountId: alice.id,
          action: 'account.capacity-set',
          subjectType: 'account',
          subjectId: alice.id,
          details: { capacity: 80, previous: 100 },
        },
      ])
    })

    it('takes 0 and 100, and records nothing when it does not change', async () => {
      expect((await service.setCapacity(by(alice), alice.id, 0)).capacity).toBe(0)
      expect((await service.setCapacity(by(alice), alice.id, 100)).capacity).toBe(100)
      await service.setCapacity(by(alice), alice.id, 100)
      expect(await audit()).toHaveLength(2)
    })

    it.each([-1, 101, 80.5, '80', null, Number.NaN])('refuses %j', async (capacity) => {
      const error = await refused(service.setCapacity(by(alice), alice.id, capacity), 'invalid')
      expect(error.message).toBe('A capacity is a whole percentage from 0 to 100')
      expect((await service.capacityOf(by(alice), alice.id)).capacity).toBe(100)
    })

    it("lets a system admin read and set anyone's; refuses everyone else", async () => {
      await service.setCapacity(by(root), alice.id, 60)
      expect((await service.capacityOf(by(root), alice.id)).capacity).toBe(60)
      const error = await refused(service.capacityOf(by(bob), alice.id), 'forbidden')
      expect(error.message).toBe(
        "Only the person themselves, system admins and people who can read a project the person can read can see a person's capacity",
      )
      await refused(service.setCapacity(by(bob), alice.id, 50), 'forbidden')
      expect((await service.capacityOf(by(alice), alice.id)).capacity).toBe(60)
      expect((await service.capacityOf(by(bob), bob.id)).capacity).toBe(100)
    })

    describe('read by the people of a project', () => {
      it.each(['read-only', 'contributor', 'read-write', 'admin'] as const)(
        'lets someone with a %s role read the capacity of everyone who can read the project',
        async (role) => {
          const project = await insertProject(x.db, root)
          await grantRole(x.db, alice, project, 'read-only')
          await grantRole(x.db, bob, project, role)
          await service.setCapacity(by(alice), alice.id, 80)
          expect(await service.capacityOf(by(bob), alice.id)).toEqual({
            accountId: alice.id,
            capacity: 80,
          })
          expect((await service.capacityOf(by(alice), bob.id)).capacity).toBe(100)
        },
      )

      it('refuses someone whose projects the person cannot read, and a stranger', async () => {
        await grantRole(x.db, alice, await insertProject(x.db, root), 'admin')
        await grantRole(x.db, bob, await insertProject(x.db, root), 'admin')
        const error = await refused(service.capacityOf(by(bob), alice.id), 'forbidden')
        expect(error.message).toContain('people who can read a project the person can read')
        await refused(service.capacityOf(by(alice), bob.id), 'forbidden')
        await refused(service.capacityOf(by({ id: randomUUID() }), alice.id), 'forbidden')
        await refused(service.capacityOf(by({ id: 'not-a-uuid' }), alice.id), 'forbidden')
      })

      it('stops when one of them loses their role in the shared project', async () => {
        const project = await insertProject(x.db, root)
        await grantRole(x.db, alice, project, 'read-only')
        await grantRole(x.db, bob, project, 'read-only')
        expect((await service.capacityOf(by(bob), alice.id)).capacity).toBe(100)
        await x.db
          .delete(projectMembers)
          .where(and(eq(projectMembers.projectId, project), eq(projectMembers.accountId, alice.id)))
        await refused(service.capacityOf(by(bob), alice.id), 'forbidden')
      })

      it('gives them neither the absences, nor the calendar, nor a change of the capacity', async () => {
        const project = await insertProject(x.db, root)
        await grantRole(x.db, alice, project, 'read-only')
        await grantRole(x.db, bob, project, 'admin')
        await refused(service.absencesOf(by(bob), alice.id), 'forbidden')
        await refused(service.personalCalendarOf(by(bob), alice.id), 'forbidden')
        await refused(service.setCapacity(by(bob), alice.id, 50), 'forbidden')
        expect((await service.capacityOf(by(alice), alice.id)).capacity).toBe(100)
      })
    })

    it('answers not found for an account that does not exist', async () => {
      const error = await refused(service.capacityOf(by(root), randomUUID()), 'not-found')
      expect(error.message).toBe('There is no such account')
      await refused(service.setCapacity(by(root), randomUUID(), 50), 'not-found')
    })

    it('is kept from 0 to 100 by the database too', async () => {
      await expect(
        x.db.update(accounts).set({ capacity: 101 }).where(eq(accounts.id, alice.id)),
      ).rejects.toMatchObject({ cause: { constraint: 'accounts_capacity_percentage' } })
    })
  })

  describe("a person's absences", () => {
    it('records an absence in whole days and lists them earliest first', async () => {
      const later = await service.recordAbsence(by(alice), alice.id, {
        from: '2027-08-02',
        to: '2027-08-13',
      })
      const sick = await service.recordAbsence(by(alice), alice.id, {
        from: '2027-03-08',
        to: '2027-03-08',
      })
      expect(sick).toEqual({
        id: expect.any(String),
        accountId: alice.id,
        from: '2027-03-08',
        to: '2027-03-08',
      })
      expect(await service.absencesOf(by(alice), alice.id)).toEqual([sick, later])
      expect(await audit()).toMatchObject([
        {
          action: 'absence.recorded',
          subjectType: 'absence',
          subjectId: later.id,
          details: { accountId: alice.id, from: '2027-08-02', to: '2027-08-13' },
        },
        { action: 'absence.recorded', subjectId: sick.id },
      ])
    })

    it.each([
      [
        'a last day before the first',
        { from: '2027-03-12', to: '2027-03-08' },
        'The last day of an absence cannot be before its first',
      ],
      [
        'a part of a day',
        { from: '2027-03-08T09:00', to: '2027-03-08T13:00' },
        'An absence is in whole days',
      ],
      ['hours', { from: '2027-03-08', to: '2027-03-08', hours: 4 }, 'cannot hold hours'],
      [
        'a half day',
        { from: '2027-03-08', to: '2027-03-08', halfDay: true },
        'cannot hold halfDay',
      ],
      ['no last day', { from: '2027-03-08' }, 'An absence is in whole days'],
      [
        'a date that does not exist',
        { from: '2027-02-29', to: '2027-03-01' },
        'An absence is in whole days',
      ],
      ['an absence that is not an object', '2027-03-08', 'is an object'],
    ])('refuses %s', async (_, absence, message) => {
      const error = await refused(service.recordAbsence(by(alice), alice.id, absence), 'invalid')
      expect(error.message).toContain(message)
      expect(await service.absencesOf(by(alice), alice.id)).toEqual([])
      expect(await audit()).toEqual([])
    })

    it('removes an absence of the person, and records it', async () => {
      const absence = await service.recordAbsence(by(alice), alice.id, {
        from: '2027-03-08',
        to: '2027-03-09',
      })
      await service.removeAbsence(by(alice), alice.id, absence.id)
      expect(await service.absencesOf(by(alice), alice.id)).toEqual([])
      expect((await audit()).map((e) => [e.action, e.details])).toEqual([
        ['absence.recorded', { accountId: alice.id, from: '2027-03-08', to: '2027-03-09' }],
        ['absence.removed', { accountId: alice.id, from: '2027-03-08', to: '2027-03-09' }],
      ])
    })

    it("answers not found to removing an absence that is not the person's, or none", async () => {
      const bobs = await service.recordAbsence(by(bob), bob.id, {
        from: '2027-03-08',
        to: '2027-03-09',
      })
      await refused(service.removeAbsence(by(alice), alice.id, bobs.id), 'not-found')
      await refused(service.removeAbsence(by(alice), alice.id, randomUUID()), 'not-found')
      await refused(service.removeAbsence(by(alice), alice.id, 'not-a-uuid'), 'not-found')
      expect(await service.absencesOf(by(bob), bob.id)).toEqual([bobs])
    })

    it("lets a system admin record, read and remove anyone's; refuses everyone else", async () => {
      const absence = await service.recordAbsence(by(root), alice.id, {
        from: '2027-03-08',
        to: '2027-03-08',
      })
      expect(await service.absencesOf(by(root), alice.id)).toEqual([absence])
      await refused(service.absencesOf(by(bob), alice.id), 'forbidden')
      await refused(
        service.recordAbsence(by(bob), alice.id, { from: '2027-03-08', to: '2027-03-08' }),
        'forbidden',
      )
      await refused(service.removeAbsence(by(bob), alice.id, absence.id), 'forbidden')
      await service.removeAbsence(by(root), alice.id, absence.id)
      expect(await x.db.select().from(absences).where(eq(absences.accountId, alice.id))).toEqual([])
    })

    it('answers not found for an account that does not exist', async () => {
      const error = await refused(service.absencesOf(by(root), randomUUID()), 'not-found')
      expect(error.message).toBe('There is no such account')
      await refused(
        service.recordAbsence(by(root), randomUUID(), { from: '2027-03-08', to: '2027-03-08' }),
        'not-found',
      )
    })

    it('is kept from ending before it starts by the database too', async () => {
      await expect(
        x.db
          .insert(absences)
          .values({ accountId: alice.id, startsOn: '2027-03-09', endsOn: '2027-03-08' }),
      ).rejects.toMatchObject({ cause: { constraint: 'absences_end_not_before_start' } })
    })
  })
})

// The test cases, each against a fresh test deployment, through the REST API.
describe('the test cases', () => {
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let root: Seeded
  let alice: Seeded
  let bob: Seeded

  beforeEach(async () => {
    x = await createTestDatabase()
    app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterEach(async () => {
    await app?.close()
    await x?.drop()
  })

  const request = (
    who: { id: string },
    method: 'GET' | 'PUT' | 'PATCH' | 'POST',
    url: string,
    payload?: Record<string, unknown> | unknown[],
  ) =>
    app.inject({
      method,
      url,
      headers: as(who, 'rest-api'),
      ...(payload === undefined ? {} : { payload }),
    })

  const globalOf = async (who: { id: string }) =>
    (await request(who, 'GET', '/api/calendar')).json()

  it('TC-049: a person records their own capacity', async () => {
    // A witness whose capacity is not the default, so that a change to it would show.
    await x.db.update(accounts).set({ capacity: 70 }).where(eq(accounts.id, bob.id))
    const change = await request(alice, 'PUT', `/api/accounts/${alice.id}/capacity`, {
      capacity: 80,
    })
    expect(change.statusCode).toBe(200)

    const read = await request(alice, 'GET', `/api/accounts/${alice.id}/capacity`)
    expect(read.statusCode).toBe(200)
    expect(read.json()).toEqual({ accountId: alice.id, capacity: 80 })

    // No other person's capacity changes.
    expect((await request(root, 'GET', `/api/accounts/${bob.id}/capacity`)).json().capacity).toBe(
      70,
    )
    expect((await request(root, 'GET', `/api/accounts/${root.id}/capacity`)).json().capacity).toBe(
      100,
    )
  })

  it('TC-050: a person records their own absence in whole days', async () => {
    const recorded = await request(alice, 'POST', `/api/accounts/${alice.id}/absences`, {
      from: '2027-03-08',
      to: '2027-03-12',
    })
    expect(recorded.statusCode).toBe(201)

    const read = await request(alice, 'GET', `/api/accounts/${alice.id}/absences`)
    expect(read.json()).toEqual([
      { id: recorded.json().id, accountId: alice.id, from: '2027-03-08', to: '2027-03-12' },
    ])

    // The tool offers no part-day unit: an absence in hours, half days or with times is refused.
    for (const partDay of [
      { from: '2027-03-15', to: '2027-03-15', hours: 4 },
      { from: '2027-03-15', to: '2027-03-15', halfDay: true },
      { from: '2027-03-15T09:00', to: '2027-03-15T13:00' },
    ]) {
      expect(
        (await request(alice, 'POST', `/api/accounts/${alice.id}/absences`, partDay)).statusCode,
      ).toBe(400)
    }
    const description = (await request(alice, 'GET', '/api/openapi.json')).json()
    const body =
      description.paths['/api/accounts/{accountId}/absences'].post.requestBody.content[
        'application/json'
      ].schema
    expect(Object.keys(body.properties)).toEqual(['from', 'to'])
    expect((await request(alice, 'GET', `/api/accounts/${alice.id}/absences`)).json()).toHaveLength(
      1,
    )

    // No other person's absences change.
    expect((await request(root, 'GET', `/api/accounts/${bob.id}/absences`)).json()).toEqual([])
    expect((await request(root, 'GET', `/api/accounts/${root.id}/absences`)).json()).toEqual([])
  })

  it('TC-051: a person enters many holidays in their own calendar', async () => {
    const holidays = daysFrom('2027-03-01', '2027-04-09').filter(isWorkingDay)
    expect(holidays).toHaveLength(30)
    const globalBefore = await globalOf(root)

    const change = await request(alice, 'PATCH', `/api/accounts/${alice.id}/calendar`, {
      addHolidays: holidays,
    })
    // No entry is refused for exceeding a limit.
    expect(change.statusCode).toBe(200)

    const own = await request(alice, 'GET', `/api/accounts/${alice.id}/calendar`)
    expect(own.json()).toEqual({ accountId: alice.id, holidays })
    const bobs = await request(bob, 'GET', `/api/accounts/${bob.id}/calendar`)
    expect(bobs.json()).toEqual({ accountId: bob.id, holidays: [] })
    expect(await globalOf(root)).toEqual(globalBefore)
  })

  it('TC-052: a person cannot set a weekend of their own', async () => {
    // Given: the global calendar's weekend is Saturday and Sunday.
    const given = await request(root, 'PATCH', '/api/calendar', {
      weekendDays: ['saturday', 'sunday'],
    })
    expect(given.statusCode).toBe(200)
    expect(given.json().weekendDays).toEqual(['saturday', 'sunday'])

    // Step 1, in the browser, is in e2e/tests/availability.spec.ts (SC-089). The REST
    // API offers no weekend setting for a person's own calendar either: the description lists
    // only holidays.
    const description = (await request(alice, 'GET', '/api/openapi.json')).json()
    const path = description.paths['/api/accounts/{accountId}/calendar']
    expect(
      Object.keys(path.get.responses['200'].content['application/json'].schema.properties),
    ).toEqual(['accountId', 'holidays'])
    expect(
      Object.keys(path.patch.requestBody.content['application/json'].schema.properties),
    ).toEqual(['addHolidays', 'removeHolidays'])

    // Step 2: making Friday a weekend day in alice's own calendar is rejected.
    const change = await request(alice, 'PATCH', `/api/accounts/${alice.id}/calendar`, {
      weekendDays: ['friday', 'saturday', 'sunday'],
    })
    expect(change.statusCode).toBe(400)
    expect(change.json().message).toBe(
      "A person's own calendar has no weekend of its own: the weekend is set in the global calendar",
    )

    // Step 3: alice's calendar marks no Friday as a weekend day; the global weekend is unchanged.
    const own = await request(alice, 'GET', `/api/accounts/${alice.id}/calendar`)
    expect(own.json()).toEqual({ accountId: alice.id, holidays: [] })
    expect((await globalOf(alice)).weekendDays).toEqual(['saturday', 'sunday'])
  })

  it('TC-053: one global calendar holds the company holidays and the weekend', async () => {
    const set = await request(root, 'PATCH', '/api/calendar', {
      weekendDays: ['saturday', 'sunday'],
      addHolidays: ['2027-03-03'],
    })
    expect(set.statusCode).toBe(200)

    const asAlice = await request(alice, 'GET', '/api/calendar')
    const asBob = await request(bob, 'GET', '/api/calendar')
    const expected = { weekendDays: ['saturday', 'sunday'], holidays: ['2027-03-03'] }
    expect(asAlice.statusCode).toBe(200)
    expect(asAlice.json()).toEqual(expected)
    expect(asBob.json()).toEqual(expected)
    // There is no second global calendar.
    expect(await x.db.select().from(globalCalendar)).toHaveLength(1)
  })

  it('TC-054: a system admin adds a company holiday', async () => {
    expect((await globalOf(root)).holidays).toEqual([])
    // A witness with a holiday of their own, so that a change to a person's calendar would show.
    await request(alice, 'PATCH', `/api/accounts/${alice.id}/calendar`, {
      addHolidays: ['2027-03-03'],
    })

    const add = await request(root, 'PATCH', '/api/calendar', { addHolidays: ['2027-03-03'] })
    expect(add.statusCode).toBe(200)
    expect((await globalOf(root)).holidays).toEqual(['2027-03-03'])

    const remove = await request(root, 'PATCH', '/api/calendar', { removeHolidays: ['2027-03-03'] })
    expect(remove.statusCode).toBe(200)
    expect((await globalOf(root)).holidays).toEqual([])

    // No person's own calendar changes.
    expect(await x.db.select().from(personalHolidays)).toEqual([
      { accountId: alice.id, date: '2027-03-03' },
    ])
  })

  it("TC-055: a non-admin's change to the company holidays is rejected", async () => {
    const created = await request(alice, 'POST', '/api/projects', { name: 'Apollo' })
    expect(created.statusCode).toBe(201)
    expect((await globalOf(root)).holidays).toEqual([])

    const change = await request(alice, 'PATCH', '/api/calendar', { addHolidays: ['2027-03-03'] })
    expect(change.statusCode).toBe(403)

    expect((await globalOf(root)).holidays).toEqual([])
    // No audit log entry records a change to the global calendar.
    const entries = await x.db.select().from(auditLog)
    expect(entries.filter((e) => e.subjectType === 'global-calendar')).toEqual([])
  })

  it('TC-194: the weekend days set in the global calendar drive scheduling', async () => {
    // Step 1: root sets the weekend to Friday and Saturday.
    const set = await request(root, 'PATCH', '/api/calendar', {
      weekendDays: ['friday', 'saturday'],
    })
    expect(set.statusCode).toBe(200)
    expect((await globalOf(alice)).weekendDays).toEqual(['friday', 'saturday'])

    // Step 2: alice creates A and B, B blocked by A, and reads them (SC-004).
    const apollo = (await request(alice, 'POST', '/api/projects', { name: 'Apollo' })).json().id
    const a = await request(alice, 'POST', `/api/projects/${apollo}/tasks`, {
      title: 'A',
      plannedStart: '2027-03-03',
      durationWorkingDays: 2,
    })
    const b = await request(alice, 'POST', `/api/projects/${apollo}/tasks`, {
      title: 'B',
      durationWorkingDays: 1,
    })
    const blocked = await request(alice, 'POST', `/api/tasks/${b.json().id}/blocked-by`, {
      blockerId: a.json().id,
    })
    expect([a.statusCode, b.statusCode, blocked.statusCode]).toEqual([201, 201, 200])
    const read = async (id: string) => (await request(alice, 'GET', `/api/tasks/${id}`)).json()
    expect(await read(a.json().id)).toMatchObject({
      plannedStart: '2027-03-03',
      plannedFinish: '2027-03-04',
    })
    // B is on Sunday 2027-03-07: no work falls on Friday 2027-03-05 or Saturday 2027-03-06.
    expect(await read(b.json().id)).toMatchObject({
      plannedStart: '2027-03-07',
      plannedFinish: '2027-03-07',
    })
  })

  it("TC-222: a system admin changes another person's capacity, absences and calendar", async () => {
    const capacity = await request(root, 'PUT', `/api/accounts/${alice.id}/capacity`, {
      capacity: 60,
    })
    const absence = await request(root, 'POST', `/api/accounts/${alice.id}/absences`, {
      from: '2027-03-08',
      to: '2027-03-08',
    })
    const calendar = await request(root, 'PATCH', `/api/accounts/${alice.id}/calendar`, {
      addHolidays: ['2027-03-15'],
    })
    expect([capacity.statusCode, absence.statusCode, calendar.statusCode]).toEqual([200, 201, 200])

    expect(
      (await request(alice, 'GET', `/api/accounts/${alice.id}/capacity`)).json().capacity,
    ).toBe(60)
    expect(
      (await request(alice, 'GET', `/api/accounts/${alice.id}/absences`)).json(),
    ).toMatchObject([{ from: '2027-03-08', to: '2027-03-08' }])
    expect(
      (await request(alice, 'GET', `/api/accounts/${alice.id}/calendar`)).json().holidays,
    ).toEqual(['2027-03-15'])

    // root's own capacity, absences and calendar are unchanged.
    expect((await request(root, 'GET', `/api/accounts/${root.id}/capacity`)).json().capacity).toBe(
      100,
    )
    expect((await request(root, 'GET', `/api/accounts/${root.id}/absences`)).json()).toEqual([])
    expect(
      (await request(root, 'GET', `/api/accounts/${root.id}/calendar`)).json().holidays,
    ).toEqual([])
  })
})
