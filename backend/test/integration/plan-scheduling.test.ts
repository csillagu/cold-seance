import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { auditLog, companyHolidays, personalHolidays, tasks } from '../../src/db/schema.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { Task, TaskInput } from '../../src/service/tasks.ts'
import { seedAccount } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The scheduler (SC-004) in the service layer against a real PostgreSQL: which changes schedule
// what, what the audit log records of it, the refusal of forbidden dates (FR-011), and that
// scheduling stays within one project (FR-018). The test cases are in scheduling.test.ts.

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const by = (account: Seeded): Caller => ({ accountId: account.id, channel: 'rest-api' })

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

describe('scheduling in the service layer', () => {
  let x: TestDatabase
  let services: Services
  let alice: Seeded
  let bob: Seeded
  let apollo: string
  let borealis: string

  beforeAll(async () => {
    x = await createTestDatabase()
    services = createServices(x.db)
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  beforeEach(async () => {
    // A fresh pair of projects each time; the calendars are cleared.
    apollo = await seedProject(x.db, alice)
    borealis = await seedProject(x.db, bob)
    await grantRole(x.db, bob, apollo, 'read-write')
    await grantRole(x.db, alice, borealis, 'read-only')
    await x.db.delete(companyHolidays)
    await x.db.delete(personalHolidays)
  })

  afterAll(async () => {
    await x?.drop()
  })

  const create = (fields: TaskInput, project = apollo, who = alice) =>
    services.tasks.createTask(by(who), project, fields)
  const update = (task: { id: string }, fields: TaskInput, who = alice) =>
    services.tasks.updateTask(by(who), task.id, fields)
  const get = (task: { id: string }) => services.tasks.getTask(by(alice), task.id)
  const span = async (task: { id: string }) => {
    const read = await get(task)
    return [read.plannedStart, read.plannedFinish]
  }
  const block = (task: { id: string }, blocker: { id: string }, who = alice) =>
    services.taskRelations.addBlocker(by(who), task.id, blocker.id)
  const actions = async (task: { id: string }) =>
    (
      await x.db.select().from(auditLog).where(eq(auditLog.subjectId, task.id)).orderBy(auditLog.id)
    ).map((entry) => entry.action)
  const holiday = (date: string) => x.db.insert(companyHolidays).values({ date })
  const dayOff = (who: Seeded, date: string) =>
    x.db.insert(personalHolidays).values({ accountId: who.id, date })
  const day = (title: string, plannedStart: string, durationWorkingDays = 1) =>
    create({ title, plannedStart, durationWorkingDays })

  describe('a task created or edited', () => {
    it('records the finish the scheduler derived with its creation', async () => {
      const t = await day('T', '2027-03-01', 3)
      const [entry] = await x.db.select().from(auditLog).where(eq(auditLog.subjectId, t.id))
      expect(entry?.details).toMatchObject({
        plannedStart: '2027-03-01',
        plannedFinish: '2027-03-03',
      })
    })

    it('takes no finish of its own once it has a start and a duration', async () => {
      const t = await create({
        title: 'T',
        plannedStart: '2027-03-01',
        plannedFinish: '2027-03-31',
        durationWorkingDays: 2,
      })
      expect(t.plannedFinish).toBe('2027-03-02')
      expect((await update(t, { plannedFinish: '2027-03-31' })).plannedFinish).toBe('2027-03-02')
      expect(await actions(t)).toEqual(['task.created'])
    })

    it('keeps the finish of a task with no duration as given', async () => {
      const t = await create({
        title: 'T',
        plannedStart: '2027-03-01',
        plannedFinish: '2027-03-12',
      })
      expect([t.plannedStart, t.plannedFinish]).toEqual(['2027-03-01', '2027-03-12'])
    })

    it('records the new finish with the edit that moved the start, in one entry', async () => {
      const t = await day('T', '2027-03-01', 2)
      await update(t, { plannedStart: '2027-03-04' })
      const [, updated] = await x.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.subjectId, t.id))
        .orderBy(auditLog.id)
      expect(updated).toMatchObject({
        action: 'task.updated',
        details: {
          changes: { plannedStart: '2027-03-04', plannedFinish: '2027-03-05' },
          previous: { plannedStart: '2027-03-01', plannedFinish: '2027-03-02' },
        },
      })
    })

    it('moves nothing when an edit changes no date, even if the calendars changed (FR-148)', async () => {
      const t = await create({
        title: 'T',
        plannedStart: '2027-03-01',
        durationWorkingDays: 3,
        assignees: [alice.id],
      })
      await dayOff(alice, '2027-03-02')
      await holiday('2027-03-03')
      await update(t, { title: 'Renamed', effort: 2, assignees: [alice.id, bob.id] })
      expect(await span(t)).toEqual(['2027-03-01', '2027-03-03'])
    })

    it('skips every day off of each person assigned', async () => {
      await dayOff(alice, '2027-03-02')
      await dayOff(alice, '2027-03-03')
      await dayOff(bob, '2027-03-04')
      const t = await create({
        title: 'T',
        plannedStart: '2027-03-01',
        durationWorkingDays: 2,
        assignees: [alice.id, bob.id],
      })
      expect(await span(t)).toEqual(['2027-03-01', '2027-03-05'])
    })

    it('schedules a moved task by the calendars of its assigned people as they are then', async () => {
      const t = await create({
        title: 'T',
        plannedStart: '2027-03-01',
        durationWorkingDays: 3,
        assignees: [alice.id],
      })
      await dayOff(alice, '2027-03-09')
      await update(t, { plannedStart: '2027-03-08' })
      expect(await span(t)).toEqual(['2027-03-08', '2027-03-11'])
    })

    it('records the tasks it moved, each in an entry of its own naming the cause', async () => {
      const a = await day('A', '2027-03-01')
      const b = await create({ title: 'B', durationWorkingDays: 1 })
      await block(b, a)
      await update(a, { plannedStart: '2027-03-02' })
      const [entry] = await x.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.subjectId, b.id), eq(auditLog.action, 'task.rescheduled')))
        .orderBy(auditLog.id)
        .offset(1)
      expect(entry).toMatchObject({
        actorAccountId: alice.id,
        channels: ['rest-api'],
        projectId: apollo,
        details: {
          changes: { plannedStart: '2027-03-03', plannedFinish: '2027-03-03', floatingDate: null },
          previous: { plannedStart: '2027-03-02', plannedFinish: '2027-03-02', floatingDate: null },
          cause: { action: 'task.updated', taskId: a.id },
        },
      })
    })

    it('records nothing when the scheduler sets back the start an edit gave a blocked task', async () => {
      const a = await day('A', '2027-03-01')
      const b = await create({ title: 'B', durationWorkingDays: 1 })
      await block(b, a)
      const before = await actions(b)
      const after = await update(b, { plannedStart: '2027-03-10' })
      expect([after.plannedStart, after.plannedFinish]).toEqual(['2027-03-02', '2027-03-02'])
      expect(await actions(b)).toEqual(before)
    })

    it('refuses a change that would schedule a task past 9999-12-31, storing nothing', async () => {
      const t = await day('T', '9999-12-01')
      const error = await refused(update(t, { durationWorkingDays: 1000 }), 'invalid')
      expect(error.message).toMatch(/past 9999-12-31/)
      const [row] = await x.db.select().from(tasks).where(eq(tasks.id, t.id))
      expect(row?.durationWorkingDays).toBe(1)
    })

    it('refuses a move that pushes a blocked task past 9999-12-31', async () => {
      const a = await day('A', '9999-12-01')
      const b = await create({ title: 'B', durationWorkingDays: 1 })
      await block(b, a)
      // Friday 9999-12-31 is the last date: B could only start after it.
      const error = await refused(update(a, { plannedStart: '9999-12-31' }), 'invalid')
      expect(error.message).toMatch(/"B" past 9999-12-31/)
      expect(await span(a)).toEqual(['9999-12-01', '9999-12-01'])
    })
  })

  describe('forbidden dates (FR-011)', () => {
    it('refuses a new task whose start is one of its forbidden dates', async () => {
      await dayOff(alice, '2027-03-02')
      await refused(day('Weekend', '2027-03-06'), 'invalid')
      const error = await refused(
        create({ title: 'Off', plannedStart: '2027-03-02', assignees: [alice.id] }),
        'invalid',
      )
      expect(error.message).toBe(
        "The task's planned start cannot be 2027-03-02: that is a non-working day for the task, " +
          'a weekend day, a company holiday or a day off of someone assigned to it',
      )
      // Unassigned, alice's day off is not the task's.
      expect((await create({ title: 'Free', plannedStart: '2027-03-02' })).plannedStart).toBe(
        '2027-03-02',
      )
    })

    it('refuses a given finish on a forbidden date, of a task with no duration', async () => {
      await holiday('2027-03-05')
      await refused(
        create({ title: 'T', plannedStart: '2027-03-01', plannedFinish: '2027-03-05' }),
        'invalid',
      )
      const t = await create({
        title: 'T',
        plannedStart: '2027-03-01',
        plannedFinish: '2027-03-04',
      })
      const error = await refused(update(t, { plannedFinish: '2027-03-05' }), 'invalid')
      expect(error.message).toMatch(/planned finish cannot be 2027-03-05/)
      expect(await span(t)).toEqual(['2027-03-01', '2027-03-04'])
    })

    it('refuses a given finish on a forbidden date, of a task with a duration and no start', async () => {
      const error = await refused(
        create({ title: 'T', durationWorkingDays: 3, plannedFinish: '2027-03-06' }),
        'invalid',
      )
      expect(error.message).toMatch(/planned finish cannot be 2027-03-06/)
    })

    it("refuses a fixed-date milestone's date on a weekend or a company holiday", async () => {
      await holiday('2027-03-10')
      await refused(
        create({ title: 'M', milestone: { variant: 'fixed-date', date: '2027-03-06' } }),
        'invalid',
      )
      const m = await create({
        title: 'M',
        milestone: { variant: 'fixed-date', date: '2027-03-12' },
      })
      const error = await refused(
        update(m, { milestone: { variant: 'fixed-date', date: '2027-03-10' } }),
        'invalid',
      )
      expect(error.message).toMatch(/milestone date cannot be 2027-03-10/)
      expect((await get(m)).milestone).toEqual({ variant: 'fixed-date', date: '2027-03-12' })
    })

    it('refuses a move onto the day off of someone assigned in the same change', async () => {
      await dayOff(bob, '2027-03-03')
      const t = await day('T', '2027-03-01')
      await refused(update(t, { plannedStart: '2027-03-03', assignees: [bob.id] }), 'invalid')
      expect((await get(t)).assignees).toEqual([])
    })

    it('does not check dates an edit does not change, so a new assignee off that day is taken', async () => {
      await dayOff(bob, '2027-03-01')
      const t = await day('T', '2027-03-01')
      const updated = await update(t, { assignees: [bob.id], title: 'Renamed' })
      expect(updated).toMatchObject({ plannedStart: '2027-03-01', assignees: [bob.id] })
    })
  })

  describe('a change of relations', () => {
    it('schedules a task again when it loses a blocker', async () => {
      const a1 = await day('A1', '2027-03-01')
      const a2 = await day('A2', '2027-03-03')
      const b = await create({ title: 'B', durationWorkingDays: 1 })
      await block(b, a1)
      await block(b, a2)
      expect(await span(b)).toEqual(['2027-03-04', '2027-03-04'])
      await services.taskRelations.removeBlocker(by(alice), b.id, a2.id)
      expect(await span(b)).toEqual(['2027-03-02', '2027-03-02'])
      expect(await actions(b)).toContain('task.rescheduled')
    })

    it('makes the old parent and the new parent span the subtasks they then have', async () => {
      const p = await create({ title: 'P' })
      const q = await create({ title: 'Q' })
      const c1 = await day('C1', '2027-03-01')
      const c2 = await day('C2', '2027-03-10')
      await services.taskRelations.setParent(by(alice), c1.id, p.id)
      await services.taskRelations.setParent(by(alice), c2.id, p.id)
      expect(await span(p)).toEqual(['2027-03-01', '2027-03-10'])
      await services.taskRelations.setParent(by(alice), c2.id, q.id)
      expect(await span(p)).toEqual(['2027-03-01', '2027-03-01'])
      expect(await span(q)).toEqual(['2027-03-10', '2027-03-10'])
      // A task with no parent and no subtask moves nothing.
      await services.taskRelations.setParent(by(alice), c2.id, null)
      expect(await span(q)).toEqual(['2027-03-10', '2027-03-10'])
    })

    it('schedules the tasks a cancelled task blocked from the blockers passed on to them', async () => {
      const a = await day('A', '2027-03-01')
      const b = await create({ title: 'B', durationWorkingDays: 2 })
      const c = await create({ title: 'C', durationWorkingDays: 1 })
      await block(b, a)
      await block(c, b)
      expect(await span(c)).toEqual(['2027-03-04', '2027-03-04'])
      await services.taskCancellation.cancel(by(alice), b.id)
      expect(await span(c)).toEqual(['2027-03-02', '2027-03-02'])
    })

    it("never moves a task for another project's milestone it is blocked by (FR-018)", async () => {
      const m = await create(
        { title: 'M', milestone: { variant: 'fixed-date', date: '2027-03-10' } },
        borealis,
        bob,
      )
      const t = await day('T', '2027-03-01', 2)
      await block(t, m)
      expect(await span(t)).toEqual(['2027-03-01', '2027-03-02'])
      const logged = await x.db.select().from(auditLog).where(eq(auditLog.projectId, apollo))
      await update(m, { milestone: { variant: 'fixed-date', date: '2027-03-17' } }, bob)
      expect(await span(t)).toEqual(['2027-03-01', '2027-03-02'])
      expect(await x.db.select().from(auditLog).where(eq(auditLog.projectId, apollo))).toEqual(
        logged,
      )
    })
  })

  describe('a floating milestone (FR-195)', () => {
    it('follows its blockers, and is read with its date', async () => {
      const a = await day('A', '2027-03-01', 2)
      const m = await create({ title: 'M', milestone: { variant: 'floating' } })
      const after = await create({ title: 'After', durationWorkingDays: 1 })
      await block(m, a)
      await block(after, m)
      expect((await get(m)).milestone).toEqual({ variant: 'floating', date: '2027-03-02' })
      expect(await span(after)).toEqual(['2027-03-03', '2027-03-03'])

      await update(a, { durationWorkingDays: 4 })
      expect((await get(m)).milestone).toEqual({ variant: 'floating', date: '2027-03-04' })
      expect(await span(after)).toEqual(['2027-03-05', '2027-03-05'])
      const listed = await services.tasks.listTasks(by(alice), apollo)
      expect(listed.find((task: Task) => task.id === m.id)?.milestone?.date).toBe('2027-03-04')
    })
  })

  it('runs date changes and status changes of related tasks at once without a deadlock', async () => {
    const p = await create({ title: 'P' })
    const c = await day('C', '2027-03-01')
    await services.taskRelations.setParent(by(alice), c.id, p.id)
    const u = await day('U', '2027-03-01')
    const t = await create({ title: 'T', durationWorkingDays: 1 })
    await block(t, u)
    for (const start of ['2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05', '2027-03-08']) {
      const results = await Promise.allSettled([
        update(c, { plannedStart: start }),
        // Refused, for C is open and U is not done, after the checks lock their rows.
        services.taskStatus.setStatus(by(alice), p.id, 'done'),
        update(u, { plannedStart: start }),
        services.taskStatus.setStatus(by(alice), t.id, 'in-progress'),
      ])
      const failures = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []))
      // Only the two refusals of the service; no deadlock or other database error.
      expect(failures).toHaveLength(2)
      for (const failure of failures) expect(failure).toBeInstanceOf(ServiceError)
    }
    expect(await span(p)).toEqual(['2027-03-08', '2027-03-08'])
    expect(await span(t)).toEqual(['2027-03-09', '2027-03-09'])
  })

  it('schedules concurrent changes of one plan one after the other, without a deadlock', async () => {
    const a = await day('A', '2027-03-01')
    const p = await create({ title: 'P' })
    const b = await create({ title: 'B', durationWorkingDays: 1 })
    const c = await create({ title: 'C', durationWorkingDays: 1 })
    const d = await create({ title: 'D', durationWorkingDays: 1 })
    await block(b, a)
    await block(c, b)
    await block(d, c)
    await Promise.all([
      update(a, { plannedStart: '2027-03-08' }),
      update(c, { durationWorkingDays: 2 }),
      services.taskRelations.setParent(by(alice), d.id, p.id),
      services.taskCancellation.cancel(by(alice), b.id),
      update(a, { title: 'A2' }),
    ])
    // Whatever order they ran in, the plan is consistent: C follows A, D follows C, P spans D.
    expect(await span(a)).toEqual(['2027-03-08', '2027-03-08'])
    expect(await span(c)).toEqual(['2027-03-09', '2027-03-10'])
    expect(await span(d)).toEqual(['2027-03-11', '2027-03-11'])
    expect(await span(p)).toEqual(['2027-03-11', '2027-03-11'])
  })
})
