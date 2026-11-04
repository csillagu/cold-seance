import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { auditLog, tasks } from '../../src/db/schema.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import { MAX_DURATION_WORKING_DAYS, type TaskInput, type Task } from '../../src/service/tasks.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The task record module (SC-001) against a real PostgreSQL: its rules through the service layer,
// then the test cases of FR-001, FR-002 and FR-003 through the REST API.

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

describe('the task service', () => {
  let x: TestDatabase
  let services: Services
  let alice: Seeded
  let reader: Seeded
  let contributor: Seeded
  let writer: Seeded
  let stranger: Seeded
  let project: string

  beforeAll(async () => {
    x = await createTestDatabase()
    services = createServices(x.db)
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

  afterAll(async () => {
    await x?.drop()
  })

  const create = (task: TaskInput, caller: Caller = by(alice)) =>
    services.tasks.createTask(caller, project, task)
  const stored = async (id: string) => (await x.db.select().from(tasks).where(eq(tasks.id, id)))[0]
  const entries = (id: string) =>
    x.db.select().from(auditLog).where(eq(auditLog.subjectId, id)).orderBy(auditLog.id)

  describe('createTask', () => {
    it('creates a task with every field given, not started, with no linked GitHub issue', async () => {
      const task = await create({
        title: 'Write install guide',
        description: 'Steps for a fresh install',
        plannedStart: '2027-03-01',
        plannedFinish: '2027-03-03',
        durationWorkingDays: 3,
        effort: 5,
        aiShare: 0,
      })
      expect(task).toEqual({
        id: expect.any(String),
        projectId: project,
        title: 'Write install guide',
        description: 'Steps for a fresh install',
        status: 'not-started',
        plannedStart: '2027-03-01',
        plannedFinish: '2027-03-03',
        durationWorkingDays: 3,
        effort: 5,
        aiShare: 0,
        milestone: null,
        eligibility: null,
        assignees: [],
        actualStart: null,
        actualFinish: null,
        githubIssue: null,
      })
      expect(await stored(task.id)).toMatchObject({ projectId: project, title: task.title })
    })

    it('takes a task with a title only, as an unscheduled task with no other field set', async () => {
      const task = await create({ title: 'Triage' })
      expect(task).toMatchObject({
        description: '',
        plannedStart: null,
        plannedFinish: null,
        durationWorkingDays: null,
        effort: null,
        aiShare: null,
        status: 'not-started',
      })
    })

    it('takes a duration without dates, and a start without a finish', async () => {
      expect(await create({ title: 'Sized', durationWorkingDays: 4 })).toMatchObject({
        plannedStart: null,
        durationWorkingDays: 4,
      })
      expect(await create({ title: 'Started', plannedStart: '2027-01-04' })).toMatchObject({
        plannedStart: '2027-01-04',
        plannedFinish: null,
      })
    })

    it('trims the title and keeps it in one Unicode form', async () => {
      const task = await create({ title: '  Café  ' })
      expect(task.title).toBe('Café')
    })

    it('takes the extremes of each range', async () => {
      const task = await create({
        title: 'Edges',
        plannedStart: '2027-02-28',
        plannedFinish: '2027-02-28',
        durationWorkingDays: MAX_DURATION_WORKING_DAYS,
        effort: 0.5,
        aiShare: 100,
      })
      expect(task).toMatchObject({
        plannedFinish: '2027-02-28',
        durationWorkingDays: MAX_DURATION_WORKING_DAYS,
        effort: 0.5,
        aiShare: 100,
      })
      expect(await create({ title: 'Leap', plannedStart: '2028-02-29', effort: 0 })).toMatchObject({
        plannedStart: '2028-02-29',
        effort: 0,
      })
    })

    it.each<[string, Record<string, unknown>, string]>([
      ['an empty title', { title: '' }, 'A task title is required'],
      ['a title of spaces only', { title: '   ' }, 'A task title is required'],
      ['a title that is not text', { title: 7 }, 'A task title is required'],
      ['a description that is not text', { description: 7 }, 'A task description is text'],
      [
        'a fractional duration',
        { durationWorkingDays: 2.5 },
        "A task's duration is a whole number of working days, at least 1",
      ],
      [
        'a duration of zero',
        { durationWorkingDays: 0 },
        "A task's duration is a whole number of working days, at least 1",
      ],
      [
        'a negative duration',
        { durationWorkingDays: -2 },
        "A task's duration is a whole number of working days, at least 1",
      ],
      [
        'a duration given as text',
        { durationWorkingDays: '3' },
        "A task's duration is a whole number of working days, at least 1",
      ],
      [
        'a duration too large to hold',
        { durationWorkingDays: MAX_DURATION_WORKING_DAYS + 1 },
        "A task's duration is a whole number of working days, at least 1",
      ],
      [
        'a start that is not a date',
        { plannedStart: 'next monday' },
        "A task's planned start is a date, YYYY-MM-DD",
      ],
      [
        'a start on a day that does not exist',
        { plannedStart: '2027-02-29' },
        "A task's planned start is a date, YYYY-MM-DD",
      ],
      [
        'a start in month 13',
        { plannedStart: '2027-13-01' },
        "A task's planned start is a date, YYYY-MM-DD",
      ],
      [
        'a start in year 0',
        { plannedStart: '0000-01-01' },
        "A task's planned start is a date, YYYY-MM-DD",
      ],
      [
        'a start with a time',
        { plannedStart: '2027-03-01T00:00:00Z' },
        "A task's planned start is a date, YYYY-MM-DD",
      ],
      [
        'a start given as a number',
        { plannedStart: 20270301 },
        "A task's planned start is a date, YYYY-MM-DD",
      ],
      [
        'a finish that is not a date',
        { plannedFinish: '2027-3-1' },
        "A task's planned finish is a date, YYYY-MM-DD",
      ],
      [
        'a finish before the start',
        { plannedStart: '2027-03-02', plannedFinish: '2027-03-01' },
        "A task's planned finish cannot come before its planned start",
      ],
      ['a negative effort', { effort: -1 }, "A task's effort is a number of zero or more"],
      [
        'an effort that is not a number',
        { effort: '5' },
        "A task's effort is a number of zero or more",
      ],
      [
        'an infinite effort',
        { effort: Number.POSITIVE_INFINITY },
        "A task's effort is a number of zero or more",
      ],
      [
        'an AI share over 100',
        { aiShare: 100.5 },
        "A task's AI share is a percentage from 0 to 100",
      ],
      ['a negative AI share', { aiShare: -1 }, "A task's AI share is a percentage from 0 to 100"],
      [
        'an AI share that is not a number',
        { aiShare: Number.NaN },
        "A task's AI share is a percentage from 0 to 100",
      ],
    ])('refuses %s and creates nothing', async (_, fields, message) => {
      const before = await services.tasks.listTasks(by(alice), project)
      const error = await refused(create({ title: 'Bad', ...fields }), 'invalid')
      expect(error.message).toBe(message)
      expect(await services.tasks.listTasks(by(alice), project)).toEqual(before)
    })

    it('refuses a task given no title at all', async () => {
      const error = await refused(services.tasks.createTask(by(alice), project, {}), 'invalid')
      expect(error.message).toBe('A task title is required')
    })

    it('lets the read-write role create a task', async () => {
      const task = await create({ title: 'By writer' }, by(writer))
      expect(task.projectId).toBe(project)
    })

    it.each([
      ['the read-only role', () => reader],
      ['the contributor role', () => contributor],
    ])('refuses %s, before looking at the fields, and creates nothing', async (_, who) => {
      const before = await services.tasks.listTasks(by(alice), project)
      const error = await refused(create({ title: '' }, by(who())), 'forbidden')
      expect(error.message).toBe(
        "Only the project's read-write members and admins can edit its plan",
      )
      expect(await services.tasks.listTasks(by(alice), project)).toEqual(before)
    })

    it('tells someone with no role in the project, even a system admin, that it is not visible', async () => {
      const error = await refused(create({ title: 'Nope' }, by(stranger)), 'not-visible')
      expect(error.message).toBe('This project is not visible to you')
    })

    it('answers a project that does not exist, or an id that is not one, as not visible', async () => {
      for (const projectId of [randomUUID(), 'apollo']) {
        const error = await refused(
          services.tasks.createTask(by(alice), projectId, { title: 'X' }),
          'not-visible',
        )
        expect(error.message).toBe('This project is not visible to you')
      }
    })

    it('records the creation in the project’s part of the audit log, with its channel', async () => {
      const task = await create({ title: 'Logged', durationWorkingDays: 2 }, by(writer, 'rest-api'))
      expect(await entries(task.id)).toMatchObject([
        {
          actorAccountId: writer.id,
          channels: ['rest-api'],
          projectId: project,
          action: 'task.created',
          subjectType: 'task',
          details: {
            title: 'Logged',
            description: '',
            plannedStart: null,
            plannedFinish: null,
            durationWorkingDays: 2,
            effort: null,
            aiShare: null,
          },
        },
      ])
    })
  })

  describe('updateTask', () => {
    let task: Task

    beforeEach(async () => {
      task = await create({
        title: 'Draft schema',
        plannedStart: '2027-03-04',
        durationWorkingDays: 3,
        effort: 2,
        aiShare: 10,
      })
    })

    it('changes the given fields and leaves the others as they are', async () => {
      const updated = await services.tasks.updateTask(by(writer), task.id, {
        title: ' Draft the schema ',
        description: 'Tables and keys',
        durationWorkingDays: 5,
      })
      expect(updated).toEqual({
        ...task,
        title: 'Draft the schema',
        description: 'Tables and keys',
        durationWorkingDays: 5,
      })
      expect(await services.tasks.getTask(by(alice), task.id)).toEqual(updated)
    })

    it('clears a field given as null, so a task can be made unscheduled', async () => {
      const updated = await services.tasks.updateTask(by(alice), task.id, {
        plannedStart: null,
        durationWorkingDays: null,
        effort: null,
        aiShare: null,
      })
      expect(updated).toMatchObject({
        plannedStart: null,
        plannedFinish: null,
        durationWorkingDays: null,
        effort: null,
        aiShare: null,
      })
    })

    it('records what changed, and what it was, in the audit log', async () => {
      await services.tasks.updateTask(by(alice, 'rest-api'), task.id, {
        title: 'Draft schema',
        effort: 4,
        aiShare: 10,
      })
      const [, updated] = await entries(task.id)
      expect(updated).toMatchObject({
        actorAccountId: alice.id,
        channels: ['rest-api'],
        projectId: project,
        action: 'task.updated',
        details: { changes: { effort: 4 }, previous: { effort: 2 } },
      })
    })

    it('changes and records nothing when nothing given differs', async () => {
      expect(await services.tasks.updateTask(by(alice), task.id, {})).toEqual(task)
      expect(
        await services.tasks.updateTask(by(alice), task.id, { title: 'Draft schema', effort: 2 }),
      ).toEqual(task)
      expect(await entries(task.id)).toHaveLength(1)
    })

    it('refuses a fractional duration and keeps the whole one', async () => {
      const error = await refused(
        services.tasks.updateTask(by(alice), task.id, { durationWorkingDays: 2.5 }),
        'invalid',
      )
      expect(error.message).toBe("A task's duration is a whole number of working days, at least 1")
      expect((await stored(task.id))?.durationWorkingDays).toBe(3)
    })

    it('refuses a null title', async () => {
      const error = await refused(
        services.tasks.updateTask(by(alice), task.id, { title: null }),
        'invalid',
      )
      expect(error.message).toBe('A task title is required')
    })

    it('refuses a finish before the start, whether the start or the finish is changed', async () => {
      await services.tasks.updateTask(by(alice), task.id, { plannedFinish: '2027-03-08' })
      await refused(
        services.tasks.updateTask(by(alice), task.id, { plannedStart: '2027-03-09' }),
        'invalid',
      )
      await refused(
        services.tasks.updateTask(by(alice), task.id, { plannedFinish: '2027-03-03' }),
        'invalid',
      )
      expect(await stored(task.id)).toMatchObject({
        plannedStart: '2027-03-04',
        plannedFinish: '2027-03-08',
      })
    })

    it('does not check fields that were not given', async () => {
      // A stored value is not checked again: only what the edit gives.
      const updated = await services.tasks.updateTask(by(alice), task.id, { description: 'x' })
      expect(updated.description).toBe('x')
    })

    it.each([
      ['the read-only role', () => reader],
      ['the contributor role', () => contributor],
    ])('refuses %s and changes nothing', async (_, who) => {
      await refused(
        services.tasks.updateTask(by(who()), task.id, { title: 'Hijacked' }),
        'forbidden',
      )
      expect((await stored(task.id))?.title).toBe('Draft schema')
    })

    it('tells someone with no role in the project that it is not visible', async () => {
      await refused(
        services.tasks.updateTask(by(stranger), task.id, { title: 'Hijacked' }),
        'not-visible',
      )
      expect((await stored(task.id))?.title).toBe('Draft schema')
    })

    it('refuses a task that does not exist, or an id that is not one, as not found', async () => {
      const error = await refused(
        services.tasks.updateTask(by(alice), randomUUID(), { title: 'X' }),
        'not-found',
      )
      expect(error.message).toBe('There is no such task')
      await refused(
        services.tasks.updateTask(by(alice), "1' or '1'='1", { title: 'X' }),
        'not-found',
      )
    })

    it('applies two concurrent edits of one task one after the other', async () => {
      await Promise.all([
        services.tasks.updateTask(by(alice), task.id, { effort: 7 }),
        services.tasks.updateTask(by(writer), task.id, { aiShare: 50 }),
      ])
      expect(await stored(task.id)).toMatchObject({ effort: 7, aiShare: 50 })
      expect(await entries(task.id)).toHaveLength(3)
    })
  })

  describe('getTask', () => {
    it('lets every role in the project read a task', async () => {
      const task = await create({ title: 'Readable' })
      for (const who of [alice, reader, contributor, writer]) {
        expect(await services.tasks.getTask(by(who), task.id)).toEqual(task)
      }
    })

    it('tells someone with no role in its project that the project is not visible', async () => {
      const task = await create({ title: 'Hidden' })
      const error = await refused(services.tasks.getTask(by(stranger), task.id), 'not-visible')
      expect(error.message).toBe('This project is not visible to you')
    })

    it('refuses a task that does not exist as not found', async () => {
      for (const taskId of [randomUUID(), 'not-a-task']) {
        const error = await refused(services.tasks.getTask(by(alice), taskId), 'not-found')
        expect(error.message).toBe('There is no such task')
      }
    })
  })

  describe('listTasks', () => {
    it('lists the project’s tasks, scheduled and unscheduled together, in the order created', async () => {
      const other = await seedProject(x.db, alice, 'Gemini')
      const first = await services.tasks.createTask(by(alice), other, {
        title: 'Scheduled',
        plannedStart: '2027-03-01',
      })
      const second = await services.tasks.createTask(by(alice), other, { title: 'Unscheduled' })
      const third = await services.tasks.createTask(by(alice), other, {
        title: 'Sized only',
        durationWorkingDays: 1,
      })
      expect(await services.tasks.listTasks(by(alice), other)).toEqual([first, second, third])
    })

    it('lists only the tasks of the project asked for', async () => {
      const empty = await seedProject(x.db, alice, 'Empty')
      expect(await services.tasks.listTasks(by(alice), empty)).toEqual([])
    })

    it('lets every role read the list, and tells anyone else the project is not visible', async () => {
      for (const who of [reader, contributor, writer]) {
        await expect(services.tasks.listTasks(by(who), project)).resolves.toBeInstanceOf(Array)
      }
      await refused(services.tasks.listTasks(by(stranger), project), 'not-visible')
      await refused(services.tasks.listTasks(by(alice), randomUUID()), 'not-visible')
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

  const createTask = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/api/projects/${apollo}/tasks`,
      headers: as(alice, 'rest-api'),
      payload,
    })
  const readTask = (id: string) =>
    app.inject({ method: 'GET', url: `/api/tasks/${id}`, headers: as(alice, 'rest-api') })
  const tasksOfApollo = () => x.db.select().from(tasks).where(eq(tasks.projectId, apollo))

  describe('TC-001: a task is stored with every minimum field', () => {
    it('reads back every value given, the project, a status and an empty linked GitHub issue', async () => {
      const bob = await seedAccount(x.db, { username: 'bob' })
      await grantRole(x.db, bob, apollo, 'read-write')

      const created = await createTask({
        title: 'Write install guide',
        description: 'Steps for a fresh install',
        plannedStart: '2027-03-01',
        durationWorkingDays: 3,
        effort: 5,
        aiShare: 0,
        eligibility: { any: [alice.id, bob.id] },
        assignees: [alice.id],
      })
      expect(created.statusCode).toBe(201)
      const { id } = created.json<{ id: string }>()
      expect(id).toEqual(expect.any(String))

      const read = await readTask(id)
      expect(read.statusCode).toBe(200)
      const task = read.json<Record<string, unknown>>()
      // "A planned finish": derived from the start and duration by the scheduler (FR-144,
      // SC-004), so only its field is asserted until it lands. Pending, see below.
      expect(task).toHaveProperty('plannedFinish')
      const { plannedFinish: _derived, ...given } = task
      expect(given).toEqual({
        id,
        projectId: apollo,
        title: 'Write install guide',
        description: 'Steps for a fresh install',
        status: expect.any(String),
        plannedStart: '2027-03-01',
        durationWorkingDays: 3,
        effort: 5,
        aiShare: 0,
        milestone: null,
        // Eligibility `alice OR bob`; assigned people exactly [alice].
        eligibility: { any: [alice.id, bob.id] },
        assignees: [alice.id],
        actualStart: null,
        actualFinish: null,
        githubIssue: null,
      })
      // The linked GitHub issue field is present and empty.
      expect(task).toHaveProperty('githubIssue', null)
      // Negative: no other task is created in Apollo.
      expect(await tasksOfApollo()).toHaveLength(1)
    })

    // Pending: TC-001's derived planned finish comes with the scheduler (FR-144, SC-004). This test
    // grows to cover it when that lands.
  })

  describe("TC-002: a task's duration is held in whole working days", () => {
    it('reads back a duration of 3 working days, and stores no fractional duration', async () => {
      const created = await createTask({
        title: 'Draft schema',
        plannedStart: '2027-03-04',
        durationWorkingDays: 3,
      })
      expect(created.statusCode).toBe(201)
      const { id } = created.json<{ id: string }>()

      const read = await readTask(id)
      expect(read.json()).toMatchObject({ durationWorkingDays: 3, plannedStart: '2027-03-04' })

      const fractional = await app.inject({
        method: 'PATCH',
        url: `/api/tasks/${id}`,
        headers: as(alice, 'rest-api'),
        payload: { durationWorkingDays: 2.5 },
      })
      // Not stated whether a fractional duration is rejected or rounded; it is rejected here.
      expect(fractional.statusCode).toBe(400)
      const after = await readTask(id)
      expect(after.json<{ durationWorkingDays: number }>().durationWorkingDays).not.toBe(2.5)
      expect(after.json()).toMatchObject({ durationWorkingDays: 3 })
      expect((await tasksOfApollo())[0]?.durationWorkingDays).toBe(3)
    })

    it('offers no unit for the duration other than working days', async () => {
      // A duration in any other unit is not taken: the field is dropped and no duration is held.
      for (const field of ['duration', 'durationDays', 'durationCalendarDays', 'durationHours']) {
        const response = await createTask({ title: `In ${field}`, [field]: 3 })
        expect(response.json()).toMatchObject({ durationWorkingDays: null })
      }
      expect((await tasksOfApollo()).map((task) => task.durationWorkingDays)).toEqual([
        null,
        null,
        null,
        null,
      ])
      const spec = await app.inject({
        method: 'GET',
        url: '/api/openapi.json',
        headers: as(alice, 'rest-api'),
      })
      const body = spec.json<{
        paths: Record<
          string,
          Record<
            string,
            {
              requestBody: {
                content: Record<string, { schema: { properties: Record<string, unknown> } }>
              }
            }
          >
        >
      }>()
      const properties = Object.keys(
        body.paths['/api/projects/{projectId}/tasks']?.['post']?.requestBody.content[
          'application/json'
        ]?.schema.properties ?? {},
      )
      expect(properties.filter((name) => /duration/i.test(name))).toEqual(['durationWorkingDays'])
    })

    // Pending: TC-002's planned finish 2027-03-08, three working days from Thursday 2027-03-04, is
    // derived by the scheduler (FR-144, SC-004) over the global calendar (SC-008).
  })

  describe('TC-003: a task without planned dates is kept as unscheduled in its project', () => {
    it('keeps Triage backlog in the task list of Apollo, with no planned dates', async () => {
      const scheduled = await createTask({ title: 'Plan release', plannedStart: '2027-03-01' })
      const created = await createTask({ title: 'Triage backlog' })
      expect(created.statusCode).toBe(201)
      const { id } = created.json<{ id: string }>()

      const listed = await app.inject({
        method: 'GET',
        url: `/api/projects/${apollo}/tasks`,
        headers: as(alice, 'rest-api'),
      })
      expect(listed.statusCode).toBe(200)
      // It appears in Apollo's task list alongside its other tasks.
      expect(listed.json<{ id: string }[]>().map((t) => t.id)).toEqual([
        scheduled.json<{ id: string }>().id,
        id,
      ])

      const read = await readTask(id)
      expect(read.json()).toMatchObject({
        projectId: apollo,
        plannedStart: null,
        plannedFinish: null,
      })
      // Negative: no planned dates are filled in, and it is held in Apollo and nowhere else: the
      // one table of tasks, under Apollo.
      const [row] = await x.db.select().from(tasks).where(eq(tasks.id, id))
      expect(row).toMatchObject({ projectId: apollo, plannedStart: null, plannedFinish: null })
      expect(await x.db.select().from(tasks)).toHaveLength(2)
    })
  })
})
