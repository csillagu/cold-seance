import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { projectMembers } from '../../src/db/schema.ts'
import { createServices } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The people on a task (SC-099, SC-100) against a real PostgreSQL, through the REST API: who the
// eligibility and assignment editors name and mark, the marks being FR-199's.

type Seeded = Awaited<ReturnType<typeof seedAccount>>

describe('the people on a task', () => {
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let alice: Seeded
  let bob: Seeded
  let carol: Seeded
  let dave: Seeded
  let outsider: Seeded
  let apollo: string

  beforeAll(async () => {
    x = await createTestDatabase()
    app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
    carol = await seedAccount(x.db, { username: 'carol' })
    dave = await seedAccount(x.db, { username: 'dave' })
    outsider = await seedAccount(x.db, { username: 'outsider' })
    apollo = await seedProject(x.db, alice, 'Apollo')
    for (const person of [bob, carol, dave]) await grantRole(x.db, person, apollo, 'read-only')
  })

  afterAll(async () => {
    await app?.close()
    await x?.drop()
  })

  const created = async (payload: Record<string, unknown>) => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${apollo}/tasks`,
      headers: as(alice),
      payload: { title: 'T', ...payload },
    })
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string }>().id
  }
  const people = (task: string, by: Seeded = alice) =>
    app.inject({ method: 'GET', url: `/api/tasks/${task}/people`, headers: as(by) })

  it('names everyone in the eligibility and the assignment once, by username', async () => {
    const t = await created({
      eligibility: { all: [carol.id, { any: [bob.id, carol.id] }] },
      assignees: [dave.id, bob.id],
    })
    const response = await people(t)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([
      { accountId: bob.id, username: 'bob', canReadProject: true },
      { accountId: carol.id, username: 'carol', canReadProject: true },
      { accountId: dave.id, username: 'dave', canReadProject: true },
    ])
  })

  it('is empty for a task with no one on it', async () => {
    const t = await created({})
    expect((await people(t)).json()).toEqual([])
  })

  it('still names someone who lost read access, marked as unable to read the project', async () => {
    const erin = await seedAccount(x.db, { username: 'erin' })
    await grantRole(x.db, erin, apollo, 'read-only')
    const t = await created({ eligibility: { any: [alice.id, erin.id] }, assignees: [erin.id] })
    await x.db
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, apollo), eq(projectMembers.accountId, erin.id)))

    expect((await people(t)).json()).toEqual([
      { accountId: alice.id, username: 'alice', canReadProject: true },
      { accountId: erin.id, username: 'erin', canReadProject: false },
    ])
  })

  it('is readable by anyone who can read the task, and not visible to anyone else', async () => {
    const t = await created({ assignees: [bob.id] })
    expect((await people(t, bob)).statusCode).toBe(200)
    expect((await people(t, outsider)).statusCode).toBe(403)
  })
})
