import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { auditLog, tasks } from '../../src/db/schema.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import type { TaskStatus } from '../../src/service/permissions.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The task status transitions (SC-003) against a real PostgreSQL: their rules through the service
// layer, then the test cases of FR-022, FR-023 and FR-024 through the REST API.

type Seeded = Awaited<ReturnType<typeof seedAccount>>
type Row = typeof tasks.$inferInsert

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

describe('the task status service', () => {
  let x: TestDatabase
  let services: Services
  let today: string
  let alice: Seeded
  let reader: Seeded
  let contributor: Seeded
  let writer: Seeded
  let stranger: Seeded
  let project: string

  beforeAll(async () => {
    x = await createTestDatabase()
    services = createServices(x.db, { today: () => today })
    alice = await seedAccount(x.db, { username: 'alice' })
    reader = await seedAccount(x.db, { username: 'reader' })
    contributor = await seedAccount(x.db, { username: 'contributor' })
    writer = await seedAccount(x.db, { username: 'writer' })
    stranger = await seedAccount(x.db, { username: 'stranger', systemAdmin: true })
    project = await seedProject(x.db, alice, 'Apollo')
    await grantRole(x.db, reader, project, 'read-only')
    await grantRole(x.db, contributor, project, 'contributor')
    await grantRole(x.db, writer, project, 'read-write')
  })

  beforeEach(() => {
    today = '2027-03-01'
  })

  afterAll(async () => {
    await x?.drop()
  })

  /** A task straight in the database, in the given status and with the given fields. */
  const seed = async (fields: Partial<Row> = {}) => {
    const [row] = await x.db
      .insert(tasks)
      .values({ projectId: project, title: 'Write install guide', ...fields })
      .returning({ id: tasks.id })
    if (!row) throw new Error('could not seed a task')
    return row.id
  }
  const stored = async (id: string) => (await x.db.select().from(tasks).where(eq(tasks.id, id)))[0]
  const entries = (id: string) =>
    x.db.select().from(auditLog).where(eq(auditLog.subjectId, id)).orderBy(auditLog.id)
  const set = (id: string, status: unknown, caller: Caller = by(alice)) =>
    services.taskStatus.setStatus(caller, id, status)

  describe('starting a task (FR-022)', () => {
    it("records today as a not-started task's actual start, and nothing else", async () => {
      const id = await seed({
        plannedStart: '2027-03-02',
        plannedFinish: '2027-03-05',
        durationWorkingDays: 4,
      })
      const before = await stored(id)
      const task = await set(id, 'in-progress')
      expect(task).toMatchObject({
        id,
        status: 'in-progress',
        actualStart: '2027-03-01',
        actualFinish: null,
        plannedStart: '2027-03-02',
        plannedFinish: '2027-03-05',
        durationWorkingDays: 4,
      })
      expect(await stored(id)).toEqual({
        ...before,
        status: 'in-progress',
        actualStart: '2027-03-01',
      })
    })

    it('keeps the actual start when a task on hold is set back to in progress', async () => {
      const id = await seed({ status: 'on-hold', actualStart: '2027-02-15' })
      const task = await set(id, 'in-progress')
      expect(task).toMatchObject({
        status: 'in-progress',
        actualStart: '2027-02-15',
        actualFinish: null,
      })
    })

    it('records the start of each task on the day it is started', async () => {
      const first = await seed()
      const second = await seed()
      await set(first, 'in-progress')
      today = '2027-03-04'
      await set(second, 'in-progress')
      expect((await stored(first))?.actualStart).toBe('2027-03-01')
      expect((await stored(second))?.actualStart).toBe('2027-03-04')
    })
  })

  describe('finishing a task (FR-023)', () => {
    it('records today as the actual finish of a task in progress, keeping its actual start', async () => {
      const id = await seed({ status: 'in-progress', actualStart: '2027-02-15' })
      today = '2027-03-03'
      const task = await set(id, 'done')
      expect(task).toMatchObject({
        status: 'done',
        actualStart: '2027-02-15',
        actualFinish: '2027-03-03',
      })
    })

    it('clears the actual finish of a finished task set back to in progress, keeping its start', async () => {
      const id = await seed({
        status: 'done',
        actualStart: '2027-02-15',
        actualFinish: '2027-02-20',
      })
      const task = await set(id, 'in-progress')
      expect(task).toMatchObject({
        status: 'in-progress',
        actualStart: '2027-02-15',
        actualFinish: null,
      })
      today = '2027-03-08'
      expect(await set(id, 'done')).toMatchObject({ actualFinish: '2027-03-08' })
    })

    it('takes a task through every move, recording its dates on the way', async () => {
      const id = await seed()
      const steps: [TaskStatus, string, string | null, string | null][] = [
        ['in-progress', '2027-03-01', '2027-03-01', null],
        ['on-hold', '2027-03-02', '2027-03-01', null],
        ['in-progress', '2027-03-03', '2027-03-01', null],
        ['done', '2027-03-04', '2027-03-01', '2027-03-04'],
        ['in-progress', '2027-03-05', '2027-03-01', null],
        ['done', '2027-03-06', '2027-03-01', '2027-03-06'],
      ]
      for (const [status, on, actualStart, actualFinish] of steps) {
        today = on
        expect(await set(id, status)).toMatchObject({ status, actualStart, actualFinish })
      }
    })
  })

  describe('putting a task on hold (FR-024, DD-007)', () => {
    it('only marks it: its planned dates, duration, effort, AI share and actual dates stay', async () => {
      const id = await seed({
        status: 'in-progress',
        plannedStart: '2027-03-01',
        plannedFinish: '2027-03-05',
        durationWorkingDays: 5,
        effort: 5,
        aiShare: 0,
        actualStart: '2027-03-01',
      })
      const before = await stored(id)
      today = '2027-03-03'
      const task = await set(id, 'on-hold')
      expect(task.status).toBe('on-hold')
      expect(await stored(id)).toEqual({ ...before, status: 'on-hold' })
    })
  })

  describe('the other moves between not started, in progress, on hold and done', () => {
    // GitHub may finish or hold a task whatever its status (FR-092, FR-093, FR-099), so no move
    // among these is refused; each records only what it is.
    it.each<[TaskStatus, TaskStatus, Partial<Row>, string | null, string | null]>([
      ['not-started', 'on-hold', {}, null, null],
      ['not-started', 'done', {}, null, '2027-03-01'],
      ['on-hold', 'done', { actualStart: '2027-02-15' }, '2027-02-15', '2027-03-01'],
      [
        'done',
        'on-hold',
        { actualStart: '2027-02-15', actualFinish: '2027-02-20' },
        '2027-02-15',
        null,
      ],
      ['on-hold', 'in-progress', {}, '2027-03-01', null],
      ['done', 'in-progress', { actualFinish: '2027-02-20' }, '2027-03-01', null],
    ])(
      'sets a task %s to %s, recording only what the move is',
      async (from, to, given, actualStart, actualFinish) => {
        const id = await seed({ status: from, ...given })
        expect(await set(id, to)).toMatchObject({ status: to, actualStart, actualFinish })
      },
    )
  })

  describe('the moves it does not make', () => {
    it.each<[TaskStatus, TaskStatus, string]>([
      ['in-progress', 'not-started', 'A task cannot be set back to not started'],
      ['done', 'not-started', 'A task cannot be set back to not started'],
      [
        'in-progress',
        'cancelled',
        'A task is cancelled by cancelling it, not by setting its status',
      ],
      ['cancelled', 'in-progress', 'The status of a cancelled task cannot be set'],
      ['cancelled', 'done', 'The status of a cancelled task cannot be set'],
      ['cancelled', 'cancelled', 'A task is cancelled by cancelling it, not by setting its status'],
      ['not-started', 'not-started', 'A task cannot be set back to not started'],
    ])('refuses to set a task %s to %s, changing nothing', async (from, to, message) => {
      const id = await seed({ status: from })
      const before = await stored(id)
      const error = await refused(set(id, to), 'invalid')
      expect(error.message).toBe(message)
      expect(await stored(id)).toEqual(before)
      expect(await entries(id)).toEqual([])
    })

    it.each([['started'], [''], [null], [1], [{ status: 'done' }], [undefined]])(
      'refuses %j as a status',
      async (status) => {
        const id = await seed()
        const error = await refused(set(id, status), 'invalid')
        expect(error.message).toMatch(/^A task's status is one of not-started, in-progress/)
        expect((await stored(id))?.status).toBe('not-started')
      },
    )

    it('changes and records nothing when the task already has the status', async () => {
      const id = await seed({ status: 'on-hold', actualStart: '2027-02-15' })
      const before = await stored(id)
      expect(await set(id, 'on-hold')).toMatchObject({ status: 'on-hold' })
      expect(await stored(id)).toEqual(before)
      expect(await entries(id)).toEqual([])
    })
  })

  describe('who may set a status', () => {
    it("lets the project's admins and read-write members set it", async () => {
      for (const who of [alice, writer]) {
        const id = await seed()
        await expect(set(id, 'in-progress', by(who))).resolves.toMatchObject({
          status: 'in-progress',
        })
      }
    })

    it('lets a read-write member reopen a finished task', async () => {
      const id = await seed({
        status: 'done',
        actualStart: '2027-02-01',
        actualFinish: '2027-02-02',
      })
      await expect(set(id, 'in-progress', by(writer))).resolves.toMatchObject({
        status: 'in-progress',
      })
    })

    it('forbids a read-only member, changing nothing', async () => {
      const id = await seed()
      await refused(set(id, 'in-progress', by(reader)), 'forbidden')
      expect((await stored(id))?.status).toBe('not-started')
      expect(await entries(id)).toEqual([])
    })

    it('forbids a contributor a task they are not assigned to', async () => {
      const id = await seed({ status: 'in-progress', actualStart: '2027-02-01' })
      await services.tasks.updateTask(by(alice), id, { assignees: [writer.id] })
      const error = await refused(set(id, 'done', by(contributor)), 'forbidden')
      expect(error.message).toMatch(/assigned to/)
      expect((await stored(id))?.status).toBe('in-progress')
    })

    it('tells someone with no role in the project that it is not visible, before the status is looked at', async () => {
      const id = await seed()
      await refused(set(id, 'in-progress', by(stranger)), 'not-visible')
      await refused(set(id, 'no-such-status', by(stranger)), 'not-visible')
      expect((await stored(id))?.status).toBe('not-started')
    })

    it('refuses as not found a task that does not exist, or an id that is not one', async () => {
      for (const id of [randomUUID(), 'not-a-uuid']) {
        const error = await refused(set(id, 'in-progress'), 'not-found')
        expect(error.message).toBe('There is no such task')
      }
    })
  })

  describe('the audit log (FR-116)', () => {
    it('records each change with the status and the actual dates it changed, and their previous values', async () => {
      const id = await seed()
      await set(id, 'in-progress', by(alice, 'rest-api'))
      today = '2027-03-02'
      await set(id, 'on-hold', by(writer))
      today = '2027-03-03'
      await set(id, 'in-progress', by(writer))
      await set(id, 'done', by(writer))
      await set(id, 'in-progress', by(writer))
      const logged = await entries(id)
      expect(logged.map((entry) => [entry.action, entry.projectId, entry.details])).toEqual([
        [
          'task.status-set',
          project,
          {
            changes: { status: 'in-progress', actualStart: '2027-03-01' },
            previous: { status: 'not-started', actualStart: null },
          },
        ],
        [
          'task.status-set',
          project,
          { changes: { status: 'on-hold' }, previous: { status: 'in-progress' } },
        ],
        [
          'task.status-set',
          project,
          { changes: { status: 'in-progress' }, previous: { status: 'on-hold' } },
        ],
        [
          'task.status-set',
          project,
          {
            changes: { status: 'done', actualFinish: '2027-03-03' },
            previous: { status: 'in-progress', actualFinish: null },
          },
        ],
        [
          'task.status-set',
          project,
          {
            changes: { status: 'in-progress', actualFinish: null },
            previous: { status: 'done', actualFinish: '2027-03-03' },
          },
        ],
      ])
      expect(logged[0]).toMatchObject({ actorAccountId: alice.id, channels: ['rest-api'] })
      expect(logged[1]).toMatchObject({ actorAccountId: writer.id, channels: ['ui'] })
    })
  })

  describe('two changes at once', () => {
    it('makes them one after the other, so the second starts from what the first left', async () => {
      const id = await seed({ status: 'in-progress', actualStart: '2027-02-01' })
      await Promise.all([set(id, 'done'), set(id, 'on-hold')])
      // Whichever came second started from the status the first left, and the actual finish
      // matches the status the task ends in.
      const [first, second] = await entries(id)
      const final = await stored(id)
      const other = final?.status === 'done' ? 'on-hold' : 'done'
      expect(first).toMatchObject({
        details: { changes: { status: other }, previous: { status: 'in-progress' } },
      })
      expect(second).toMatchObject({
        details: { changes: { status: final?.status }, previous: { status: other } },
      })
      expect(final?.actualFinish).toBe(final?.status === 'done' ? '2027-03-01' : null)
    })
  })

  describe('edits of the task', () => {
    it('do not change its status or actual dates, and keep them in what they answer', async () => {
      const id = await seed()
      await set(id, 'in-progress')
      const edited = await services.tasks.updateTask(by(alice), id, { title: 'Write the guide' })
      expect(edited).toMatchObject({
        title: 'Write the guide',
        status: 'in-progress',
        actualStart: '2027-03-01',
        actualFinish: null,
      })
      expect(await services.tasks.getTask(by(reader), id)).toMatchObject({
        actualStart: '2027-03-01',
      })
    })
  })
})

/** Today's date in the deployment's time zone: the process's own, as `YYYY-MM-DD`. */
function deploymentToday(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
}

describe('test cases through the REST API', () => {
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let alice: Seeded
  let apollo: string

  beforeEach(async () => {
    // A fresh test deployment for each test case: empty database, the first system admin root,
    // and the deployment's own clock.
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
    const created = await app.inject({
      method: 'POST',
      url: `/api/projects/${apollo}/tasks`,
      headers: as(alice, 'rest-api'),
      payload,
    })
    expect(created.statusCode).toBe(201)
    return created.json<{ id: string }>().id
  }
  const setStatus = (id: string, status: string) =>
    app.inject({
      method: 'PUT',
      url: `/api/tasks/${id}/status`,
      headers: as(alice, 'rest-api'),
      payload: { status },
    })
  const readTask = async (id: string) => {
    const read = await app.inject({
      method: 'GET',
      url: `/api/tasks/${id}`,
      headers: as(alice, 'rest-api'),
    })
    expect(read.statusCode).toBe(200)
    return read.json<Record<string, unknown>>()
  }
  /** Gives the task a status and actual dates straight in the database, as a TC's given. */
  const given = (id: string, fields: Partial<Row>) =>
    x.db.update(tasks).set(fields).where(eq(tasks.id, id))

  // Each TC's "assigned to alice" is given as an assignee (SC-005). alice is Apollo's admin, so
  // whether she is assigned does not decide the outcome.

  describe('TC-032: starting a task in the tool records its actual start', () => {
    it('sets T in progress with actual start D, no actual finish and its planned dates as they were', async () => {
      const t = await createTask({
        title: 'T',
        assignees: [alice.id],
        plannedStart: '2027-03-01',
        plannedFinish: '2027-03-05',
      })
      const before = await readTask(t)
      expect(before).toMatchObject({ status: 'not-started', actualStart: null })

      const dayBefore = deploymentToday()
      const started = await setStatus(t, 'in-progress')
      const dayAfter = deploymentToday()
      expect(started.statusCode).toBe(200)

      const read = await readTask(t)
      expect(read.status).toBe('in-progress')
      expect([dayBefore, dayAfter]).toContain(read.actualStart)
      // Negative: no actual finish; planned start and finish unchanged.
      expect(read.actualFinish).toBeNull()
      expect(read.plannedStart).toBe(before.plannedStart)
      expect(read.plannedFinish).toBe(before.plannedFinish)
    })
  })

  describe('TC-033: finishing a task in the tool records its actual finish', () => {
    it('sets T done with actual finish D, its actual start and planned dates as they were', async () => {
      const t = await createTask({
        title: 'T',
        assignees: [alice.id],
        plannedStart: '2027-03-01',
        plannedFinish: '2027-03-05',
      })
      await given(t, { status: 'in-progress', actualStart: '2026-10-01' })
      const before = await readTask(t)

      const dayBefore = deploymentToday()
      const finished = await setStatus(t, 'done')
      const dayAfter = deploymentToday()
      expect(finished.statusCode).toBe(200)

      const read = await readTask(t)
      expect(read.status).toBe('done')
      expect([dayBefore, dayAfter]).toContain(read.actualFinish)
      // Negative: actual start, planned start and planned finish unchanged.
      expect(read.actualStart).toBe('2026-10-01')
      expect(read.plannedStart).toBe(before.plannedStart)
      expect(read.plannedFinish).toBe(before.plannedFinish)
    })
  })

  describe('TC-034: putting a task on hold leaves its planned finish and load as they were', () => {
    it('sets T on hold with its planned start, finish and duration unchanged, and no other task changed', async () => {
      const t = await createTask({
        title: 'T',
        assignees: [alice.id],
        aiShare: 0,
        plannedStart: '2027-03-01',
        durationWorkingDays: 5,
        plannedFinish: '2027-03-05',
      })
      await given(t, { status: 'in-progress', actualStart: '2027-03-01' })
      const other = await createTask({ title: 'Other', plannedStart: '2027-03-02' })
      const before = await readTask(t)
      const otherBefore = await readTask(other)
      expect(before.plannedFinish).toBe('2027-03-05')

      const held = await setStatus(t, 'on-hold')
      expect(held.statusCode).toBe(200)

      const read = await readTask(t)
      expect(read.status).toBe('on-hold')
      expect(read.plannedFinish).toBe('2027-03-05')
      // Negative: planned start and duration unchanged, and so is every other field.
      expect(read.plannedStart).toBe('2027-03-01')
      expect(read.durationWorkingDays).toBe(5)
      expect(read).toEqual({ ...before, status: 'on-hold' })
      // Negative: no other task in Apollo changes.
      expect(await readTask(other)).toEqual(otherBefore)
    })

    // Pending: alice's load of 100% on each day from 2027-03-01 to 2027-03-05 cannot be read yet.
    // It needs the global calendar and alice's capacity (SC-008), her assignment to T (SC-005)
    // and the daily person load (SC-006). The planned finish is given here rather than derived
    // from the duration, which is the scheduler's (SC-004). What this test shows is that putting
    // T on hold changes nothing a load is computed from: its dates, duration and AI share.
  })
})
