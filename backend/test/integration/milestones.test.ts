import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { auditLog, tasks } from '../../src/db/schema.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { Task, TaskInput } from '../../src/service/tasks.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// Milestones in the task record module (SC-001: FR-190, FR-191, FR-194) against a real
// PostgreSQL: the rules through the service layer, then their test cases through the REST API.

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const by = (account: Seeded): Caller => ({ accountId: account.id, channel: 'ui' })

const FIXED = { variant: 'fixed-date', date: '2027-03-12' } as const
const FLOATING = { variant: 'floating' } as const

const NO_TIME =
  'A milestone takes no time: it has no planned start or finish, duration, effort or AI share'

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

describe('milestones in the task service', () => {
  let x: TestDatabase
  let services: Services
  let alice: Seeded
  let writer: Seeded
  let reader: Seeded
  let project: string

  beforeAll(async () => {
    x = await createTestDatabase()
    services = createServices(x.db)
    alice = await seedAccount(x.db, { username: 'alice' })
    writer = await seedAccount(x.db, { username: 'writer' })
    reader = await seedAccount(x.db, { username: 'reader' })
    project = await seedProject(x.db, alice, 'Apollo')
    await grantRole(x.db, writer, project, 'read-write')
    await grantRole(x.db, reader, project, 'read-only')
  })

  afterAll(async () => {
    await x?.drop()
  })

  const create = (task: TaskInput, caller: Caller = by(alice)) =>
    services.tasks.createTask(caller, project, task)
  const update = (id: string, changes: TaskInput) =>
    services.tasks.updateTask(by(alice), id, changes)
  const stored = async (id: string) => (await x.db.select().from(tasks).where(eq(tasks.id, id)))[0]
  const count = async () => (await x.db.select().from(tasks)).length
  const entries = (id: string) =>
    x.db.select().from(auditLog).where(eq(auditLog.subjectId, id)).orderBy(auditLog.id)

  describe('createTask', () => {
    it('makes a fixed-date milestone, with its date and nothing that takes time', async () => {
      const task = await create({ title: 'Launch', milestone: FIXED })
      expect(task).toEqual({
        id: expect.any(String),
        projectId: project,
        title: 'Launch',
        description: '',
        status: 'not-started',
        plannedStart: null,
        plannedFinish: null,
        durationWorkingDays: null,
        effort: null,
        aiShare: null,
        milestone: { variant: 'fixed-date', date: '2027-03-12' },
        githubIssue: null,
      })
      expect(await stored(task.id)).toMatchObject({
        milestoneVariant: 'fixed-date',
        milestoneDate: '2027-03-12',
      })
    })

    it('makes a floating milestone with no date, given none or given null', async () => {
      for (const milestone of [FLOATING, { variant: 'floating', date: null }]) {
        const task = await create({ title: 'Docs ready', milestone })
        expect(task.milestone).toEqual({ variant: 'floating', date: null })
        expect(await stored(task.id)).toMatchObject({
          milestoneVariant: 'floating',
          milestoneDate: null,
        })
      }
    })

    it('makes a task that is not a milestone when none is given, or null is', async () => {
      expect((await create({ title: 'Write guide' })).milestone).toBeNull()
      expect((await create({ title: 'Write guide', milestone: null })).milestone).toBeNull()
    })

    it('takes null for the fields a milestone does not have', async () => {
      const task = await create({
        title: 'Launch',
        milestone: FIXED,
        plannedStart: null,
        plannedFinish: null,
        durationWorkingDays: null,
        effort: null,
        aiShare: null,
      })
      expect(task.milestone).toEqual(FIXED)
    })

    it.each([
      ['a planned start', { plannedStart: '2027-03-12' }],
      ['a planned finish', { plannedFinish: '2027-03-12' }],
      ['a duration', { durationWorkingDays: 2 }],
      ['an effort', { effort: 3 }],
      ['an effort of zero', { effort: 0 }],
      ['an AI share', { aiShare: 50 }],
      ['an AI share of zero', { aiShare: 0 }],
    ])('refuses a milestone with %s, of either variant, and makes nothing', async (_, extra) => {
      const before = await count()
      for (const milestone of [FIXED, FLOATING]) {
        const error = await refused(create({ title: 'Late', milestone, ...extra }), 'invalid')
        expect(error.message).toBe(NO_TIME)
      }
      expect(await count()).toBe(before)
    })

    it.each([
      ['a variant that is neither', { variant: 'pinned', date: '2027-03-12' }, 'variant'],
      ['no variant', { date: '2027-03-12' }, 'variant'],
      ['text', 'floating', 'variant'],
      ['a list', ['fixed-date', '2027-03-12'], 'variant'],
      ['a number', 1, 'variant'],
      ['true', true, 'variant'],
      ['a fixed date with no date', { variant: 'fixed-date' }, 'pinned'],
      ['a fixed date with a null date', { variant: 'fixed-date', date: null }, 'pinned'],
      ['a fixed date that is no date', { variant: 'fixed-date', date: '2027-02-30' }, 'pinned'],
      ['a fixed date that is not text', { variant: 'fixed-date', date: 20270312 }, 'pinned'],
      ['a floating milestone with a date', { variant: 'floating', date: '2027-03-12' }, 'no date'],
      [
        'a floating milestone with a date of another type',
        { variant: 'floating', date: 0 },
        'no date',
      ],
    ])('refuses %s as a milestone, and makes nothing', async (_, milestone, words) => {
      const before = await count()
      const error = await refused(create({ title: 'Odd', milestone }), 'invalid')
      expect(error.message).toContain(words)
      expect(await count()).toBe(before)
    })

    it('records the kind and the date in the creation in the audit log', async () => {
      const task = await create({ title: 'Launch', milestone: FIXED })
      const [entry] = await entries(task.id)
      expect(entry?.details).toMatchObject({
        milestoneVariant: 'fixed-date',
        milestoneDate: '2027-03-12',
      })
    })

    it('refuses the read-only role, before looking at the milestone', async () => {
      const before = await count()
      await refused(create({ title: 'Launch', milestone: 'nonsense' }, by(reader)), 'forbidden')
      expect(await count()).toBe(before)
    })
  })

  describe('updateTask', () => {
    let launch: Task
    let docs: Task
    let build: Task

    beforeEach(async () => {
      launch = await create({ title: 'Launch', milestone: FIXED })
      docs = await create({ title: 'Docs ready', milestone: FLOATING })
      build = await create({ title: 'Build', durationWorkingDays: 3, effort: 2 })
    })

    it("changes a fixed-date milestone's date, and records it and the one before", async () => {
      const moved = await services.tasks.updateTask(by(writer), launch.id, {
        milestone: { variant: 'fixed-date', date: '2027-03-19' },
      })
      expect(moved.milestone).toEqual({ variant: 'fixed-date', date: '2027-03-19' })
      expect(await stored(launch.id)).toMatchObject({ milestoneDate: '2027-03-19' })
      const [, entry] = await entries(launch.id)
      expect(entry?.details).toEqual({
        changes: { milestoneDate: '2027-03-19' },
        previous: { milestoneDate: '2027-03-12' },
      })
    })

    it('changes and records nothing when the milestone given is the one it is', async () => {
      expect(await update(launch.id, { milestone: FIXED })).toEqual(launch)
      expect(await update(docs.id, { milestone: FLOATING })).toEqual(docs)
      expect(await update(build.id, { milestone: null })).toEqual(build)
      for (const id of [launch.id, docs.id, build.id]) expect(await entries(id)).toHaveLength(1)
    })

    it("edits a milestone's other fields, and keeps it a milestone", async () => {
      const edited = await update(docs.id, { title: 'Docs published', durationWorkingDays: null })
      expect(edited).toMatchObject({ title: 'Docs published', milestone: docs.milestone })
    })

    it.each([
      ['a task into a milestone', () => build.id, FIXED, 'cannot be made a milestone'],
      ['a task into a floating milestone', () => build.id, FLOATING, 'cannot be made a milestone'],
      ['a milestone into a task', () => launch.id, null, 'cannot be made a task'],
      ['a floating milestone into a task', () => docs.id, null, 'cannot be made a task'],
      ['a fixed-date milestone into a floating one', () => launch.id, FLOATING, 'variant'],
      [
        'a floating milestone into a fixed-date one',
        () => docs.id,
        { variant: 'fixed-date', date: '2027-04-01' },
        'variant',
      ],
    ])('refuses to turn %s, and changes nothing', async (_, id, milestone, words) => {
      const before = await stored(id())
      const error = await refused(update(id(), { milestone }), 'invalid')
      expect(error.message).toContain(words)
      expect(await stored(id())).toEqual(before)
      expect(await entries(id())).toHaveLength(1)
    })

    it('refuses a fixed date that is no date, and keeps the one it has', async () => {
      await refused(update(launch.id, { milestone: { variant: 'fixed-date' } }), 'invalid')
      await refused(
        update(launch.id, { milestone: { variant: 'fixed-date', date: 'next week' } }),
        'invalid',
      )
      expect((await stored(launch.id))?.milestoneDate).toBe('2027-03-12')
    })

    it.each([
      ['a planned start', { plannedStart: '2027-03-12' }],
      ['a planned finish', { plannedFinish: '2027-03-12' }],
      ['a duration', { durationWorkingDays: 2 }],
      ['an effort', { effort: 3 }],
      ['an AI share', { aiShare: 50 }],
    ])('refuses to give a milestone %s, and changes nothing', async (_, changes) => {
      for (const milestone of [launch, docs]) {
        const before = await stored(milestone.id)
        const error = await refused(update(milestone.id, changes), 'invalid')
        expect(error.message).toBe(NO_TIME)
        expect(await stored(milestone.id)).toEqual(before)
      }
    })

    it('refuses a new date given together with a duration, and keeps the old date', async () => {
      await refused(
        update(launch.id, {
          milestone: { variant: 'fixed-date', date: '2027-03-19' },
          durationWorkingDays: 1,
        }),
        'invalid',
      )
      expect((await stored(launch.id))?.milestoneDate).toBe('2027-03-12')
    })

    it('refuses the read-only role, and leaves the date as it is', async () => {
      await refused(
        services.tasks.updateTask(by(reader), launch.id, {
          milestone: { variant: 'fixed-date', date: '2027-03-19' },
        }),
        'forbidden',
      )
      expect((await stored(launch.id))?.milestoneDate).toBe('2027-03-12')
    })
  })

  describe('reading', () => {
    it('reads each kind back as it was made, alone and in the project list', async () => {
      const other = await seedProject(x.db, alice, 'Gemini')
      const made = [
        await services.tasks.createTask(by(alice), other, { title: 'Launch', milestone: FIXED }),
        await services.tasks.createTask(by(alice), other, { title: 'Docs', milestone: FLOATING }),
        await services.tasks.createTask(by(alice), other, { title: 'Write guide' }),
      ]
      expect(await services.tasks.listTasks(by(alice), other)).toEqual(made)
      for (const task of made)
        expect(await services.tasks.getTask(by(alice), task.id)).toEqual(task)
    })
  })

  describe('the table', () => {
    // The table holds the rules too, so that nothing written past the service breaks them.
    it.each([
      ['a fixed-date milestone with no date', sql`'fixed-date', null, null`],
      ['a floating milestone with a date', sql`'floating', '2027-03-12', null`],
      ['a task that is not a milestone with a date', sql`null, '2027-03-12', null`],
      ['a milestone with an effort', sql`'floating', null, 3`],
    ])('refuses %s', async (_, values) => {
      await expect(
        x.db.execute(
          sql`insert into tasks (project_id, title, milestone_variant, milestone_date, effort)
              values (${project}, 'Raw', ${values})`,
        ),
      ).rejects.toMatchObject({ cause: { constraint: expect.stringMatching(/^tasks_milestone_/) } })
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
    // The TCs' global calendar (Saturday and Sunday off, no company holidays) is not yet held by
    // the tool (SC-008); none of these outcomes depends on it.
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

  const createTask = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/api/projects/${apollo}/tasks`,
      headers: as(alice, 'rest-api'),
      payload,
    })
  const editTask = (id: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      headers: as(alice, 'rest-api'),
      payload,
    })
  const readTask = async (id: string) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${id}`,
      headers: as(alice, 'rest-api'),
    })
    expect(response.statusCode).toBe(200)
    return response.json<Task>()
  }
  const made = async (payload: Record<string, unknown>) => {
    const response = await createTask(payload)
    expect(response.statusCode).toBe(201)
    return response.json<Task>().id
  }

  describe('TC-264: a task is created as a fixed-date or a floating milestone', () => {
    it('reads Launch back as fixed-date, Docs ready as floating, Write guide as no milestone', async () => {
      const launch = await made({
        title: 'Launch',
        milestone: { variant: 'fixed-date', date: '2027-03-12' },
      })
      const docs = await made({ title: 'Docs ready', milestone: { variant: 'floating' } })
      const guide = await made({ title: 'Write guide' })

      expect((await readTask(launch)).milestone).toEqual({
        variant: 'fixed-date',
        date: '2027-03-12',
      })
      // A floating milestone has no date of its own.
      expect(await readTask(docs)).toMatchObject({
        milestone: { variant: 'floating', date: null },
        plannedStart: null,
        plannedFinish: null,
      })
      expect((await readTask(guide)).milestone).toBeNull()

      // Negative: neither milestone is a normal task, nor Write guide a milestone; Launch is not
      // floating, nor Docs ready fixed-date.
      expect((await readTask(launch)).milestone?.variant).not.toBe('floating')
      expect((await readTask(docs)).milestone?.variant).not.toBe('fixed-date')
    })
  })

  describe('TC-265: a milestone with a duration, effort or AI share is rejected', () => {
    it('rejects all six requests, and leaves Launch as the only task, unchanged', async () => {
      const launch = await made({
        title: 'Launch',
        milestone: { variant: 'fixed-date', date: '2027-03-12' },
      })
      const april = { variant: 'fixed-date', date: '2027-04-01' }
      const takesTime = [{ durationWorkingDays: 2 }, { effort: 3 }, { aiShare: 50 }]

      for (const extra of takesTime) {
        const response = await createTask({ title: 'Later', milestone: april, ...extra })
        expect(response.statusCode).toBe(400)
      }
      for (const extra of takesTime) {
        const response = await editTask(launch, extra)
        expect(response.statusCode).toBe(400)
      }

      const listed = await app.inject({
        method: 'GET',
        url: `/api/projects/${apollo}/tasks`,
        headers: as(alice, 'rest-api'),
      })
      expect(listed.json<Task[]>().map((task) => task.id)).toEqual([launch])
      expect(await readTask(launch)).toMatchObject({
        milestone: { variant: 'fixed-date', date: '2027-03-12' },
        durationWorkingDays: null,
        effort: null,
        aiShare: null,
        // No date other than 2027-03-12.
        plannedStart: null,
        plannedFinish: null,
      })
      // Negative: no milestone pinned to 2027-04-01 is made, in the list or in the table.
      expect(
        await x.db.select().from(tasks).where(eq(tasks.milestoneDate, '2027-04-01')),
      ).toHaveLength(0)
    })
  })

  describe("TC-268: a task's kind and a milestone's variant cannot be changed", () => {
    it('rejects the four changes, accepts the new date, and keeps every kind and variant', async () => {
      const build = await made({ title: 'Build' })
      const launch = await made({
        title: 'Launch',
        milestone: { variant: 'fixed-date', date: '2027-03-12' },
      })
      const docs = await made({ title: 'Docs ready', milestone: { variant: 'floating' } })

      const rejected = [
        [build, { milestone: { variant: 'floating' } }],
        [launch, { milestone: null }],
        [launch, { milestone: { variant: 'floating' } }],
        [docs, { milestone: { variant: 'fixed-date', date: '2027-04-01' } }],
      ] as const
      for (const [id, change] of rejected) {
        expect((await editTask(id, change)).statusCode).toBe(400)
      }
      const accepted = await editTask(launch, {
        milestone: { variant: 'fixed-date', date: '2027-03-19' },
      })
      expect(accepted.statusCode).toBe(200)

      expect((await readTask(build)).milestone).toBeNull()
      expect((await readTask(launch)).milestone).toEqual({
        variant: 'fixed-date',
        date: '2027-03-19',
      })
      expect((await readTask(docs)).milestone).toEqual({ variant: 'floating', date: null })
      // Negative: no kind or variant differs from what it was made with, in the table either.
      const rows = await x.db
        .select({ id: tasks.id, variant: tasks.milestoneVariant })
        .from(tasks)
        .where(eq(tasks.projectId, apollo))
      expect(Object.fromEntries(rows.map((row) => [row.id, row.variant]))).toEqual({
        [build]: null,
        [launch]: 'fixed-date',
        [docs]: 'floating',
      })
    })
  })
})
