import { and, asc, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { auditLog, taskAssignees, taskBlockedBy, tasks } from '../../src/db/schema.ts'
import type { Caller, Channel } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import {
  FINISHED_TASK_MESSAGE,
  REFERENCED_MILESTONE_MESSAGE,
} from '../../src/service/task-cancellation.ts'
import { lockRelations } from '../../src/service/task-relations.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The task cancellation (SC-038) against a real PostgreSQL: its rules through the service layer,
// then the test cases of FR-027 and FR-128 through the REST API.

type Seeded = Awaited<ReturnType<typeof seedAccount>>
type Row = typeof tasks.$inferInsert

const by = (account: Seeded, channel: Channel = 'ui'): Caller => ({
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

describe('the task cancellation service', () => {
  let x: TestDatabase
  let services: Services
  let alice: Seeded
  let writer: Seeded
  let reader: Seeded
  let contributor: Seeded
  let stranger: Seeded
  let apollo: string
  let hermes: string

  beforeAll(async () => {
    x = await createTestDatabase()
    services = createServices(x.db, { today: () => '2027-03-01' })
    alice = await seedAccount(x.db, { username: 'alice' })
    writer = await seedAccount(x.db, { username: 'writer' })
    reader = await seedAccount(x.db, { username: 'reader' })
    contributor = await seedAccount(x.db, { username: 'contributor' })
    stranger = await seedAccount(x.db, { username: 'stranger', systemAdmin: true })
    apollo = await seedProject(x.db, alice, 'Apollo')
    hermes = await seedProject(x.db, stranger, 'Hermes')
    await grantRole(x.db, writer, apollo, 'read-write')
    await grantRole(x.db, reader, apollo, 'read-only')
    await grantRole(x.db, contributor, apollo, 'contributor')
  })

  afterAll(async () => {
    await x?.drop()
  })

  /** A task straight in the database, in Apollo unless told otherwise. */
  const seed = async (fields: Partial<Row> = {}) => {
    const [row] = await x.db
      .insert(tasks)
      .values({ projectId: apollo, title: 'Task', ...fields })
      .returning({ id: tasks.id })
    if (!row) throw new Error('could not seed a task')
    return row.id
  }
  const milestone = (projectId: string) =>
    seed({ projectId, title: 'Milestone', milestoneVariant: 'floating' })
  /** Makes `taskId` blocked by each of `blockers`, in that order. */
  const block = async (taskId: string, ...blockers: string[]) => {
    for (const blockerId of blockers) await x.db.insert(taskBlockedBy).values({ taskId, blockerId })
  }
  const blockersOf = async (taskId: string) =>
    (
      await x.db
        .select({ id: taskBlockedBy.blockerId })
        .from(taskBlockedBy)
        .where(eq(taskBlockedBy.taskId, taskId))
        .orderBy(asc(taskBlockedBy.createdAt))
    ).map((row) => row.id)
  const relationCount = async () =>
    (await x.db.select({ n: sql<number>`count(*)::int` }).from(taskBlockedBy))[0]?.n
  const stored = async (id: string) => (await x.db.select().from(tasks).where(eq(tasks.id, id)))[0]
  const entries = (id: string) =>
    x.db.select().from(auditLog).where(eq(auditLog.subjectId, id)).orderBy(asc(auditLog.id))
  const cancel = (id: string, caller: Caller = by(alice)) =>
    services.taskCancellation.cancel(caller, id)

  describe('cancelling a task (FR-027)', () => {
    it('sets a not-started task to cancelled, keeps it in its project and changes nothing else', async () => {
      const id = await seed({
        title: 'Write install guide',
        description: 'For the first release',
        plannedStart: '2027-03-01',
        plannedFinish: '2027-03-05',
        durationWorkingDays: 5,
        effort: 3,
        aiShare: 20,
      })
      const before = await stored(id)
      const task = await cancel(id)
      expect(task).toMatchObject({
        id,
        projectId: apollo,
        status: 'cancelled',
        title: 'Write install guide',
        plannedStart: '2027-03-01',
        durationWorkingDays: 5,
      })
      expect(await stored(id)).toEqual({ ...before, status: 'cancelled' })
      const listed = await services.tasks.listTasks(by(alice), apollo)
      expect(listed.find((t) => t.id === id)?.status).toBe('cancelled')
    })

    it.each([
      ['in-progress', { actualStart: '2027-02-01' }],
      ['on-hold', { actualStart: '2027-02-01' }],
    ] as const)('cancels a task that is %s, keeping its actual start', async (status, dates) => {
      const id = await seed({ status, ...dates })
      const task = await cancel(id)
      expect(task).toMatchObject({ status: 'cancelled', actualFinish: null, ...dates })
    })

    it('refuses to cancel a finished task as invalid, changing nothing', async () => {
      const a = await seed()
      const id = await seed({
        status: 'done',
        actualStart: '2027-02-01',
        actualFinish: '2027-02-10',
      })
      const c = await seed()
      await block(id, a)
      await block(c, id)
      const before = await stored(id)
      const error = await refused(cancel(id), 'invalid')
      expect(error.message).toBe(FINISHED_TASK_MESSAGE)
      expect(await stored(id)).toEqual(before)
      expect(await blockersOf(c)).toEqual([id])
      expect(await entries(id)).toEqual([])
      expect(await entries(c)).toEqual([])
    })

    it('refuses a contributor a finished task as forbidden, before saying it is finished', async () => {
      const id = await seed({ status: 'done', actualFinish: '2027-02-10' })
      await expect(cancel(id, by(contributor))).rejects.toMatchObject({ kind: 'forbidden' })
    })

    it('records the cancellation in the audit log, in the task’s project, with its previous status', async () => {
      const id = await seed({ status: 'in-progress', actualStart: '2027-02-01' })
      await cancel(id, by(writer, 'rest-api'))
      const [entry, ...more] = await entries(id)
      expect(more).toEqual([])
      expect(entry).toMatchObject({
        actorAccountId: writer.id,
        channels: ['rest-api'],
        projectId: apollo,
        action: 'task.cancelled',
        subjectType: 'task',
        subjectId: id,
        details: { previous: { status: 'in-progress' } },
      })
    })

    it('changes nothing, and records nothing, when the task is already cancelled', async () => {
      const blocker = await seed()
      const id = await seed({ status: 'cancelled' })
      const blocked = await seed()
      await block(id, blocker)
      await block(blocked, id)
      const before = await stored(id)
      expect((await cancel(id)).status).toBe('cancelled')
      expect(await stored(id)).toEqual(before)
      expect(await entries(id)).toEqual([])
      expect(await blockersOf(blocked)).toEqual([id])
    })

    it('answers the task with its assignees', async () => {
      const id = await seed()
      await x.db.insert(taskAssignees).values({ taskId: id, accountId: writer.id, position: 0 })
      expect(await cancel(id)).toMatchObject({ assignees: [writer.id], withoutReadAccess: [] })
    })

    it('lets the project’s read-write members and admins cancel a task, through every channel', async () => {
      for (const [account, channel] of [
        [alice, 'ui'],
        [writer, 'rest-api'],
        [alice, 'mcp'],
        [writer, 'github'],
      ] as const) {
        const id = await seed()
        expect((await cancel(id, by(account, channel))).status).toBe('cancelled')
      }
    })

    it('refuses a contributor, even on a task they are assigned to, changing nothing', async () => {
      const id = await seed({ status: 'in-progress' })
      await x.db
        .insert(taskAssignees)
        .values({ taskId: id, accountId: contributor.id, position: 0 })
      await refused(cancel(id, by(contributor)), 'forbidden')
      expect((await stored(id))?.status).toBe('in-progress')
      expect(await entries(id)).toEqual([])
    })

    it('refuses a read-only member, changing nothing', async () => {
      const id = await seed()
      await refused(cancel(id, by(reader)), 'forbidden')
      expect((await stored(id))?.status).toBe('not-started')
    })

    it('refuses a read-only member, and someone with no role, without waiting for the relations lock', async () => {
      const id = await seed()
      await x.db.transaction(async (tx) => {
        await lockRelations(tx)
        // Another connection: the refusals come while this transaction still holds the lock.
        await expect(cancel(id, by(reader))).rejects.toMatchObject({ kind: 'forbidden' })
        await expect(cancel(id, by(stranger))).rejects.toMatchObject({ kind: 'not-visible' })
      })
    })

    it('tells someone with no role in the project that it is not visible, even a system admin', async () => {
      const id = await seed()
      await refused(cancel(id, by(stranger)), 'not-visible')
      expect((await stored(id))?.status).toBe('not-started')
    })

    it.each([
      ['a task id that does not exist', '6f1c2a5e-0000-4000-8000-0000000000ff'],
      ['a task id that is not a UUID', 'build'],
    ])('refuses %s as not found', async (_, id) => {
      await expect(cancel(id)).rejects.toMatchObject({ kind: 'not-found' })
    })
  })

  describe('passing its blockers on (FR-128)', () => {
    it('makes each task it blocked blocked by its blockers instead, and nothing else', async () => {
      const a1 = await seed({ title: 'A1' })
      const a2 = await seed({ title: 'A2' })
      const b = await seed({ title: 'B' })
      const c = await seed({ title: 'C' })
      const d = await seed({ title: 'D' })
      const unrelated = await seed()
      await block(b, a1, a2)
      await block(c, b)
      await block(d, b)
      await block(unrelated, a1)
      const count = await relationCount()

      await cancel(b)

      expect(await blockersOf(c)).toEqual([a1, a2])
      expect(await blockersOf(d)).toEqual([a1, a2])
      // The cancelled task keeps its own blockers; no other task gains or loses a relation.
      expect(await blockersOf(b)).toEqual([a1, a2])
      expect(await blockersOf(unrelated)).toEqual([a1])
      expect(await blockersOf(a1)).toEqual([])
      expect(await blockersOf(a2)).toEqual([])
      // C and D each lost B and gained A1 and A2.
      expect(await relationCount()).toBe((count ?? 0) + 2)
    })

    it('does not add a blocker the blocked task has already', async () => {
      const a1 = await seed()
      const a2 = await seed()
      const b = await seed()
      const c = await seed()
      await block(b, a1, a2)
      await block(c, a1, b)
      await cancel(b)
      expect(await blockersOf(c)).toEqual([a1, a2])
      const [entry] = await entries(c)
      expect(entry?.details).toEqual({
        cancelledTaskId: b,
        addedBlockerIds: [a2],
      })
    })

    it('only removes the relation when the cancelled task has no blockers', async () => {
      const b = await seed()
      const c = await seed()
      const other = await seed()
      await block(c, other, b)
      await cancel(b)
      expect(await blockersOf(c)).toEqual([other])
    })

    it('records each blocked task’s change in the audit log, in its own project', async () => {
      const a = await seed()
      const b = await seed()
      const c = await seed()
      await block(b, a)
      await block(c, b)
      await cancel(b, by(writer, 'mcp'))
      const [entry, ...more] = await entries(c)
      expect(more).toEqual([])
      expect(entry).toMatchObject({
        actorAccountId: writer.id,
        channels: ['mcp'],
        projectId: apollo,
        action: 'task.blockers-passed-on',
        subjectType: 'task',
        subjectId: c,
        details: { cancelledTaskId: b, addedBlockerIds: [a] },
      })
    })

    it("passes on another project's milestone that blocked the cancelled task", async () => {
      const m = await milestone(hermes)
      const b = await seed()
      const c = await seed()
      await block(b, m)
      await block(c, b)
      await cancel(b)
      expect(await blockersOf(c)).toEqual([m])
    })

    it('lets a blocked task be started once the blockers passed on to it have finished (FR-026)', async () => {
      const a = await seed()
      const b = await seed()
      const c = await seed()
      await block(b, a)
      await block(c, b)
      await cancel(b)
      await expect(
        services.taskStatus.setStatus(by(alice), c, 'in-progress'),
      ).rejects.toMatchObject({ kind: 'conflict' })
      await x.db.update(tasks).set({ status: 'done' }).where(eq(tasks.id, a))
      expect((await services.taskStatus.setStatus(by(alice), c, 'in-progress')).status).toBe(
        'in-progress',
      )
    })

    describe('a milestone (FR-015)', () => {
      it('passes on the blockers of a milestone that blocks only tasks of its own project', async () => {
        const m = await milestone(apollo)
        const a = await seed()
        const n = await milestone(hermes)
        const c = await seed()
        await block(m, a, n)
        await block(c, m)
        await cancel(m)
        expect(await blockersOf(c)).toEqual([a, n])
        expect((await stored(m))?.status).toBe('cancelled')
      })

      it.each([
        ['no blockers', async () => []],
        ['a blocker of its own project', async () => [await seed()]],
        ['a milestone of another project as a blocker', async () => [await milestone(hermes)]],
      ])(
        'refuses to cancel one that blocks a task of another project, with %s, as a conflict changing nothing',
        async (_, blockers) => {
          const m = await milestone(apollo)
          const own = await blockers()
          const sameProject = await seed()
          const c = await seed({ projectId: hermes })
          await block(m, ...own)
          await block(sameProject, m)
          await block(c, m)
          const before = await stored(m)
          const count = await relationCount()

          const error = await refused(cancel(m), 'conflict')

          expect(error.message).toBe(REFERENCED_MILESTONE_MESSAGE)
          expect(await stored(m)).toEqual(before)
          expect(await blockersOf(m)).toEqual(own)
          expect(await blockersOf(c)).toEqual([m])
          expect(await blockersOf(sameProject)).toEqual([m])
          expect(await relationCount()).toBe(count)
          expect(await entries(m)).toEqual([])
          expect(await entries(c)).toEqual([])
          expect(await entries(sameProject)).toEqual([])
        },
      )
    })

    it('waits for a change of relations in progress, and passes on the relations as they then are', async () => {
      const a = await seed()
      const late = await seed()
      const b = await seed()
      const c = await seed()
      await block(b, a)
      await block(c, b)
      let release!: () => void
      const released = new Promise<void>((resolve) => (release = resolve))
      let holding!: () => void
      const held = new Promise<void>((resolve) => (holding = resolve))
      const holder = x.db.transaction(async (tx) => {
        await lockRelations(tx)
        await tx.insert(taskBlockedBy).values({ taskId: b, blockerId: late })
        holding()
        await released
      })
      await held
      const cancelled = cancel(b)
      // The cancellation waits for the lock: give it time to reach it, then let the change commit.
      await waitForLockWait()
      release()
      await holder
      await cancelled
      expect(await blockersOf(c)).toEqual([a, late])
    })

    /** Waits until a connection to the test database is waiting for a lock. */
    async function waitForLockWait() {
      for (let tries = 0; tries < 200; tries++) {
        const result = await x.db.execute<{ waiting: number }>(sql`
          select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
        `)
        if ((result.rows[0]?.waiting ?? 0) >= 1) return
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error('the cancellation never waited for the relations lock')
    }
  })
})

describe('test cases through the REST API', () => {
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let alice: Seeded
  let apollo: string

  beforeEach(async () => {
    // A fresh test deployment for each test case: empty database and the first system admin root.
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

  const api = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    app.inject({ method, url, headers: as(alice, 'rest-api'), ...(payload && { payload }) })
  const createTask = async (title: string) => {
    const created = await api('POST', `/api/projects/${apollo}/tasks`, { title })
    expect(created.statusCode).toBe(201)
    return created.json<{ id: string }>().id
  }
  const blockedBy = async (id: string) => {
    const read = await api('GET', `/api/tasks/${id}/relations`)
    expect(read.statusCode).toBe(200)
    return read.json<{ blockedBy: { id: string }[] }>().blockedBy.map((ref) => ref.id)
  }
  const addBlocker = async (id: string, blockerId: string) =>
    expect((await api('POST', `/api/tasks/${id}/blocked-by`, { blockerId })).statusCode).toBe(200)

  describe('TC-037: a task can be cancelled in the tool', () => {
    it('cancels T through the REST API; T reads back cancelled and still in Apollo', async () => {
      const t = await createTask('T')

      const response = await api('POST', `/api/tasks/${t}/cancel`)
      expect(response.statusCode).toBe(200)

      const read = await api('GET', `/api/tasks/${t}`)
      expect(read.statusCode).toBe(200)
      expect(read.json()).toMatchObject({ id: t, projectId: apollo, status: 'cancelled' })
      // Negative: T is not deleted; it is still one of Apollo's tasks.
      const listed = await api('GET', `/api/projects/${apollo}/tasks`)
      expect(listed.json<{ id: string }[]>().map((task) => task.id)).toContain(t)
    })
  })

  describe('TC-190: cancelling a task passes its blockers on to the tasks it blocked', () => {
    it('cancels B; C is then blocked by A1 and A2, and no longer by B', async () => {
      const a1 = await createTask('A1')
      const a2 = await createTask('A2')
      const b = await createTask('B')
      const c = await createTask('C')
      await addBlocker(b, a1)
      await addBlocker(b, a2)
      await addBlocker(c, b)
      const relationsBefore = await x.db.select().from(taskBlockedBy)

      expect((await api('POST', `/api/tasks/${b}/cancel`)).statusCode).toBe(200)

      const after = await blockedBy(c)
      expect(after).toHaveLength(2)
      expect(after).toEqual(expect.arrayContaining([a1, a2]))
      // Negative: C is no longer blocked by B, and no other task gains a relation.
      expect(after).not.toContain(b)
      const relationsAfter = await x.db.select().from(taskBlockedBy)
      const gained = relationsAfter.filter(
        (row) =>
          !relationsBefore.some(
            (old) => old.taskId === row.taskId && old.blockerId === row.blockerId,
          ),
      )
      expect(gained.map((row) => row.taskId)).toEqual([c, c])
      expect(
        await x.db
          .select()
          .from(taskBlockedBy)
          .where(and(eq(taskBlockedBy.taskId, c), eq(taskBlockedBy.blockerId, b))),
      ).toEqual([])
      for (const other of [a1, a2]) expect(await blockedBy(other)).toEqual([])
      expect(await blockedBy(b)).toEqual([a1, a2])
    })
  })

  /** Makes a request as `account` through the REST API. */
  const apiAs = (account: Seeded, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    app.inject({ method, url, headers: as(account, 'rest-api'), ...(payload && { payload }) })
  const createIn = async (account: Seeded, projectId: string, body: object) => {
    const created = await apiAs(account, 'POST', `/api/projects/${projectId}/tasks`, body)
    expect(created.statusCode).toBe(201)
    return created.json<{ id: string }>().id
  }
  const blockedByAs = async (account: Seeded, id: string) => {
    const read = await apiAs(account, 'GET', `/api/tasks/${id}/relations`)
    expect(read.statusCode).toBe(200)
    return read.json<{ blockedBy: { id: string }[] }>().blockedBy.map((ref) => ref.id)
  }

  describe('TC-276: cancelling a milestone another project depends on is rejected', () => {
    it('rejects cancelling M; M stays not started and X stays blocked by M', async () => {
      const bob = await seedAccount(x.db, { username: 'bob' })
      await grantRole(x.db, bob, apollo, 'read-only')
      const hermes = await seedProject(x.db, bob, 'Hermes')
      const m = await createIn(alice, apollo, { title: 'M', milestone: { variant: 'floating' } })
      const task = await createIn(bob, hermes, { title: 'X' })
      expect(
        (await apiAs(bob, 'POST', `/api/tasks/${task}/blocked-by`, { blockerId: m })).statusCode,
      ).toBe(200)

      const response = await api('POST', `/api/tasks/${m}/cancel`)
      expect(response.statusCode).toBe(409)

      const read = await api('GET', `/api/tasks/${m}`)
      expect(read.json()).toMatchObject({ id: m, status: 'not-started' })
      // Negative: M is not cancelled, and X loses no relation.
      expect(await blockedByAs(bob, task)).toEqual([m])
    })
  })

  describe('TC-277: cancelling a finished task is rejected', () => {
    it('rejects cancelling T; T stays done with the same actual start and finish', async () => {
      const t = await createTask('T')
      for (const status of ['in-progress', 'done']) {
        expect((await api('PUT', `/api/tasks/${t}/status`, { status })).statusCode).toBe(200)
      }
      const before = (await api('GET', `/api/tasks/${t}`)).json<Record<string, unknown>>()
      expect(before).toMatchObject({ status: 'done' })

      const response = await api('POST', `/api/tasks/${t}/cancel`)
      expect(response.statusCode).toBe(400)

      const read = (await api('GET', `/api/tasks/${t}`)).json<Record<string, unknown>>()
      // Negative: T is not cancelled.
      expect(read).toMatchObject({
        status: 'done',
        actualStart: before['actualStart'],
        actualFinish: before['actualFinish'],
      })
    })
  })

  describe('TC-278: a cancelled task passes on a milestone its canceller cannot read', () => {
    it('lets bob cancel B; C is then blocked by N, and no longer by B', async () => {
      const bob = await seedAccount(x.db, { username: 'bob' })
      await grantRole(x.db, bob, apollo, 'read-write')
      const hermes = await seedProject(x.db, alice, 'Hermes')
      const n = await createIn(alice, hermes, { title: 'N', milestone: { variant: 'floating' } })
      const b = await createTask('B')
      const c = await createTask('C')
      await addBlocker(b, n)
      await addBlocker(c, b)

      expect((await apiAs(bob, 'POST', `/api/tasks/${b}/cancel`)).statusCode).toBe(200)

      const after = await blockedBy(c)
      expect(after).toEqual([n])
      // Negative: C is no longer blocked by B.
      expect(after).not.toContain(b)
    })
  })
})
