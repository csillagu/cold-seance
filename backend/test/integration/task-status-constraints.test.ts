import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import type { Transaction } from '../../src/db/client.ts'
import { auditLog, taskBlockedBy, tasks } from '../../src/db/schema.ts'
import type { Caller, Channel } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import { lockRelations } from '../../src/service/task-relations.ts'
import {
  OPEN_SUBTASK_MESSAGE,
  UNFINISHED_BLOCKER_MESSAGE,
} from '../../src/service/task-status-constraints.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The task status constraint checks (SC-037) against a real PostgreSQL: their rules through the
// service layer, then the test cases of FR-025 and FR-026 through the REST API.

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

describe('the task status constraint checks', () => {
  let x: TestDatabase
  let services: Services
  let alice: Seeded
  let reader: Seeded
  let contributor: Seeded
  let stranger: Seeded
  let project: string
  let other: string

  beforeAll(async () => {
    x = await createTestDatabase()
    services = createServices(x.db, { today: () => '2027-03-01' })
    alice = await seedAccount(x.db, { username: 'alice' })
    reader = await seedAccount(x.db, { username: 'reader' })
    contributor = await seedAccount(x.db, { username: 'contributor' })
    stranger = await seedAccount(x.db, { username: 'stranger' })
    project = await seedProject(x.db, alice, 'Apollo')
    other = await seedProject(x.db, stranger, 'Hermes')
    await grantRole(x.db, reader, project, 'read-only')
    await grantRole(x.db, contributor, project, 'contributor')
  })

  afterAll(async () => {
    await x?.drop()
  })

  /** A task straight in the database, in Apollo unless told otherwise. */
  const seed = async (fields: Partial<Row> = {}) => {
    const [row] = await x.db
      .insert(tasks)
      .values({ projectId: project, title: 'Task', ...fields })
      .returning({ id: tasks.id })
    if (!row) throw new Error('could not seed a task')
    return row.id
  }
  const block = (taskId: string, ...blockers: string[]) =>
    x.db.insert(taskBlockedBy).values(blockers.map((blockerId) => ({ taskId, blockerId })))
  const stored = async (id: string) => (await x.db.select().from(tasks).where(eq(tasks.id, id)))[0]
  const entries = (id: string) => x.db.select().from(auditLog).where(eq(auditLog.subjectId, id))
  const set = (id: string, status: unknown, caller: Caller = by(alice)) =>
    services.taskStatus.setStatus(caller, id, status)

  /**
   * Expects the move to be refused as a conflict, leaving the task and its log as they were, and
   * answers why it was refused.
   */
  async function rejected(id: string, status: string, caller?: Caller): Promise<string> {
    const before = await stored(id)
    const logged = (await entries(id)).length
    const error = await refused(set(id, status, caller), 'conflict')
    expect(await stored(id)).toEqual(before)
    expect(await entries(id)).toHaveLength(logged)
    return error.message
  }

  describe('finishing a parent while a subtask is open (FR-025)', () => {
    it.each(['not-started', 'in-progress', 'on-hold'] as const)(
      'refuses it while a subtask is %s, changing nothing',
      async (status) => {
        const parent = await seed({ status: 'in-progress', actualStart: '2027-02-01' })
        await seed({ parentId: parent, status: 'done', actualFinish: '2027-02-10' })
        const open = await seed({ parentId: parent, status })
        const openBefore = await stored(open)
        expect(await rejected(parent, 'done')).toBe(OPEN_SUBTASK_MESSAGE)
        expect(await stored(open)).toEqual(openBefore)
      },
    )

    it('refuses it while a subtask of a subtask is open', async () => {
      const parent = await seed({ status: 'in-progress' })
      const child = await seed({ parentId: parent, status: 'done' })
      await seed({ parentId: child, status: 'in-progress' })
      expect(await rejected(parent, 'done')).toBe(OPEN_SUBTASK_MESSAGE)
    })

    it('refuses it from any status the parent is in', async () => {
      for (const status of ['not-started', 'on-hold'] as const) {
        const parent = await seed({ status })
        await seed({ parentId: parent })
        expect(await rejected(parent, 'done')).toBe(OPEN_SUBTASK_MESSAGE)
      }
    })

    it('finishes it once every subtask, at any depth, is done or cancelled', async () => {
      const parent = await seed({ status: 'in-progress', actualStart: '2027-02-01' })
      const child = await seed({ parentId: parent, status: 'done' })
      await seed({ parentId: child, status: 'done' })
      await seed({ parentId: parent, status: 'cancelled' })
      const task = await set(parent, 'done')
      expect(task).toMatchObject({ status: 'done', actualFinish: '2027-03-01' })
    })

    it('finishes a task with no subtasks', async () => {
      const task = await set(await seed({ status: 'in-progress' }), 'done')
      expect(task.status).toBe('done')
    })

    it('leaves the parent free to start, be put on hold and be set back to in progress', async () => {
      const parent = await seed()
      await seed({ parentId: parent })
      expect((await set(parent, 'in-progress')).status).toBe('in-progress')
      expect((await set(parent, 'on-hold')).status).toBe('on-hold')
      expect((await set(parent, 'in-progress')).status).toBe('in-progress')
    })

    it('does not look at the subtasks of a task that is already done', async () => {
      const parent = await seed({ status: 'done', actualFinish: '2027-02-01' })
      await seed({ parentId: parent, status: 'in-progress' })
      expect(await set(parent, 'done')).toMatchObject({
        status: 'done',
        actualFinish: '2027-02-01',
      })
    })

    it('leaves a subtask free to finish while its parent is open', async () => {
      const parent = await seed({ status: 'in-progress' })
      const child = await seed({ parentId: parent, status: 'in-progress' })
      expect((await set(child, 'done')).status).toBe('done')
    })
  })

  describe('starting or finishing a task before its blockers finish (FR-026)', () => {
    it.each(['not-started', 'in-progress', 'on-hold', 'cancelled'] as const)(
      'refuses to start it while a blocker is %s, changing nothing',
      async (status) => {
        const blocker = await seed({ status })
        const blocked = await seed()
        await block(blocked, blocker)
        const blockerBefore = await stored(blocker)
        expect(await rejected(blocked, 'in-progress')).toBe(UNFINISHED_BLOCKER_MESSAGE)
        expect(await stored(blocker)).toEqual(blockerBefore)
      },
    )

    it('refuses to start it while one of several blockers has not finished', async () => {
      const done = await seed({ status: 'done' })
      const open = await seed({ status: 'in-progress' })
      const blocked = await seed()
      await block(blocked, done, open)
      expect(await rejected(blocked, 'in-progress')).toBe(UNFINISHED_BLOCKER_MESSAGE)
    })

    it('refuses to start a task on hold that has never started', async () => {
      const blocker = await seed({ status: 'in-progress' })
      const blocked = await seed({ status: 'on-hold' })
      await block(blocked, blocker)
      expect(await rejected(blocked, 'in-progress')).toBe(UNFINISHED_BLOCKER_MESSAGE)
    })

    it('refuses to finish it, started or not, while a blocker has not finished', async () => {
      const blocker = await seed({ status: 'in-progress' })
      const notStarted = await seed()
      const started = await seed({ status: 'in-progress', actualStart: '2027-02-01' })
      await block(notStarted, blocker)
      await block(started, blocker)
      expect(await rejected(notStarted, 'done')).toBe(UNFINISHED_BLOCKER_MESSAGE)
      expect(await rejected(started, 'done')).toBe(UNFINISHED_BLOCKER_MESSAGE)
    })

    it('starts and finishes it once every blocker is done', async () => {
      const first = await seed({ status: 'done' })
      const second = await seed({ status: 'done' })
      const blocked = await seed()
      await block(blocked, first, second)
      expect(await set(blocked, 'in-progress')).toMatchObject({
        status: 'in-progress',
        actualStart: '2027-03-01',
      })
      expect((await set(blocked, 'done')).status).toBe('done')
    })

    it('lets a task that has started be set back to in progress, from on hold or done', async () => {
      const blocker = await seed({ status: 'in-progress' })
      const held = await seed({ status: 'on-hold', actualStart: '2027-02-01' })
      const finished = await seed({
        status: 'done',
        actualStart: '2027-02-01',
        actualFinish: '2027-02-10',
      })
      await block(held, blocker)
      await block(finished, blocker)
      expect(await set(held, 'in-progress')).toMatchObject({
        status: 'in-progress',
        actualStart: '2027-02-01',
      })
      expect(await set(finished, 'in-progress')).toMatchObject({
        status: 'in-progress',
        actualStart: '2027-02-01',
        actualFinish: null,
      })
    })

    it('lets a blocked task be put on hold', async () => {
      const blocker = await seed({ status: 'in-progress' })
      const blocked = await seed()
      await block(blocked, blocker)
      expect((await set(blocked, 'on-hold')).status).toBe('on-hold')
    })

    it('leaves a blocker free to change, whatever the tasks it blocks', async () => {
      const blocker = await seed()
      const blocked = await seed()
      await block(blocked, blocker)
      expect((await set(blocker, 'in-progress')).status).toBe('in-progress')
      expect((await set(blocker, 'done')).status).toBe('done')
    })

    it("refuses it while another project's milestone blocking it has not been reached, naming nothing of it", async () => {
      const milestone = await seed({
        projectId: other,
        title: 'Hermes launch',
        milestoneVariant: 'floating',
      })
      const blocked = await seed()
      await block(blocked, milestone)
      const error = await refused(set(blocked, 'in-progress'), 'conflict')
      expect(error.message).not.toContain('Hermes')
      expect(error.message).not.toContain(milestone)
      await x.db.update(tasks).set({ status: 'done' }).where(eq(tasks.id, milestone))
      expect((await set(blocked, 'in-progress')).status).toBe('in-progress')
    })
  })

  describe('the order of the checks', () => {
    it('refuses a parent with an open subtask that is also blocked for its subtask first', async () => {
      const blocker = await seed({ status: 'in-progress' })
      const parent = await seed({ status: 'in-progress' })
      await seed({ parentId: parent })
      await block(parent, blocker)
      expect(await rejected(parent, 'done')).toBe(OPEN_SUBTASK_MESSAGE)
    })

    it('tells a read-only member they may not, before looking at the relations', async () => {
      const blocked = await seed()
      await block(blocked, await seed())
      await expect(set(blocked, 'in-progress', by(reader))).rejects.toMatchObject({
        kind: 'forbidden',
      })
    })

    it('tells someone with no role in the project it is not visible, before looking at the relations', async () => {
      const blocked = await seed()
      await block(blocked, await seed())
      await expect(set(blocked, 'in-progress', by(stranger))).rejects.toMatchObject({
        kind: 'not-visible',
      })
    })

    it('refuses an invalid status as invalid, not as a conflict', async () => {
      const blocked = await seed()
      await block(blocked, await seed())
      await expect(set(blocked, 'cancelled')).rejects.toMatchObject({ kind: 'invalid' })
      await expect(set(blocked, 'started')).rejects.toMatchObject({ kind: 'invalid' })
    })
  })

  describe('every channel (FR-115)', () => {
    it.each<Channel>(['ui', 'rest-api', 'mcp', 'github'])(
      'refuses the same moves through %s',
      async (channel) => {
        const blocked = await seed()
        await block(blocked, await seed())
        expect(await rejected(blocked, 'in-progress', by(alice, channel))).toBe(
          UNFINISHED_BLOCKER_MESSAGE,
        )
        const parent = await seed({ status: 'in-progress' })
        await seed({ parentId: parent })
        expect(await rejected(parent, 'done', by(alice, channel))).toBe(OPEN_SUBTASK_MESSAGE)
      },
    )

    it('refuses a contributor assigned to the task the same way', async () => {
      const blocked = await seed()
      await block(blocked, await seed())
      await services.tasks.updateTask(by(alice), blocked, { assignees: [contributor.id] })
      expect(await rejected(blocked, 'in-progress', by(contributor))).toBe(
        UNFINISHED_BLOCKER_MESSAGE,
      )
    })
  })

  describe('changes made at the same time', () => {
    /**
     * Runs `hold` in a transaction of its own and keeps it open until each status change under
     * test is waiting for one of its locks, then commits it, and answers how each change ended:
     * the error it was refused with, or undefined.
     */
    async function whileHeld(
      hold: (tx: Transaction) => Promise<void>,
      ...changes: (() => Promise<unknown>)[]
    ): Promise<unknown[]> {
      let release!: () => void
      const released = new Promise<void>((resolve) => (release = resolve))
      let holding!: () => void
      const held = new Promise<void>((resolve) => (holding = resolve))
      const holder = x.db.transaction(async (tx) => {
        await hold(tx)
        holding()
        await released
      })
      await held
      const outcomes = changes.map((change) =>
        change().then(
          () => undefined,
          (error: unknown) => error,
        ),
      )
      await waitForLockWaits(changes.length)
      release()
      await holder
      return Promise.all(outcomes)
    }

    /** Waits until `count` connections to the test database are waiting for a lock. */
    async function waitForLockWaits(count: number) {
      for (let tries = 0; tries < 200; tries++) {
        const result = await x.db.execute<{ waiting: number }>(sql`
          select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
        `)
        if ((result.rows[0]?.waiting ?? 0) >= count) return
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error('the status changes never waited for the held lock')
    }

    it('reads a subtask reopened at the same moment as it is once reopened', async () => {
      const parent = await seed({ status: 'in-progress' })
      const child = await seed({ parentId: parent, status: 'done' })
      const [outcome] = await whileHeld(
        async (tx) => {
          await tx.update(tasks).set({ status: 'in-progress' }).where(eq(tasks.id, child))
        },
        () => set(parent, 'done'),
      )
      expect(outcome).toMatchObject({ kind: 'conflict' })
      expect((await stored(parent))?.status).toBe('in-progress')
    })

    it('reads a blocker set back at the same moment as it is once set back', async () => {
      const blocker = await seed({ status: 'done' })
      const blocked = await seed()
      await block(blocked, blocker)
      const [outcome] = await whileHeld(
        async (tx) => {
          await tx.update(tasks).set({ status: 'in-progress' }).where(eq(tasks.id, blocker))
        },
        () => set(blocked, 'in-progress'),
      )
      expect(outcome).toMatchObject({ kind: 'conflict' })
      expect((await stored(blocked))?.status).toBe('not-started')
    })

    it('reads a blocker added at the same moment, once it is added', async () => {
      const blocker = await seed({ status: 'in-progress' })
      const blocked = await seed()
      const [outcome] = await whileHeld(
        async (tx) => {
          await lockRelations(tx)
          await tx.insert(taskBlockedBy).values({ taskId: blocked, blockerId: blocker })
        },
        () => set(blocked, 'in-progress'),
      )
      expect(outcome).toMatchObject({ kind: 'conflict' })
    })

    it('reads a subtask added at the same moment, once it is added', async () => {
      const parent = await seed({ status: 'in-progress' })
      const child = await seed()
      const [outcome] = await whileHeld(
        async (tx) => {
          await lockRelations(tx)
          await tx.update(tasks).set({ parentId: parent }).where(eq(tasks.id, child))
        },
        () => set(parent, 'done'),
      )
      expect(outcome).toMatchObject({ kind: 'conflict' })
    })

    it('finishes a parent and starts its subtask that it blocks one after the other, with no deadlock', async () => {
      // Each change locks its own task, then reads the other: only the relations lock, taken
      // first by both, keeps them from waiting for each other.
      const parent = await seed({ status: 'in-progress', actualStart: '2027-02-01' })
      const child = await seed({ parentId: parent })
      await block(child, parent)
      const outcomes = await whileHeld(
        lockRelations,
        () => set(parent, 'done'),
        () => set(child, 'in-progress'),
      )
      expect(outcomes).toEqual([
        expect.objectContaining({ kind: 'conflict', message: OPEN_SUBTASK_MESSAGE }),
        expect.objectContaining({ kind: 'conflict', message: UNFINISHED_BLOCKER_MESSAGE }),
      ])
    })

    it('does not wait for the relations lock to put a task on hold', async () => {
      const task = await seed({ status: 'in-progress' })
      await x.db.transaction(async (tx) => {
        await lockRelations(tx)
        // Another connection: the hold is made while this transaction still holds the lock.
        expect((await set(task, 'on-hold')).status).toBe('on-hold')
      })
    })
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
  const setStatus = (id: string, status: string) =>
    api('PUT', `/api/tasks/${id}/status`, { status })
  const given = async (id: string, ...statuses: string[]) => {
    for (const status of statuses) expect((await setStatus(id, status)).statusCode).toBe(200)
  }
  const readTask = async (id: string) => {
    const read = await api('GET', `/api/tasks/${id}`)
    expect(read.statusCode).toBe(200)
    return read.json<Record<string, unknown>>()
  }

  describe('TC-035: finishing a parent while a subtask is open is rejected', () => {
    it('rejects setting P to done, leaving P in progress with no actual finish and C1, C2 unchanged', async () => {
      const p = await createTask('P')
      const c1 = await createTask('C1')
      const c2 = await createTask('C2')
      for (const child of [c1, c2]) {
        expect((await api('PUT', `/api/tasks/${child}/parent`, { parentId: p })).statusCode).toBe(
          200,
        )
      }
      await given(p, 'in-progress')
      await given(c1, 'in-progress', 'done')
      await given(c2, 'in-progress')
      const c1Before = await readTask(c1)
      const c2Before = await readTask(c2)

      const response = await setStatus(p, 'done')
      expect(response.statusCode).toBe(409)
      expect(response.json().message).toBe(OPEN_SUBTASK_MESSAGE)

      const read = await readTask(p)
      expect(read.status).toBe('in-progress')
      // Negative: P has no actual finish; C1 and C2 are unchanged.
      expect(read.actualFinish).toBeNull()
      expect(await readTask(c1)).toEqual(c1Before)
      expect(await readTask(c2)).toEqual(c2Before)
    })
  })

  describe('TC-036: starting a task before its blocker finishes is rejected', () => {
    it('rejects setting B in progress, leaving B not started with no actual start and A unchanged', async () => {
      const a = await createTask('A')
      const b = await createTask('B')
      await given(a, 'in-progress')
      expect((await api('POST', `/api/tasks/${b}/blocked-by`, { blockerId: a })).statusCode).toBe(
        200,
      )
      const aBefore = await readTask(a)
      expect(await readTask(b)).toMatchObject({ status: 'not-started' })

      const response = await setStatus(b, 'in-progress')
      expect(response.statusCode).toBe(409)
      expect(response.json().message).toBe(UNFINISHED_BLOCKER_MESSAGE)

      const read = await readTask(b)
      expect(read.status).toBe('not-started')
      // Negative: B has no actual start; A is unchanged.
      expect(read.actualStart).toBeNull()
      expect(await readTask(a)).toEqual(aBefore)
    })
  })
})
