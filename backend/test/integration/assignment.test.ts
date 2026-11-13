import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import {
  auditLog,
  notifications,
  projectMembers,
  taskAssignees,
  tasks,
} from '../../src/db/schema.ts'
import type { Caller } from '../../src/service/caller.ts'
import { NOT_VISIBLE_MESSAGE, ServiceError } from '../../src/service/errors.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { TaskInput } from '../../src/service/tasks.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The eligibility and assignment module (SC-005) against a real PostgreSQL: its rules through the
// service layer, then the test cases of FR-028, FR-029, FR-030, FR-031 and FR-192 through the
// REST API.

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

describe('the eligibility and assignment module', () => {
  let x: TestDatabase
  let services: Services
  let alice: Seeded
  let reader: Seeded
  let contributor: Seeded
  let writer: Seeded
  let outsider: Seeded
  let project: string
  let other: string

  beforeAll(async () => {
    x = await createTestDatabase()
    services = createServices(x.db)
    alice = await seedAccount(x.db, { username: 'alice' })
    reader = await seedAccount(x.db, { username: 'reader' })
    contributor = await seedAccount(x.db, { username: 'contributor' })
    writer = await seedAccount(x.db, { username: 'writer' })
    // A system admin with no role in the project: being a system admin does not let them read it.
    outsider = await seedAccount(x.db, { username: 'outsider', systemAdmin: true })
    project = await seedProject(x.db, alice, 'Apollo')
    await grantRole(x.db, reader, project, 'read-only')
    await grantRole(x.db, contributor, project, 'contributor')
    await grantRole(x.db, writer, project, 'read-write')
    // The outsider can read another project, which does not let them be assigned in this one.
    other = await seedProject(x.db, outsider, 'Gemini')
  })

  afterAll(async () => {
    await x?.drop()
  })

  const create = (task: Omit<TaskInput, 'title'>, caller: Caller = by(alice)) =>
    services.tasks.createTask(caller, project, { title: 'T', ...task })
  const update = (id: string, changes: TaskInput, caller: Caller = by(alice)) =>
    services.tasks.updateTask(caller, id, changes)
  const stored = async (id: string) => {
    const [row] = await x.db.select().from(tasks).where(eq(tasks.id, id))
    const people = await x.db
      .select()
      .from(taskAssignees)
      .where(eq(taskAssignees.taskId, id))
      .orderBy(taskAssignees.position)
    return { eligibility: row?.eligibility, assignees: people.map((p) => p.accountId) }
  }
  const entries = (id: string) =>
    x.db.select().from(auditLog).where(eq(auditLog.subjectId, id)).orderBy(auditLog.id)
  const count = async () => (await x.db.select().from(tasks)).length

  describe('eligibility (FR-028, DD-038)', () => {
    it('stores a person, an AND, an OR and both two-level nestings exactly as given', async () => {
      const expressions = [
        alice.id,
        { any: [alice.id, writer.id] },
        { all: [alice.id, writer.id] },
        { all: [alice.id, { any: [reader.id, contributor.id, writer.id] }] },
        { any: [{ all: [alice.id, writer.id] }, reader.id] },
        // Not regrouped either when an inner operator is the same as the outer one.
        { all: [alice.id, { all: [writer.id] }] },
      ]
      for (const eligibility of expressions) {
        const task = await create({ eligibility })
        expect(task.eligibility).toEqual(eligibility)
        expect((await stored(task.id)).eligibility).toEqual(eligibility)
        expect((await services.tasks.getTask(by(reader), task.id)).eligibility).toEqual(eligibility)
      }
    })

    it('keeps a person named twice as given', async () => {
      const eligibility = { any: [alice.id, { all: [alice.id, writer.id] }] }
      expect((await create({ eligibility })).eligibility).toEqual(eligibility)
    })

    it('holds an id given in capitals in lower case, the form ids are given out in', async () => {
      const task = await create({ eligibility: { any: [alice.id.toUpperCase()] } })
      expect(task.eligibility).toEqual({ any: [alice.id] })
    })

    it('leaves a task with none as null, and clears it when given null', async () => {
      const task = await create({})
      expect(task.eligibility).toBeNull()
      await update(task.id, { eligibility: { any: [alice.id] } })
      const cleared = await update(task.id, { eligibility: null })
      expect(cleared.eligibility).toBeNull()
      expect((await stored(task.id)).eligibility).toBeNull()
    })

    it('refuses an expression more than two levels deep, creating nothing', async () => {
      const before = await count()
      const deep = { all: [alice.id, { any: [writer.id, { all: [reader.id] }] }] }
      const error = await refused(create({ eligibility: deep }), 'invalid')
      expect(error.message).toMatch(/at most two levels deep/)
      expect(await count()).toBe(before)
    })

    it('refuses anything that is not a person, an AND or an OR', async () => {
      const shapes: unknown[] = [
        5,
        true,
        [alice.id],
        {},
        { all: [] },
        { any: alice.id },
        { or: [alice.id] },
        { all: [alice.id], any: [writer.id] },
        'alice',
        { all: [alice.id, 5] },
        { all: [alice.id, { any: [] }] },
        { all: [alice.id, { any: [writer.id, null] }] },
        { all: [alice.id, { not: [writer.id] }] },
      ]
      const before = await count()
      for (const eligibility of shapes) {
        await refused(create({ eligibility }), 'invalid')
      }
      expect(await count()).toBe(before)
    })
  })

  describe('assignees (FR-029)', () => {
    it('stores a list of people in the order given, apart from the eligibility', async () => {
      const task = await create({
        eligibility: { any: [alice.id, writer.id] },
        assignees: [writer.id, alice.id],
      })
      expect(task.assignees).toEqual([writer.id, alice.id])
      expect(await stored(task.id)).toEqual({
        eligibility: { any: [alice.id, writer.id] },
        assignees: [writer.id, alice.id],
      })
      const read = await services.tasks.getTask(by(reader), task.id)
      expect(read.assignees).toEqual([writer.id, alice.id])
    })

    it('has nobody assigned to a new task unless given, and none when given an empty list', async () => {
      expect((await create({})).assignees).toEqual([])
      expect((await create({ assignees: [] })).assignees).toEqual([])
      // An eligibility expression assigns nobody by itself.
      expect((await create({ eligibility: { all: [alice.id, writer.id] } })).assignees).toEqual([])
    })

    it('replaces the list on an edit, leaving the eligibility as it was, and back again', async () => {
      const task = await create({ eligibility: alice.id, assignees: [alice.id] })
      const changed = await update(task.id, { assignees: [writer.id, reader.id] })
      expect(changed).toMatchObject({ eligibility: alice.id, assignees: [writer.id, reader.id] })
      const reordered = await update(task.id, { assignees: [reader.id, writer.id] })
      expect(reordered.assignees).toEqual([reader.id, writer.id])
      const emptied = await update(task.id, { assignees: [] })
      expect(emptied).toMatchObject({ eligibility: alice.id, assignees: [] })
      expect(await stored(task.id)).toEqual({ eligibility: alice.id, assignees: [] })
    })

    it('leaves the assignees as they were when only the eligibility changes', async () => {
      const task = await create({ eligibility: alice.id, assignees: [writer.id] })
      const changed = await update(task.id, { eligibility: { any: [alice.id, reader.id] } })
      expect(changed.assignees).toEqual([writer.id])
      expect((await stored(task.id)).assignees).toEqual([writer.id])
    })

    it('lists each task of the project with its own assignees', async () => {
      const first = await create({ assignees: [alice.id] })
      const second = await create({ assignees: [writer.id, reader.id] })
      const listed = await services.tasks.listTasks(by(reader), project)
      expect(listed.find((t) => t.id === first.id)?.assignees).toEqual([alice.id])
      expect(listed.find((t) => t.id === second.id)?.assignees).toEqual([writer.id, reader.id])
    })

    it('refuses a person listed twice, a list that is not a list, and an id that is not one', async () => {
      const before = await count()
      for (const assignees of [[alice.id, alice.id], alice.id, { 0: alice.id }, ['alice'], [5]]) {
        await refused(create({ assignees }), 'invalid')
      }
      expect(await count()).toBe(before)
      const error = await refused(create({ assignees: [alice.id, alice.id] }), 'invalid')
      expect(error.message).toMatch(/only once/)
    })
  })

  describe('people outside the eligibility (FR-030, DD-031)', () => {
    it('accepts assignees the expression does not name, when the task is created and edited', async () => {
      const task = await create({ eligibility: { any: [alice.id] }, assignees: [contributor.id] })
      expect(task).toMatchObject({ eligibility: { any: [alice.id] }, assignees: [contributor.id] })
      const edited = await update(task.id, { assignees: [reader.id, writer.id] })
      expect(edited).toMatchObject({
        eligibility: { any: [alice.id] },
        assignees: [reader.id, writer.id],
      })
    })
  })

  describe('people who cannot read the project (FR-031, DD-013)', () => {
    it('lets anyone with a role in the project be made eligible or assigned, whatever the role', async () => {
      const people = [alice.id, reader.id, contributor.id, writer.id]
      const task = await create({ eligibility: { all: people }, assignees: people })
      expect(task.assignees).toEqual(people)
    })

    it('refuses to make eligible, or assign, someone with no role in the project', async () => {
      const before = await count()
      const eligible = await refused(
        create({ eligibility: { any: [alice.id, outsider.id] } }),
        'invalid',
      )
      expect(eligible.message).toBe(
        `The person ${outsider.id} cannot read this project, so cannot be made eligible for its tasks`,
      )
      const nested = { all: [alice.id, { any: [writer.id, outsider.id] }] }
      await refused(create({ eligibility: nested }), 'invalid')
      const assigned = await refused(create({ assignees: [alice.id, outsider.id] }), 'invalid')
      expect(assigned.message).toBe(
        `The person ${outsider.id} cannot read this project, so cannot be assigned to its tasks`,
      )
      expect(await count()).toBe(before)
    })

    it('refuses the same on an edit, leaving the task and the outsider as they were', async () => {
      const task = await create({ eligibility: alice.id, assignees: [alice.id] })
      const entriesBefore = (await entries(task.id)).length
      await refused(update(task.id, { eligibility: { any: [alice.id, outsider.id] } }), 'invalid')
      await refused(update(task.id, { assignees: [outsider.id] }), 'invalid')
      // A refused part takes the rest of the change with it.
      await refused(update(task.id, { title: 'Renamed', assignees: [outsider.id] }), 'invalid')
      expect(await stored(task.id)).toEqual({ eligibility: alice.id, assignees: [alice.id] })
      expect((await services.tasks.getTask(by(alice), task.id)).title).toBe('T')
      expect(await entries(task.id)).toHaveLength(entriesBefore)
      expect(await services.projectRoles.roleOf(outsider.id, project)).toBeUndefined()
    })

    it('refuses a person with no account', async () => {
      const ghost = '00000000-0000-4000-8000-000000000000'
      const error = await refused(create({ assignees: [ghost] }), 'invalid')
      // Told the same as for an account with no role, so the answer does not tell which ids exist.
      expect(error.message).toBe(
        `The person ${ghost} cannot read this project, so cannot be assigned to its tasks`,
      )
      await refused(create({ eligibility: { any: [alice.id, ghost] } }), 'invalid')
    })

    it('checks only the people a change adds: someone who has since lost their role stays (FR-198)', async () => {
      const leaver = await seedAccount(x.db, { username: 'leaver' })
      await grantRole(x.db, leaver, project, 'read-only')
      const task = await create({ eligibility: { any: [leaver.id] }, assignees: [leaver.id] })
      await x.db
        .delete(projectMembers)
        .where(and(eq(projectMembers.projectId, project), eq(projectMembers.accountId, leaver.id)))

      const edited = await update(task.id, {
        eligibility: { any: [leaver.id, writer.id] },
        assignees: [leaver.id, writer.id],
      })
      expect(edited).toMatchObject({
        eligibility: { any: [leaver.id, writer.id] },
        assignees: [leaver.id, writer.id],
        withoutReadAccess: [leaver.id],
      })
      // Once dropped, they are added again by the next change, so checked again.
      await update(task.id, { assignees: [writer.id] })
      await refused(update(task.id, { assignees: [writer.id, leaver.id] }), 'invalid')
      await update(task.id, { eligibility: writer.id })
      await refused(update(task.id, { eligibility: { any: [writer.id, leaver.id] } }), 'invalid')
    })

    it('marks, on every read, who in the eligibility and assignment cannot read the project (FR-199)', async () => {
      const leaver = await seedAccount(x.db, { username: 'marked' })
      const stayer = await seedAccount(x.db, { username: 'stayer' })
      await grantRole(x.db, leaver, project, 'read-only')
      await grantRole(x.db, stayer, project, 'contributor')
      const eligibleOnly = await create({ eligibility: { all: [stayer.id, { any: [leaver.id] }] } })
      const assignedOnly = await create({ assignees: [stayer.id, leaver.id] })
      const both = await create({ eligibility: leaver.id, assignees: [leaver.id] })
      expect(eligibleOnly.withoutReadAccess).toEqual([])
      expect(
        (await services.tasks.listTasks(by(alice), project)).every(
          (t) => t.withoutReadAccess.length === 0,
        ),
      ).toBe(true)

      await x.db
        .delete(projectMembers)
        .where(and(eq(projectMembers.projectId, project), eq(projectMembers.accountId, leaver.id)))

      for (const id of [eligibleOnly.id, assignedOnly.id, both.id]) {
        // Each person once, whether named in the eligibility, the assignment or both.
        expect((await services.tasks.getTask(by(reader), id)).withoutReadAccess).toEqual([
          leaver.id,
        ])
      }
      const listed = await services.tasks.listTasks(by(reader), project)
      expect(listed.find((t) => t.id === both.id)?.withoutReadAccess).toEqual([leaver.id])
      // Through every way a task is handed out: an edit that changes nothing, one that does, and
      // a status change.
      expect((await update(both.id, {})).withoutReadAccess).toEqual([leaver.id])
      expect((await update(assignedOnly.id, { title: 'Renamed' })).withoutReadAccess).toEqual([
        leaver.id,
      ])
      const started = await services.taskStatus.setStatus(by(alice), both.id, 'in-progress')
      expect(started.withoutReadAccess).toEqual([leaver.id])
      const again = await services.taskStatus.setStatus(by(alice), both.id, 'in-progress')
      expect(again.withoutReadAccess).toEqual([leaver.id])
      // Removed, they are no longer marked; a person who can read it never is.
      const removed = await update(both.id, { eligibility: null, assignees: [] })
      expect(removed.withoutReadAccess).toEqual([])
      // Given their role back, they are no longer marked either.
      await grantRole(x.db, leaver, project, 'read-only')
      expect((await services.tasks.getTask(by(alice), assignedOnly.id)).withoutReadAccess).toEqual(
        [],
      )
    })

    it('does not let a role in another project count for this one', async () => {
      expect(await services.projectRoles.roleOf(outsider.id, other)).toBe('admin')
      await refused(create({ assignees: [outsider.id] }), 'invalid')
    })
  })

  describe('milestones (FR-192)', () => {
    const FIXED = { variant: 'fixed-date', date: '2027-03-12' }

    it('refuses a milestone made with an eligibility expression or with assignees', async () => {
      const before = await count()
      for (const milestone of [FIXED, { variant: 'floating' }]) {
        const eligible = await refused(create({ milestone, eligibility: alice.id }), 'invalid')
        expect(eligible.message).toBe('A milestone takes no time: it has no eligibility expression')
        const assigned = await refused(create({ milestone, assignees: [alice.id] }), 'invalid')
        expect(assigned.message).toBe('A milestone takes no time: nobody can be assigned to it')
      }
      expect(await count()).toBe(before)
    })

    it('refuses either on an edit, and takes none, null and an empty list', async () => {
      const launch = await create({ milestone: FIXED, eligibility: null, assignees: [] })
      expect(launch).toMatchObject({ eligibility: null, assignees: [] })
      await refused(update(launch.id, { assignees: [writer.id] }), 'invalid')
      await refused(update(launch.id, { eligibility: { any: [alice.id] } }), 'invalid')
      const moved = await update(launch.id, {
        milestone: { variant: 'fixed-date', date: '2027-03-19' },
        eligibility: null,
        assignees: [],
      })
      expect(moved).toMatchObject({ eligibility: null, assignees: [] })
      expect(await stored(launch.id)).toEqual({ eligibility: null, assignees: [] })
    })

    it('is held to it by the database too', async () => {
      const launch = await create({ milestone: FIXED })
      await expect(
        x.db.update(tasks).set({ eligibility: alice.id }).where(eq(tasks.id, launch.id)),
      ).rejects.toMatchObject({
        cause: { code: '23514', constraint: 'tasks_milestone_has_no_eligibility' },
      })
    })
  })

  describe('who may change it (FR-106, FR-107, FR-108)', () => {
    it('lets a read-write member set both', async () => {
      const task = await create({})
      const changed = await update(
        task.id,
        { eligibility: { any: [alice.id, writer.id] }, assignees: [alice.id] },
        by(writer),
      )
      expect(changed).toMatchObject({
        eligibility: { any: [alice.id, writer.id] },
        assignees: [alice.id],
      })
    })

    it('forbids a read-only member and a contributor, and hides the project from anyone else', async () => {
      const task = await create({ assignees: [contributor.id] })
      await refused(update(task.id, { assignees: [reader.id] }, by(reader)), 'forbidden')
      await refused(
        update(task.id, { assignees: [contributor.id, writer.id] }, by(contributor)),
        'forbidden',
      )
      await refused(update(task.id, { eligibility: contributor.id }, by(contributor)), 'forbidden')
      await refused(update(task.id, { assignees: [] }, by(outsider)), 'not-visible')
      await refused(create({ assignees: [reader.id] }, by(reader)), 'forbidden')
      expect(await stored(task.id)).toEqual({ eligibility: null, assignees: [contributor.id] })
    })

    it('tells an outsider the project is not visible before looking at what they sent', async () => {
      const task = await create({})
      const error = await refused(
        update(task.id, { assignees: 'nonsense' }, by(outsider)),
        'not-visible',
      )
      expect(error.message).toBe(NOT_VISIBLE_MESSAGE)
      await refused(create({ eligibility: { or: 1 } }, by(outsider)), 'not-visible')
    })

    it('lets a contributor set the status of a task they are assigned to, and no other', async () => {
      const mine = await create({ assignees: [contributor.id] })
      const theirs = await create({ assignees: [writer.id] })
      const started = await services.taskStatus.setStatus(by(contributor), mine.id, 'in-progress')
      expect(started.status).toBe('in-progress')
      await refused(
        services.taskStatus.setStatus(by(contributor), theirs.id, 'in-progress'),
        'forbidden',
      )
      // Only assignment counts: being eligible is not enough.
      const eligibleOnly = await create({ eligibility: contributor.id })
      await refused(
        services.taskStatus.setStatus(by(contributor), eligibleOnly.id, 'in-progress'),
        'forbidden',
      )
      // Once unassigned, they can no longer set it.
      await update(mine.id, { assignees: [writer.id] })
      await refused(services.taskStatus.setStatus(by(contributor), mine.id, 'done'), 'forbidden')
    })
  })

  describe('the audit log (FR-116)', () => {
    it('records the eligibility and assignees a task is created with', async () => {
      const task = await create(
        { eligibility: { any: [alice.id] }, assignees: [writer.id] },
        by(alice, 'rest-api'),
      )
      const [entry] = await entries(task.id)
      expect(entry).toMatchObject({
        action: 'task.created',
        channels: ['rest-api'],
        details: expect.objectContaining({
          eligibility: { any: [alice.id] },
          assignees: [writer.id],
        }),
      })
    })

    it('records what an edit changes, with what it was, and nothing for an edit that changes nothing', async () => {
      const task = await create({ eligibility: alice.id, assignees: [alice.id] })
      await update(task.id, { eligibility: { any: [alice.id, writer.id] }, assignees: [writer.id] })
      // The same values again, the tree given anew: nothing changes, so nothing is recorded.
      await update(task.id, { eligibility: { any: [alice.id, writer.id] }, assignees: [writer.id] })
      await update(task.id, { assignees: [writer.id] })
      const recorded = await entries(task.id)
      expect(recorded).toHaveLength(2)
      expect(recorded[1]).toMatchObject({
        action: 'task.updated',
        details: {
          changes: { eligibility: { any: [alice.id, writer.id] }, assignees: [writer.id] },
          previous: { eligibility: alice.id, assignees: [alice.id] },
        },
      })
      await update(task.id, { assignees: [] })
      expect((await entries(task.id))[2]).toMatchObject({
        details: { changes: { assignees: [] }, previous: { assignees: [writer.id] } },
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
    return read.json<{ eligibility: unknown; assignees: string[]; withoutReadAccess: string[] }>()
  }
  const created = async (payload: Record<string, unknown>) => {
    const response = await createTask(payload)
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string }>().id
  }
  const account = (username: string) => seedAccount(x.db, { username })

  it('refuses a lone id given for the assignees over REST, as the service does through any channel', async () => {
    const t = await created({ title: 'T' })
    const response = await change(t, { assignees: alice.id })
    expect(response.statusCode).toBe(400)
    expect((await readTask(t)).assignees).toEqual([])
  })

  describe('TC-038: two-level AND/OR eligibility expressions are stored as given', () => {
    it('reads back alice AND (bob OR carol OR dave), and (alice AND bob) OR carol', async () => {
      const [bob, carol, dave] = await Promise.all([
        account('bob'),
        account('carol'),
        account('dave'),
      ])
      for (const person of [bob, carol, dave]) await grantRole(x.db, person, apollo, 'read-only')
      const t1Eligibility = { all: [alice.id, { any: [bob.id, carol.id, dave.id] }] }
      const t2Eligibility = { any: [{ all: [alice.id, bob.id] }, carol.id] }

      const t1 = await created({ title: 'T1', eligibility: t1Eligibility })
      const t2 = await created({ title: 'T2', eligibility: t2Eligibility })

      const readT1 = await readTask(t1)
      const readT2 = await readTask(t2)
      // Exactly as given: neither flattened nor regrouped into a different meaning.
      expect(readT1.eligibility).toEqual(t1Eligibility)
      expect(readT2.eligibility).toEqual(t2Eligibility)
      // Negative: neither task has assigned people as a result.
      expect(readT1.assignees).toEqual([])
      expect(readT2.assignees).toEqual([])
    })
  })

  describe('TC-039: assignment is stored as a list separate from eligibility', () => {
    it('changes the assigned people from [bob] to [alice], leaving alice OR bob as it was', async () => {
      const bob = await account('bob')
      await grantRole(x.db, bob, apollo, 'read-only')
      const t = await created({
        title: 'T',
        eligibility: { any: [alice.id, bob.id] },
        assignees: [bob.id],
      })
      expect(await readTask(t)).toMatchObject({
        eligibility: { any: [alice.id, bob.id] },
        assignees: [bob.id],
      })

      const changed = await change(t, { assignees: [alice.id] })
      expect(changed.statusCode).toBe(200)

      // Negative: changing the assignment does not change the eligibility expression.
      expect(await readTask(t)).toMatchObject({
        eligibility: { any: [alice.id, bob.id] },
        assignees: [alice.id],
      })
    })
  })

  describe('TC-040: an assignment outside the eligibility is accepted without a warning', () => {
    it('saves [carol] on a task eligible to alice OR bob, with no warning and no notification', async () => {
      const [bob, carol] = await Promise.all([account('bob'), account('carol')])
      await grantRole(x.db, bob, apollo, 'read-only')
      await grantRole(x.db, carol, apollo, 'read-only')
      const t = await created({ title: 'T', eligibility: { any: [alice.id, bob.id] } })

      // The TC's step 1 is in the browser, with the assignment editor (SC-100), in
      // e2e/tests/task-editors.spec.ts. The save it makes is this request; the service decides the
      // same whichever channel asks.
      const notified = await x.db.select().from(notifications)
      const saved = await change(t, { assignees: [carol.id] })
      expect(saved.statusCode).toBe(200)
      // Negative: no confirmation or error: the save is accepted as it is, at once.

      expect(await readTask(t)).toMatchObject({
        eligibility: { any: [alice.id, bob.id] },
        assignees: [carol.id],
      })
      // Negative: no notification is raised (SC-012), and the task's audit trail holds only its
      // creation and the edit.
      expect(await x.db.select().from(notifications)).toEqual(notified)
      const trail = await x.db.select().from(auditLog).where(eq(auditLog.subjectId, t))
      expect(trail.map((entry) => entry.action)).toEqual(['task.created', 'task.updated'])
    })
  })

  describe('TC-041: making someone without read access eligible is rejected', () => {
    it('rejects alice OR dave, leaving the eligibility alice and dave with no access', async () => {
      const dave = await account('dave')
      const t = await created({ title: 'T', eligibility: alice.id })

      const response = await change(t, { eligibility: { any: [alice.id, dave.id] } })
      expect(response.statusCode).toBe(400)

      expect((await readTask(t)).eligibility).toBe(alice.id)
      // Negative: dave gains no access to Apollo.
      const asDave = await app.inject({
        method: 'GET',
        url: `/api/tasks/${t}`,
        headers: as(dave, 'rest-api'),
      })
      expect(asDave.statusCode).toBe(403)
      expect(asDave.json().message).toBe(NOT_VISIBLE_MESSAGE)
      expect(
        await x.db.select().from(projectMembers).where(eq(projectMembers.accountId, dave.id)),
      ).toEqual([])
    })
  })

  describe('TC-042: assigning someone without read access is rejected', () => {
    it('rejects [dave], leaving T with nobody assigned and dave with no access or load', async () => {
      const dave = await account('dave')
      const t = await created({ title: 'T' })

      const response = await change(t, { assignees: [dave.id] })
      expect(response.statusCode).toBe(400)

      expect((await readTask(t)).assignees).toEqual([])
      // Negative: dave gains no access to Apollo, and carries no load from T: he is assigned to
      // nothing, and only assigned people carry a task's load (SRC-034).
      const asDave = await app.inject({
        method: 'GET',
        url: `/api/projects/${apollo}/tasks`,
        headers: as(dave, 'rest-api'),
      })
      expect(asDave.statusCode).toBe(403)
      expect(asDave.json().message).toBe(NOT_VISIBLE_MESSAGE)
      expect(
        await x.db.select().from(taskAssignees).where(eq(taskAssignees.accountId, dave.id)),
      ).toEqual([])
    })
  })

  describe('TC-266: assigning people or eligibility to a milestone is rejected', () => {
    it('rejects assigning bob to Launch and giving it alice OR bob, storing neither', async () => {
      const bob = await account('bob')
      await grantRole(x.db, bob, apollo, 'read-write')
      // The TC's global calendar is not needed for a milestone pinned to a date; it comes with
      // SC-008.
      const launch = await created({
        title: 'Launch',
        milestone: { variant: 'fixed-date', date: '2027-03-12' },
      })

      const assign = await change(launch, { assignees: [bob.id] })
      const eligible = await change(launch, { eligibility: { any: [alice.id, bob.id] } })
      expect(assign.statusCode).toBe(400)
      expect(eligible.statusCode).toBe(400)

      expect(await readTask(launch)).toMatchObject({ eligibility: null, assignees: [] })
      // Negative: bob is not assigned and no expression is stored.
      expect(
        await x.db.select().from(taskAssignees).where(eq(taskAssignees.taskId, launch)),
      ).toEqual([])
      const [row] = await x.db.select().from(tasks).where(eq(tasks.id, launch))
      expect(row?.eligibility).toBeNull()
    })
  })

  describe('TC-272: an eligibility expression three levels deep is rejected', () => {
    it('rejects alice AND (bob OR (carol AND dave)), keeping alice OR bob', async () => {
      const [bob, carol, dave] = await Promise.all([
        account('bob'),
        account('carol'),
        account('dave'),
      ])
      for (const person of [bob, carol, dave]) await grantRole(x.db, person, apollo, 'read-only')
      const t = await created({ title: 'T', eligibility: { any: [alice.id, bob.id] } })

      const response = await change(t, {
        eligibility: { all: [alice.id, { any: [bob.id, { all: [carol.id, dave.id] }] }] },
      })
      expect(response.statusCode).toBe(400)

      // Negative: nothing of it is stored, flattened or cut down to two levels.
      expect((await readTask(t)).eligibility).toEqual({ any: [alice.id, bob.id] })
      const [row] = await x.db.select().from(tasks).where(eq(tasks.id, t))
      expect(row?.eligibility).toEqual({ any: [alice.id, bob.id] })
    })
  })

  describe('TC-273: a person who loses read access stays on the task and can be removed', () => {
    it('keeps bob on T and U when his role goes, lets him be removed, and not added back', async () => {
      const bob = await account('bob')
      await grantRole(x.db, bob, apollo, 'read-only')
      const given = { eligibility: { any: [alice.id, bob.id] }, assignees: [bob.id] }
      const t = await created({ title: 'T', ...given })
      const u = await created({ title: 'U', ...given })

      // Step 1: alice removes bob's role in Apollo.
      const removal = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${apollo}/members/${bob.id}`,
        headers: as(alice, 'rest-api'),
      })
      expect(removal.statusCode).toBe(204)

      // Step 2.
      expect(await readTask(t)).toMatchObject(given)
      expect(await readTask(u)).toMatchObject(given)

      // Step 3.
      expect((await change(t, { title: 'Renamed' })).statusCode).toBe(200)
      expect(await readTask(t)).toMatchObject({ title: 'Renamed', ...given })

      // Step 4.
      expect((await change(u, { assignees: [], eligibility: alice.id })).statusCode).toBe(200)
      expect(await readTask(u)).toMatchObject({ eligibility: alice.id, assignees: [] })

      // Step 5.
      expect((await change(u, { assignees: [bob.id] })).statusCode).toBe(400)
      expect((await change(u, { eligibility: { any: [alice.id, bob.id] } })).statusCode).toBe(400)
      expect(await readTask(u)).toMatchObject({ eligibility: alice.id, assignees: [] })

      // Negative: bob gains no access to Apollo.
      const asBob = await app.inject({
        method: 'GET',
        url: `/api/tasks/${t}`,
        headers: as(bob, 'rest-api'),
      })
      expect(asBob.statusCode).toBe(403)
    })
  })

  describe('TC-274: people on a task who cannot read its project are marked', () => {
    it('reports bob, and only bob, once his role in Apollo is removed', async () => {
      const [bob, carol] = await Promise.all([account('bob'), account('carol')])
      await grantRole(x.db, bob, apollo, 'read-only')
      await grantRole(x.db, carol, apollo, 'read-only')
      const t = await created({
        title: 'T',
        eligibility: { any: [alice.id, bob.id, carol.id] },
        assignees: [bob.id, carol.id],
      })

      // The TC's steps are in the browser, with the eligibility and assignment editors (SC-099,
      // SC-100), in e2e/tests/task-editors.spec.ts. What they mark is what the task read here
      // reports.
      expect((await readTask(t)).withoutReadAccess).toEqual([])

      await x.db
        .delete(projectMembers)
        .where(and(eq(projectMembers.projectId, apollo), eq(projectMembers.accountId, bob.id)))

      const read = await readTask(t)
      expect(read.withoutReadAccess).toEqual([bob.id])
      // Negative: bob is not removed from T's eligibility or assignment.
      expect(read).toMatchObject({
        eligibility: { any: [alice.id, bob.id, carol.id] },
        assignees: [bob.id, carol.id],
      })
    })
  })

  describe('TC-275: an assignment naming a person twice is rejected', () => {
    it('rejects [bob, alice, bob], keeping [alice]', async () => {
      const bob = await account('bob')
      await grantRole(x.db, bob, apollo, 'read-only')
      const t = await created({ title: 'T', assignees: [alice.id] })

      const response = await change(t, { assignees: [bob.id, alice.id, bob.id] })
      expect(response.statusCode).toBe(400)

      // Negative: not saved with the repeat dropped.
      expect((await readTask(t)).assignees).toEqual([alice.id])
    })
  })
})
