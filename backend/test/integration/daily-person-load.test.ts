import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { tasks } from '../../src/db/schema.ts'
import type { Caller } from '../../src/service/caller.ts'
import {
  DailyPersonLoadService,
  type DayLoad,
  type PersonLoad,
} from '../../src/service/daily-person-load.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { TaskInput } from '../../src/service/tasks.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The daily person load aggregator (SC-006) against a real PostgreSQL: its rules through the
// service layer, then the test cases of FR-034, FR-035, FR-036, FR-046, FR-127 and FR-151 through
// the REST API.

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const by = (account: Seeded, channel: Caller['channel'] = 'ui'): Caller => ({
  accountId: account.id,
  channel,
})

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

const byDate = (load: PersonLoad) =>
  Object.fromEntries(load.days.map((day) => [day.date, day.load]))
const onDay = (load: PersonLoad, date: string): DayLoad => {
  const day = load.days.find((d) => d.date === date)
  if (!day) throw new Error(`no entry for ${date}`)
  return day
}

describe('the daily person load aggregator', () => {
  let x: TestDatabase
  let services: Services
  let alice: Seeded
  let bob: Seeded
  let carol: Seeded
  let dave: Seeded
  let root: Seeded
  let apollo: string
  let borealis: string

  beforeAll(async () => {
    x = await createTestDatabase()
    services = createServices(x.db, { today: () => '2027-01-01' })
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
    carol = await seedAccount(x.db, { username: 'carol' })
    dave = await seedAccount(x.db, { username: 'dave' })
    apollo = await seedProject(x.db, alice, 'Apollo')
    borealis = await seedProject(x.db, bob, 'Borealis')
    await grantRole(x.db, carol, apollo, 'read-only')
    await grantRole(x.db, carol, borealis, 'read-only')
    // Only someone who can read a project can be assigned to its tasks.
    await grantRole(x.db, bob, apollo, 'read-only')
  })

  afterAll(async () => {
    await x?.drop()
  })

  // Each test removes the tasks it made, so the next starts with none.
  afterEach(async () => {
    await x.db.execute('delete from task_assignees')
    await x.db.execute('delete from audit_log')
    await x.db.execute('delete from tasks')
    await x.db.execute('delete from absences')
    await x.db.execute('delete from personal_holidays')
    await x.db.execute('delete from company_holidays')
  })

  const create = (projectId: string, owner: Seeded, task: TaskInput) =>
    services.tasks.createTask(by(owner), projectId, { title: 'T', ...task })
  const loadOf = (viewer: Seeded, person: Seeded, from: string, to: string) =>
    services.dailyLoad.loadOf(by(viewer), person.id, { from, to })

  describe('which load counts', () => {
    it("applies the task's percentage, or the assignment's override, on each working day (FR-034)", async () => {
      await create(apollo, alice, {
        assignees: [alice.id, bob.id],
        loadOverrides: { [bob.id]: 30 },
        aiShare: 25,
        plannedStart: '2027-03-04',
        durationWorkingDays: 3,
      })
      // Thursday, Friday and the next Monday: the weekend in between carries nothing.
      const expected = {
        '2027-03-04': 75,
        '2027-03-05': 75,
        '2027-03-06': 0,
        '2027-03-07': 0,
        '2027-03-08': 75,
      }
      expect(byDate(await loadOf(alice, alice, '2027-03-04', '2027-03-08'))).toEqual(expected)
      expect(byDate(await loadOf(alice, bob, '2027-03-04', '2027-03-08'))).toEqual({
        '2027-03-04': 30,
        '2027-03-05': 30,
        '2027-03-06': 0,
        '2027-03-07': 0,
        '2027-03-08': 30,
      })
    })

    it('puts no load on a day off of an assignee inside the task, which does not move it', async () => {
      const task = await create(apollo, alice, {
        assignees: [alice.id, bob.id],
        plannedStart: '2027-03-01',
        durationWorkingDays: 3,
      })
      await services.calendars.changePersonalCalendar(by(bob), bob.id, {
        addHolidays: ['2027-03-02'],
      })
      const [row] = await x.db.select().from(tasks).where(eq(tasks.id, task.id))
      expect(row?.plannedFinish).toBe('2027-03-03')
      expect(byDate(await loadOf(alice, alice, '2027-03-01', '2027-03-03'))).toEqual({
        '2027-03-01': 100,
        '2027-03-02': 0,
        '2027-03-03': 100,
      })
    })

    it('puts no load on a company holiday inside the task', async () => {
      await create(apollo, alice, {
        assignees: [alice.id],
        plannedStart: '2027-03-01',
        durationWorkingDays: 3,
      })
      await x.db.execute(`insert into company_holidays (date) values ('2027-03-02')`)
      expect(byDate(await loadOf(alice, alice, '2027-03-01', '2027-03-04'))).toEqual({
        '2027-03-01': 100,
        '2027-03-02': 0,
        '2027-03-03': 100,
        '2027-03-04': 0,
      })
    })

    it('counts no unscheduled task and no milestone', async () => {
      await create(apollo, alice, { assignees: [alice.id] })
      await create(apollo, alice, { assignees: [alice.id], durationWorkingDays: 2 })
      await create(apollo, alice, { milestone: { variant: 'fixed-date', date: '2027-03-01' } })
      const load = await loadOf(alice, alice, '2027-03-01', '2027-03-01')
      expect(onDay(load, '2027-03-01')).toMatchObject({ load: 0, tasks: [], otherProjects: 0 })
    })

    it('counts no cancelled task, but still a done one (FR-127)', async () => {
      const cancelled = await create(apollo, alice, {
        title: 'Cancelled',
        assignees: [alice.id],
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      const done = await create(apollo, alice, {
        title: 'Done',
        assignees: [alice.id],
        aiShare: 50,
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      await services.taskCancellation.cancel(by(alice), cancelled.id)
      await x.db.update(tasks).set({ status: 'done' }).where(eq(tasks.id, done.id))
      const day = onDay(await loadOf(alice, alice, '2027-03-01', '2027-03-01'), '2027-03-01')
      expect(day.load).toBe(50)
      expect(day.tasks.map((t) => t.title)).toEqual(['Done'])
    })

    it("counts an AI-only task's own percentage (FR-149)", async () => {
      await create(apollo, alice, {
        assignees: [alice.id],
        aiShare: 100,
        personLoad: 12.5,
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      expect(byDate(await loadOf(alice, alice, '2027-03-01', '2027-03-01'))).toEqual({
        '2027-03-01': 12.5,
      })
    })
  })

  describe('what each viewer sees (FR-046, DD-014)', () => {
    beforeEach(async () => {
      await create(apollo, alice, {
        title: 'Visible task',
        assignees: [carol.id],
        aiShare: 60,
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      await create(borealis, bob, {
        title: 'Hidden task',
        assignees: [carol.id],
        aiShare: 40,
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
    })

    it('shows every task to someone who can read both projects', async () => {
      const day = onDay(await loadOf(carol, carol, '2027-03-01', '2027-03-01'), '2027-03-01')
      expect(day.load).toBe(100)
      expect(day.otherProjects).toBe(0)
      expect(day.tasks.map((t) => [t.title, t.load])).toEqual([
        ['Visible task', 40],
        ['Hidden task', 60],
      ])
    })

    it('shows the whole load, but no task, to someone who can read neither project', async () => {
      const day = onDay(await loadOf(dave, carol, '2027-03-01', '2027-03-01'), '2027-03-01')
      expect(day).toMatchObject({ load: 100, tasks: [], otherProjects: 100 })
    })

    it('shows the tasks of a project the viewer has just been given a role in', async () => {
      await grantRole(x.db, dave, borealis, 'read-only')
      const day = onDay(await loadOf(dave, carol, '2027-03-01', '2027-03-01'), '2027-03-01')
      expect(day).toMatchObject({ load: 100, otherProjects: 40 })
      expect(day.tasks.map((t) => t.title)).toEqual(['Hidden task'])
      await x.db.execute(`delete from project_members where account_id = '${dave.id}'`)
    })
  })

  describe("the person's capacity (FR-151)", () => {
    it('is 0 on each absence day and the capacity otherwise, for the person', async () => {
      await services.calendars.setCapacity(by(alice), alice.id, 80)
      await services.calendars.recordAbsence(by(alice), alice.id, {
        from: '2027-03-02',
        to: '2027-03-03',
      })
      const load = await loadOf(alice, alice, '2027-03-01', '2027-03-04')
      expect(load.days.map((d) => d.capacity)).toEqual([80, 0, 0, 80])
      await services.calendars.setCapacity(by(alice), alice.id, 100)
    })

    it('is given to system admins and people who share a readable project, not to others', async () => {
      await services.calendars.recordAbsence(by(carol), carol.id, {
        from: '2027-03-01',
        to: '2027-03-01',
      })
      expect(
        onDay(await loadOf(root, carol, '2027-03-01', '2027-03-01'), '2027-03-01').capacity,
      ).toBe(0)
      // Alice and Carol can both read Apollo.
      expect(
        onDay(await loadOf(alice, carol, '2027-03-01', '2027-03-02'), '2027-03-02').capacity,
      ).toBe(100)
      const other = await loadOf(dave, carol, '2027-03-01', '2027-03-02')
      expect(other.days.map((d) => d.capacity)).toEqual([null, null])
    })
  })

  describe('refusals', () => {
    it('refuses a caller without an account', async () => {
      const ghost = { accountId: '00000000-0000-4000-8000-0000000000ff', channel: 'ui' } as const
      const error = await refused(
        services.dailyLoad.loadOf(ghost, alice.id, { from: '2027-03-01', to: '2027-03-01' }),
        'forbidden',
      )
      expect(error.message).toBe("Only people with an account can see a person's load")
      await refused(
        services.dailyLoad.loadOf({ accountId: 'nobody', channel: 'ui' }, alice.id, {
          from: '2027-03-01',
          to: '2027-03-01',
        }),
        'forbidden',
      )
    })

    it('refuses a person who does not exist', async () => {
      const span = { from: '2027-03-01', to: '2027-03-01' }
      const error = await refused(services.dailyLoad.loadOf(by(alice), 'nobody', span), 'not-found')
      expect(error.message).toBe('There is no such account')
      await refused(
        services.dailyLoad.loadOf(by(alice), '00000000-0000-4000-8000-0000000000ff', span),
        'not-found',
      )
    })

    it('passes on a failure of the capacity check other than a refusal', async () => {
      const failing = new DailyPersonLoadService(x.db, services.viewFilter, {
        capacityOf: async () => {
          throw new Error('the calendar module failed')
        },
      })
      await expect(
        failing.loadOf(by(alice), alice.id, { from: '2027-03-01', to: '2027-03-01' }),
      ).rejects.toThrow('the calendar module failed')
    })

    it('refuses a span that is not one', async () => {
      const error = await refused(
        services.dailyLoad.loadOf(by(alice), alice.id, { from: '2027-03-01' }),
        'invalid',
      )
      expect(error.message).toMatch(/each a date/)
      await refused(
        services.dailyLoad.loadOf(by(alice), alice.id, { from: '2027-03-02', to: '2027-03-01' }),
        'invalid',
      )
    })
  })
})

describe('test cases through the REST API', () => {
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let alice: Seeded

  beforeEach(async () => {
    // A fresh test deployment for each test case: empty database and the first system admin root,
    // with the default global calendar of Saturday and Sunday as the weekend and no holidays.
    x = await createTestDatabase()
    app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    return async () => {
      await app.close()
      await x.drop()
    }
  })

  const api = async (account: Seeded, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: as(account, 'rest-api'), ...(payload && { payload }) })
  const createTask = async (owner: Seeded, projectId: string, task: object) => {
    const created = await api(owner, 'POST', `/api/projects/${projectId}/tasks`, task)
    expect(created.statusCode).toBe(201)
    return created.json<{ id: string }>().id
  }
  const readLoad = async (viewer: Seeded, person: Seeded, from: string, to: string) => {
    const response = await api(
      viewer,
      'GET',
      `/api/accounts/${person.id}/load?from=${from}&to=${to}`,
    )
    expect(response.statusCode).toBe(200)
    return response.json<PersonLoad>()
  }

  describe("TC-046: a task's load applies on every day of its duration", () => {
    it('puts 60% on alice on each day of T and nothing before or after', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      await createTask(alice, apollo, {
        title: 'T',
        assignees: [alice.id],
        aiShare: 40,
        plannedStart: '2027-03-01',
        durationWorkingDays: 5,
      })

      const load = await readLoad(alice, alice, '2027-02-26', '2027-03-08')

      for (const date of ['2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05']) {
        expect(onDay(load, date).load).toBe(60)
      }
      expect(onDay(load, '2027-02-26').load).toBe(0)
      expect(onDay(load, '2027-03-08').load).toBe(0)
      // Not spread or reduced across the duration: no day shows any other value.
      expect(load.days.every((day) => day.load === 0 || day.load === 60)).toBe(true)
    })
  })

  describe('TC-047: eligible people who are not assigned carry no load', () => {
    it('puts T on alice at 100% and nothing on bob', async () => {
      const bob = await seedAccount(x.db, { username: 'bob' })
      const apollo = await seedProject(x.db, alice, 'Apollo')
      await grantRole(x.db, bob, apollo, 'read-only')
      await createTask(alice, apollo, {
        title: 'T',
        eligibility: { any: [alice.id, bob.id] },
        assignees: [alice.id],
        aiShare: 0,
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })

      const aliceDay = onDay(await readLoad(alice, alice, '2027-03-01', '2027-03-01'), '2027-03-01')
      const bobDay = onDay(await readLoad(alice, bob, '2027-03-01', '2027-03-01'), '2027-03-01')

      expect(aliceDay.load).toBe(100)
      expect(bobDay.load).toBe(0)
      expect(bobDay.tasks).toEqual([])
    })
  })

  describe("TC-048: a person's daily load is summed across projects", () => {
    it('gives carol 80% on 2027-03-01 and 0% on 2027-03-02', async () => {
      const bob = await seedAccount(x.db, { username: 'bob' })
      const carol = await seedAccount(x.db, { username: 'carol' })
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const borealis = await seedProject(x.db, bob, 'Borealis')
      await grantRole(x.db, carol, apollo, 'read-only')
      await grantRole(x.db, carol, borealis, 'read-only')
      await createTask(alice, apollo, {
        title: 'T1',
        assignees: [carol.id],
        aiShare: 50,
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      await createTask(bob, borealis, {
        title: 'T2',
        assignees: [carol.id],
        aiShare: 70,
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })

      const load = await readLoad(carol, carol, '2027-03-01', '2027-03-02')

      expect(onDay(load, '2027-03-01').load).toBe(80)
      expect(onDay(load, '2027-03-02').load).toBe(0)
    })
  })

  describe('TC-063: load from projects the viewer cannot read shows only as a percentage', () => {
    it("shows alice carol's 100%, Visible task at 40% and other projects at 60%, nothing more", async () => {
      const bob = await seedAccount(x.db, { username: 'bob' })
      const carol = await seedAccount(x.db, { username: 'carol' })
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const borealis = await seedProject(x.db, bob, 'Borealis')
      await grantRole(x.db, carol, apollo, 'read-only')
      await grantRole(x.db, carol, borealis, 'read-only')
      const visible = await createTask(alice, apollo, {
        title: 'Visible task',
        assignees: [carol.id],
        aiShare: 60,
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      const hidden = await createTask(bob, borealis, {
        title: 'Hidden task',
        assignees: [carol.id],
        aiShare: 40,
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })

      const response = await api(
        alice,
        'GET',
        `/api/accounts/${carol.id}/load?from=2027-03-01&to=2027-03-01`,
      )

      expect(response.statusCode).toBe(200)
      const day = onDay(response.json<PersonLoad>(), '2027-03-01')
      expect(day.load).toBe(100)
      expect(day.tasks).toEqual([
        { taskId: visible, projectId: apollo, title: 'Visible task', load: 40 },
      ])
      expect(day.otherProjects).toBe(60)
      // Nothing of Hidden task or Borealis reaches alice.
      expect(response.body).not.toContain('Hidden task')
      expect(response.body).not.toContain('Borealis')
      expect(response.body).not.toContain(hidden)
      expect(response.body).not.toContain(borealis)
    })
  })

  describe('TC-189: cancelling a task frees its load', () => {
    it("drops alice's load on 2027-03-01 from 100% to 0% and keeps T, cancelled and assigned", async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const t = await createTask(alice, apollo, {
        title: 'T',
        assignees: [alice.id],
        aiShare: 0,
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      expect(
        onDay(await readLoad(alice, alice, '2027-03-01', '2027-03-01'), '2027-03-01').load,
      ).toBe(100)

      expect((await api(alice, 'POST', `/api/tasks/${t}/cancel`)).statusCode).toBe(200)

      expect(
        onDay(await readLoad(alice, alice, '2027-03-01', '2027-03-01'), '2027-03-01').load,
      ).toBe(0)
      const read = await api(alice, 'GET', `/api/tasks/${t}`)
      expect(read.json()).toMatchObject({ id: t, status: 'cancelled', assignees: [alice.id] })
    })
  })

  describe("TC-223: a person's capacity is 0 on their absence days", () => {
    it('gives alice 0% capacity on 2027-03-02, with T still loading 10% that day', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const absence = await api(alice, 'POST', `/api/accounts/${alice.id}/absences`, {
        from: '2027-03-02',
        to: '2027-03-02',
      })
      expect(absence.statusCode).toBe(201)
      await createTask(alice, apollo, {
        title: 'T',
        assignees: [alice.id],
        aiShare: 100,
        personLoad: 10,
        plannedStart: '2027-03-01',
        durationWorkingDays: 3,
      })

      const load = await readLoad(alice, alice, '2027-03-01', '2027-03-03')

      expect(load.days.map((d) => [d.date, d.capacity, d.load])).toEqual([
        ['2027-03-01', 100, 10],
        ['2027-03-02', 0, 10],
        ['2027-03-03', 100, 10],
      ])
      // alice is marked overloaded on 2027-03-02, her load above her capacity, and on no other day
      // (FR-042, SC-040).
      expect(load.days.map((d) => d.overloaded)).toEqual([false, true, false])
    })
  })
})
