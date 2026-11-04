import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { auditLog, taskAssignees, tasks } from '../../src/db/schema.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { assignmentLoad } from '../../src/service/person-load.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { Task, TaskInput } from '../../src/service/tasks.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The person-load percentage rules (SC-039) against a real PostgreSQL: through the task service,
// then the test cases of FR-032, FR-033 and FR-149 through the REST API.

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

describe('the person-load percentage rules', () => {
  let x: TestDatabase
  let services: Services
  let alice: Seeded
  let bob: Seeded
  let reader: Seeded
  let outsider: Seeded
  let project: string

  beforeAll(async () => {
    x = await createTestDatabase()
    services = createServices(x.db)
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
    reader = await seedAccount(x.db, { username: 'reader' })
    outsider = await seedAccount(x.db, { username: 'outsider' })
    project = await seedProject(x.db, alice, 'Apollo')
    await grantRole(x.db, bob, project, 'read-write')
    await grantRole(x.db, reader, project, 'read-only')
  })

  afterAll(async () => {
    await x?.drop()
  })

  const create = (task: Omit<TaskInput, 'title'>, caller: Caller = by(alice)) =>
    services.tasks.createTask(caller, project, { title: 'T', ...task })
  const update = (id: string, changes: TaskInput, caller: Caller = by(alice)) =>
    services.tasks.updateTask(caller, id, changes)
  const read = (id: string) => services.tasks.getTask(by(reader), id)
  const stored = async (id: string) => {
    const [row] = await x.db.select().from(tasks).where(eq(tasks.id, id))
    const people = await x.db
      .select()
      .from(taskAssignees)
      .where(eq(taskAssignees.taskId, id))
      .orderBy(taskAssignees.position)
    return {
      aiOnlyLoad: row?.aiOnlyLoad,
      overrides: people.map((p) => [p.accountId, p.loadOverride]),
    }
  }
  const entries = (id: string) =>
    x.db.select().from(auditLog).where(eq(auditLog.subjectId, id)).orderBy(auditLog.id)

  describe("a task's default person load (FR-032, DD-009)", () => {
    it('is 100% minus the AI share, and 100% with none given', async () => {
      const cases: [number | null, number][] = [
        [null, 100],
        [0, 100],
        [25, 75],
        [50, 50],
        [100, 0],
      ]
      for (const [aiShare, personLoad] of cases) {
        const task = await create({ aiShare, durationWorkingDays: 4 })
        expect(task.personLoad).toBe(personLoad)
        expect((await read(task.id)).personLoad).toBe(personLoad)
        // AI work lowers the percentage, not the duration.
        expect(task.durationWorkingDays).toBe(4)
      }
    })

    it('follows the AI share when it changes', async () => {
      const task = await create({ aiShare: 0 })
      expect((await update(task.id, { aiShare: 40 })).personLoad).toBe(60)
      expect((await update(task.id, { aiShare: null })).personLoad).toBe(100)
    })

    it('is null for a milestone, which takes no time', async () => {
      const task = await create({ milestone: { variant: 'floating' } })
      expect(task.personLoad).toBeNull()
      expect(task.loadOverrides).toEqual({})
    })

    it('cannot be set on a task that is not AI-only', async () => {
      const task = await create({ aiShare: 50 })
      const error = await refused(update(task.id, { personLoad: 30 }), 'invalid')
      expect(error.message).toMatch(/only for an AI-only task/)
      await refused(create({ personLoad: 30 }), 'invalid')
      await refused(create({ aiShare: 99, personLoad: 30 }), 'invalid')
      await refused(create({ milestone: { variant: 'floating' }, personLoad: 1 }), 'invalid')
      expect((await read(task.id)).personLoad).toBe(50)
      // Null is no value, so it is taken for any task.
      expect((await update(task.id, { personLoad: null })).personLoad).toBe(50)
    })
  })

  describe("an AI-only task's person load (FR-149)", () => {
    it('takes any percentage of zero or more, unrounded, and stores it', async () => {
      const task = await create({ aiShare: 100, personLoad: 1 })
      expect(task.personLoad).toBe(1)
      for (const personLoad of [0, 0.5, 150, 0.0001, 1000]) {
        expect((await update(task.id, { personLoad })).personLoad).toBe(personLoad)
        expect((await read(task.id)).personLoad).toBe(personLoad)
        expect((await stored(task.id)).aiOnlyLoad).toBe(personLoad)
      }
    })

    it('can be given with the AI share that makes the task AI-only, in one change', async () => {
      const task = await create({ aiShare: 20 })
      const changed = await update(task.id, { aiShare: 100, personLoad: 2.5 })
      expect(changed).toMatchObject({ aiShare: 100, personLoad: 2.5 })
    })

    it('goes back to the default, 0%, when given null', async () => {
      const task = await create({ aiShare: 100, personLoad: 3 })
      expect((await update(task.id, { personLoad: null })).personLoad).toBe(0)
      expect((await stored(task.id)).aiOnlyLoad).toBeNull()
    })

    it('is kept when other fields change, and dropped when the task stops being AI-only', async () => {
      const task = await create({ aiShare: 100, personLoad: 7 })
      expect((await update(task.id, { title: 'Renamed' })).personLoad).toBe(7)
      expect((await update(task.id, { aiShare: 100 })).personLoad).toBe(7)
      const halved = await update(task.id, { aiShare: 50 })
      expect(halved.personLoad).toBe(50)
      expect((await stored(task.id)).aiOnlyLoad).toBeNull()
      // Made AI-only again, it has the default until it is given one.
      expect((await update(task.id, { aiShare: 100 })).personLoad).toBe(0)
    })

    it('refuses a negative or non-numeric percentage, and changes nothing', async () => {
      const task = await create({ aiShare: 100, personLoad: 4 })
      for (const personLoad of [-1, '5', true, {}]) {
        await refused(update(task.id, { personLoad }), 'invalid')
      }
      expect((await read(task.id)).personLoad).toBe(4)
    })

    it('is held by the table to AI-only tasks and to zero or more', async () => {
      const task = await create({ aiShare: 50 })
      await expect(
        x.db.update(tasks).set({ aiOnlyLoad: 1 }).where(eq(tasks.id, task.id)),
      ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'tasks_ai_only_load' } })
      await expect(
        x.db.update(tasks).set({ aiShare: 100, aiOnlyLoad: -1 }).where(eq(tasks.id, task.id)),
      ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'tasks_ai_only_load' } })
    })
  })

  describe("an assignment's override (FR-033, DD-010)", () => {
    it("replaces the task's percentage for that person only", async () => {
      const task = await create({ aiShare: 0, assignees: [alice.id, bob.id] })
      const changed = await update(task.id, { loadOverrides: { [alice.id]: 30 } })
      expect(changed.loadOverrides).toEqual({ [alice.id]: 30 })
      expect(changed.personLoad).toBe(100)
      expect(assignmentLoad(changed, alice.id)).toBe(30)
      expect(assignmentLoad(changed, bob.id)).toBe(100)
      expect((await read(task.id)).loadOverrides).toEqual({ [alice.id]: 30 })
      expect((await stored(task.id)).overrides).toEqual([
        [alice.id, 30],
        [bob.id, null],
      ])
    })

    it('can be given with the assignees, on creation, and for an AI-only task', async () => {
      const task = await create({
        aiShare: 100,
        personLoad: 1,
        assignees: [bob.id, alice.id],
        loadOverrides: { [bob.id]: 0.5, [alice.id]: 0 },
      })
      // Read back in the order of the ids, whatever order they were given in.
      const ordered = Object.fromEntries(
        [
          [alice.id, 0],
          [bob.id, 0.5],
        ].sort(([a], [b]) => String(a).localeCompare(String(b))),
      )
      expect(Object.entries(task.loadOverrides)).toEqual(Object.entries(ordered))
      expect(Object.entries((await read(task.id)).loadOverrides)).toEqual(Object.entries(ordered))
      expect(assignmentLoad(task, alice.id)).toBe(0)
      expect(assignmentLoad(task, bob.id)).toBe(0.5)
    })

    it('keeps the assignees in their order when only the overrides change', async () => {
      const task = await create({ assignees: [bob.id, alice.id] })
      const changed = await update(task.id, { loadOverrides: { [alice.id]: 20 } })
      expect(changed.assignees).toEqual([bob.id, alice.id])
      expect((await read(task.id)).assignees).toEqual([bob.id, alice.id])
    })

    it('is replaced as a whole, and removed with an empty object', async () => {
      const task = await create({
        assignees: [alice.id, bob.id],
        loadOverrides: { [alice.id]: 30, [bob.id]: 40 },
      })
      const replaced = await update(task.id, { loadOverrides: { [bob.id]: 45 } })
      expect(replaced.loadOverrides).toEqual({ [bob.id]: 45 })
      const removed = await update(task.id, { loadOverrides: {} })
      expect(removed.loadOverrides).toEqual({})
      expect(assignmentLoad(removed, bob.id)).toBe(100)
    })

    it('stays with people who stay assigned, and goes with those who do not', async () => {
      const task = await create({
        assignees: [alice.id, bob.id],
        loadOverrides: { [alice.id]: 30, [bob.id]: 40 },
      })
      const changed = await update(task.id, { assignees: [bob.id] })
      expect(changed.loadOverrides).toEqual({ [bob.id]: 40 })
      // Assigned again, alice has the task's percentage until she is given one.
      const back = await update(task.id, { assignees: [bob.id, alice.id] })
      expect(back.loadOverrides).toEqual({ [bob.id]: 40 })
      expect(assignmentLoad(back, alice.id)).toBe(100)
    })

    it("follows neither the task's AI share nor its own percentage", async () => {
      const task = await create({
        aiShare: 0,
        assignees: [alice.id],
        loadOverrides: { [alice.id]: 30 },
      })
      const changed = await update(task.id, { aiShare: 50 })
      expect(changed.personLoad).toBe(50)
      expect(assignmentLoad(changed, alice.id)).toBe(30)
    })

    it('refuses an override for someone not assigned, and changes nothing', async () => {
      const task = await create({ assignees: [alice.id] })
      const error = await refused(update(task.id, { loadOverrides: { [bob.id]: 30 } }), 'invalid')
      expect(error.message).toMatch(/not assigned to the task/)
      // Nor for someone the same change unassigns.
      await refused(
        update(task.id, { assignees: [bob.id], loadOverrides: { [alice.id]: 30 } }),
        'invalid',
      )
      // A milestone has nobody assigned, so nobody's load to override.
      await refused(
        create({ milestone: { variant: 'floating' }, loadOverrides: { [alice.id]: 1 } }),
        'invalid',
      )
      expect(await read(task.id)).toMatchObject({ assignees: [alice.id], loadOverrides: {} })
    })

    it('refuses a value that is not a percentage of zero or more, or not an object', async () => {
      const task = await create({ assignees: [alice.id] })
      for (const loadOverrides of [{ [alice.id]: -5 }, { [alice.id]: '30' }, [30], null, 30]) {
        await refused(update(task.id, { loadOverrides }), 'invalid')
      }
      expect((await stored(task.id)).overrides).toEqual([[alice.id, null]])
    })

    it('is held by the table to zero or more', async () => {
      const task = await create({ assignees: [alice.id] })
      await expect(
        x.db
          .update(taskAssignees)
          .set({ loadOverride: -1 })
          .where(eq(taskAssignees.taskId, task.id)),
      ).rejects.toMatchObject({
        cause: { code: '23514', constraint: 'task_assignees_load_override_not_negative' },
      })
    })
  })

  describe('who may change it (FR-106, FR-108)', () => {
    it('lets a read-write member set both', async () => {
      const task = await create({ aiShare: 100, assignees: [alice.id] })
      const changed = await update(
        task.id,
        { personLoad: 0.5, loadOverrides: { [alice.id]: 2 } },
        by(bob),
      )
      expect(changed).toMatchObject({ personLoad: 0.5, loadOverrides: { [alice.id]: 2 } })
    })

    it('forbids a read-only member, and hides the project from anyone else', async () => {
      const task = await create({ aiShare: 100, assignees: [alice.id] })
      await refused(update(task.id, { personLoad: 5 }, by(reader)), 'forbidden')
      await refused(update(task.id, { loadOverrides: { [alice.id]: 5 } }, by(reader)), 'forbidden')
      await refused(update(task.id, { personLoad: 5 }, by(outsider)), 'not-visible')
      await refused(services.tasks.getTask(by(outsider), task.id), 'not-visible')
      expect(await read(task.id)).toMatchObject({ personLoad: 0, loadOverrides: {} })
    })
  })

  describe('the audit log (FR-116)', () => {
    it('records what a task is created with and what an edit changes, and no edit that changes nothing', async () => {
      const task = await create(
        { aiShare: 100, personLoad: 1, assignees: [alice.id], loadOverrides: { [alice.id]: 3 } },
        by(alice, 'rest-api'),
      )
      await update(task.id, { personLoad: 0.5, loadOverrides: { [alice.id]: 4 } })
      // The same values again: nothing changes, so nothing is recorded.
      await update(task.id, { personLoad: 0.5, loadOverrides: { [alice.id.toUpperCase()]: 4 } })
      const recorded = await entries(task.id)
      expect(recorded).toHaveLength(2)
      expect(recorded[0]).toMatchObject({
        action: 'task.created',
        details: expect.objectContaining({ aiOnlyLoad: 1, loadOverrides: { [alice.id]: 3 } }),
      })
      expect(recorded[1]).toMatchObject({
        action: 'task.updated',
        details: {
          changes: { aiOnlyLoad: 0.5, loadOverrides: { [alice.id]: 4 } },
          previous: { aiOnlyLoad: 1, loadOverrides: { [alice.id]: 3 } },
        },
      })
    })
  })

  describe('the other ways a task is changed', () => {
    it('give the person load and the overrides with the task', async () => {
      const task = await create({
        aiShare: 100,
        personLoad: 1.5,
        assignees: [alice.id],
        loadOverrides: { [alice.id]: 9 },
      })
      const started = await services.taskStatus.setStatus(by(alice), task.id, 'in-progress')
      expect(started).toMatchObject({ personLoad: 1.5, loadOverrides: { [alice.id]: 9 } })
      const cancelled = await services.taskCancellation.cancel(by(alice), task.id)
      expect(cancelled).toMatchObject({ personLoad: 1.5, loadOverrides: { [alice.id]: 9 } })
      const listed = (await services.tasks.listTasks(by(reader), project)).find(
        (t) => t.id === task.id,
      )
      expect(listed).toMatchObject({ personLoad: 1.5, loadOverrides: { [alice.id]: 9 } })
    })
  })
})

describe('test cases through the REST API', () => {
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let alice: Seeded
  let apollo: string

  beforeEach(async () => {
    // A fresh test deployment for each test case: empty database, the first system admin root.
    x = await createTestDatabase()
    app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    apollo = await seedProject(x.db, alice, 'Apollo')
    return async () => {
      await app.close()
      await x.drop()
    }
  })

  const createTask = async (payload: Record<string, unknown>) => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${apollo}/tasks`,
      headers: as(alice, 'rest-api'),
      payload,
    })
    expect(response.statusCode).toBe(201)
    return response.json<Task>()
  }
  const change = (id: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      headers: as(alice, 'rest-api'),
      payload,
    })
  const readTask = async (id: string) => {
    const read = await app.inject({
      method: 'GET',
      url: `/api/tasks/${id}`,
      headers: as(alice, 'rest-api'),
    })
    expect(read.statusCode).toBe(200)
    return read.json<Task>()
  }

  describe("TC-043: a task's person-load percentage is 100% minus its AI share", () => {
    it('reads 100% for T0 (AI share 0%) and 50% for T50 (AI share 50%)', async () => {
      // The TC gives no duration; one is given so that the negative assertion has one to check.
      const t0 = await createTask({ title: 'T0', aiShare: 0, durationWorkingDays: 5 })
      const t50 = await createTask({ title: 'T50', aiShare: 50, durationWorkingDays: 5 })

      const readT0 = await readTask(t0.id)
      const readT50 = await readTask(t50.id)
      expect(readT0.personLoad).toBe(100)
      expect(readT50.personLoad).toBe(50)
      // Negative: neither task's duration is changed by its AI share.
      expect(readT0.durationWorkingDays).toBe(5)
      expect(readT50.durationWorkingDays).toBe(5)
    })
  })

  describe('TC-044: two 50% AI tasks on the same days fit one full-time person', () => {
    // Pending: alice's load on each day and the person load view come with the daily person load
    // aggregator (SC-006) and the person load chart (SC-032); "overloaded" and "red" with the
    // overload detector (SC-040) and the red flags (SC-042, SC-043). What this SC gives now is the
    // load each task puts on alice.
    it('puts 50% on alice from each task, 100% together: her full capacity', async () => {
      const task = {
        aiShare: 50,
        plannedStart: '2027-03-01',
        durationWorkingDays: 5,
        assignees: [alice.id],
      }
      const t1 = await createTask({ title: 'T1', ...task })
      const t2 = await createTask({ title: 'T2', ...task })

      const loads = [await readTask(t1.id), await readTask(t2.id)].map((t) =>
        assignmentLoad(t, alice.id),
      )
      expect(loads).toEqual([50, 50])
      expect((loads[0] ?? 0) + (loads[1] ?? 0)).toBe(100)
    })
  })

  describe("TC-045: one assignment's load override replaces the task default for that person only", () => {
    // Pending: reading alice's and bob's load on 2027-03-01 comes with the daily person load
    // aggregator (SC-006). What this SC gives now is the load T puts on each of them.
    it("sets alice's assignment to 30%, leaving bob at 100% and T at 100% with AI share 0%", async () => {
      const bob = await seedAccount(x.db, { username: 'bob' })
      await grantRole(x.db, bob, apollo, 'read-only')
      const t = await createTask({
        title: 'T',
        aiShare: 0,
        assignees: [alice.id, bob.id],
        plannedStart: '2027-03-01',
        durationWorkingDays: 10,
      })

      const changed = await change(t.id, { loadOverrides: { [alice.id]: 30 } })
      expect(changed.statusCode).toBe(200)

      const read = await readTask(t.id)
      expect(assignmentLoad(read, alice.id)).toBe(30)
      expect(assignmentLoad(read, bob.id)).toBe(100)
      // Negative: T's own person-load percentage is still 100%, its AI share still 0%.
      expect(read.personLoad).toBe(100)
      expect(read.aiShare).toBe(0)
    })
  })

  describe('TC-220: an AI-only task accepts a load of 0%, a fraction or over 100%', () => {
    it('reads back 0%, then 0.5%, then 150%, none rounded, clamped or rejected', async () => {
      const t = await createTask({ title: 'T', aiShare: 100, assignees: [alice.id] })
      for (const personLoad of [0, 0.5, 150]) {
        const set = await change(t.id, { personLoad })
        expect(set.statusCode).toBe(200)
        expect((await readTask(t.id)).personLoad).toBe(personLoad)
      }
    })
  })

  // TC-221 (the UI offers 1% as an AI-only task's default load) is pending: it is a test of the
  // assignment editor (SC-100) in the browser, part of the frontend lane (F5).

  it('refuses over REST what the service refuses, as 400', async () => {
    const t = await createTask({ title: 'T', aiShare: 50, assignees: [alice.id] })
    expect((await change(t.id, { personLoad: 10 })).statusCode).toBe(400)
    expect((await change(t.id, { loadOverrides: { [alice.id]: -1 } })).statusCode).toBe(400)
    expect((await change(t.id, { loadOverrides: { [alice.id]: '30' } })).statusCode).toBe(400)
    expect((await change(t.id, { loadOverrides: [30] })).statusCode).toBe(400)
    expect(await readTask(t.id)).toMatchObject({ personLoad: 50, loadOverrides: {} })
  })
})
