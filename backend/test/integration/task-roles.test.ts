import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { tasks } from '../../src/db/schema.ts'
import { createServices } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The test cases of the roles on tasks (FR-106, FR-107, FR-108) that need assignees, which the
// eligibility and assignment module (SC-005) brings, through the REST API. The role checks
// themselves are SC-049's, tested role by role in src/service/permissions.test.ts.

type Seeded = Awaited<ReturnType<typeof seedAccount>>
type Read = Record<string, unknown> & { title: string; status: string; assignees: string[] }

describe('test cases of the roles on tasks through the REST API', () => {
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

  const request = (
    who: Seeded,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    url: string,
    payload?: Record<string, unknown>,
  ) => app.inject({ method, url: `/api${url}`, headers: as(who, 'rest-api'), payload })
  const createTask = async (payload: Record<string, unknown>) => {
    const response = await request(alice, 'POST', `/projects/${apollo}/tasks`, payload)
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string }>().id
  }
  const readTask = async (id: string) => {
    const response = await request(alice, 'GET', `/tasks/${id}`)
    expect(response.statusCode).toBe(200)
    return response.json<Read>()
  }
  const tasksOfApollo = async () => {
    const response = await request(alice, 'GET', `/projects/${apollo}/tasks`)
    expect(response.statusCode).toBe(200)
    return response.json<Read[]>()
  }
  /** Gives the task a status straight in the database, as a TC's given. */
  const given = (id: string, fields: Partial<typeof tasks.$inferInsert>) =>
    x.db.update(tasks).set(fields).where(eq(tasks.id, id))

  describe('TC-155: every edit from a read-only member is rejected', () => {
    it("rejects bob's rename, start, new task and assignment, leaving T as it was", async () => {
      const bob = await seedAccount(x.db, { username: 'bob' })
      await grantRole(x.db, bob, apollo, 'read-only')
      const t = await createTask({ title: 'Draft' })

      const edits = [
        await request(bob, 'PATCH', `/tasks/${t}`, { title: 'Mine' }),
        await request(bob, 'PUT', `/tasks/${t}/status`, { status: 'in-progress' }),
        await request(bob, 'POST', `/projects/${apollo}/tasks`, { title: 'New' }),
        await request(bob, 'PATCH', `/tasks/${t}`, { assignees: [bob.id] }),
      ]
      for (const response of edits) expect(response.statusCode).toBe(403)

      const listed = await tasksOfApollo()
      // Negative: T is unchanged, not started and unassigned, and no task New exists.
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({
        id: t,
        title: 'Draft',
        status: 'not-started',
        assignees: [],
      })
    })

    // Pending: the TC's "delete T". No SC in the plan deletes a task (tasks are cancelled, SC-038),
    // so there is no deletion to try yet.
  })

  describe('TC-156: a contributor sets the status of a task they are assigned to', () => {
    it('lets carol move T through in progress, on hold, in progress and done', async () => {
      const carol = await seedAccount(x.db, { username: 'carol' })
      await grantRole(x.db, carol, apollo, 'contributor')
      const t = await createTask({ title: 'T', assignees: [carol.id] })
      const before = await readTask(t)

      for (const status of ['in-progress', 'on-hold', 'in-progress', 'done']) {
        const response = await request(carol, 'PUT', `/tasks/${t}/status`, { status })
        expect(response.statusCode).toBe(200)
        const read = await request(carol, 'GET', `/tasks/${t}`)
        expect(read.json<Read>().status).toBe(status)
      }

      // Negative: no field of T other than its status and actual dates changes.
      const after = await readTask(t)
      expect(after.status).toBe('done')
      const { status: _s, actualStart: _as, actualFinish: _af, ...rest } = after
      const { status: _s0, actualStart: _as0, actualFinish: _af0, ...restBefore } = before
      expect(rest).toEqual(restBefore)
    })
  })

  describe('TC-157: every other edit from a contributor is rejected', () => {
    it("rejects carol's rename, starting another's task and reopening a finished one", async () => {
      const carol = await seedAccount(x.db, { username: 'carol' })
      await grantRole(x.db, carol, apollo, 'contributor')
      const mine = await createTask({ title: 'Mine', assignees: [carol.id] })
      const others = await createTask({ title: 'Others', assignees: [alice.id] })
      const closed = await createTask({ title: 'Closed', assignees: [carol.id] })
      await given(closed, { status: 'done', actualStart: '2027-03-01', actualFinish: '2027-03-02' })

      const edits = [
        await request(carol, 'PATCH', `/tasks/${mine}`, { title: 'Renamed' }),
        await request(carol, 'PUT', `/tasks/${others}/status`, { status: 'in-progress' }),
        await request(carol, 'PUT', `/tasks/${closed}/status`, { status: 'in-progress' }),
      ]
      for (const response of edits) expect(response.statusCode).toBe(403)

      // Negative: Mine keeps its title; Others is not started; Closed is still done.
      expect(await readTask(mine)).toMatchObject({ title: 'Mine', status: 'not-started' })
      expect((await readTask(others)).status).toBe('not-started')
      expect((await readTask(closed)).status).toBe('done')
    })

    // Pending: the TC's "cancel Mine" comes with task cancellation (SC-038).
  })

  describe('TC-158: a read-write member edits tasks, plans and assignments', () => {
    it("accepts bob's new task, rename, move and assignment of alice", async () => {
      const bob = await seedAccount(x.db, { username: 'bob' })
      await grantRole(x.db, bob, apollo, 'read-write')
      const t = await createTask({
        title: 'Draft',
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })

      const edits = [
        await request(bob, 'POST', `/projects/${apollo}/tasks`, { title: 'New' }),
        await request(bob, 'PATCH', `/tasks/${t}`, { title: 'Final' }),
        await request(bob, 'PATCH', `/tasks/${t}`, { plannedStart: '2027-03-02' }),
        await request(bob, 'PATCH', `/tasks/${t}`, { assignees: [alice.id] }),
      ]
      // Negative: no edit is rejected.
      expect(edits.map((response) => response.statusCode)).toEqual([201, 200, 200, 200])

      const listed = await tasksOfApollo()
      expect(listed.map((task) => task.title)).toEqual(['Final', 'New'])
      expect(listed[0]).toMatchObject({
        id: t,
        title: 'Final',
        plannedStart: '2027-03-02',
        assignees: [alice.id],
      })
    })
  })
})
