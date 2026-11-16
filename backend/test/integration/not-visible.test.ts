import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { NOT_VISIBLE_MESSAGE } from '../../src/service/errors.ts'
import { createServices } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'

// The not-visible project response (SC-051) against a real PostgreSQL, through the REST API: what
// someone is told when they ask for a project they cannot see (FR-017).

type Seeded = Awaited<ReturnType<typeof seedAccount>>

/** The words FR-017 and TC-025 rule out, alone or as alternatives. */
const VAGUE = /not found|deleted|no permission/i

describe('a project someone cannot see', () => {
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let root: Seeded
  let alice: Seeded
  let bob: Seeded

  beforeEach(async () => {
    x = await createTestDatabase()
    app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterEach(async () => {
    await app?.close()
    await x?.drop()
  })

  const create = async (creator: Seeded, name: string) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: as(creator),
      payload: { name },
    })
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string }>().id
  }

  const open = (who: Seeded, projectId: string) =>
    app.inject({ method: 'GET', url: `/api/projects/${projectId}`, headers: as(who) })

  describe('TC-025: opening a project one cannot see says it is not visible', () => {
    it('tells alice that Borealis is not visible to her, and shows nothing of it', async () => {
      const borealis = await create(bob, 'Borealis')
      const response = await open(alice, borealis)
      expect(response.statusCode).toBe(403)
      expect(response.json()).toEqual({
        statusCode: 403,
        error: 'Not Visible',
        message: 'This project is not visible to you',
      })
      // Negative: neither "not found", "deleted" nor "no permission", and no data of Borealis.
      expect(response.json().message).not.toMatch(VAGUE)
      expect(response.json().error).not.toMatch(VAGUE)
      expect(response.json().error).not.toBe('Forbidden')
      expect(response.body).not.toContain('Borealis')
      expect(response.body).not.toContain(borealis)
    })

    // TC-025 in full, alice opening Borealis's address in the browser, is in
    // e2e/tests/not-visible.spec.ts.
  })

  it('shows the project to someone who holds any role in it', async () => {
    const borealis = await create(bob, 'Borealis')
    await app.inject({
      method: 'PUT',
      url: `/api/projects/${borealis}/members/${alice.id}`,
      headers: as(bob),
      payload: { role: 'read-only' },
    })
    const response = await open(alice, borealis)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ id: borealis, name: 'Borealis', role: 'read-only' })
  })

  it('answers a project that does not exist the same way, so the answer reveals nothing', async () => {
    const borealis = await create(bob, 'Borealis')
    const existing = await open(alice, borealis)
    const missing = await open(alice, randomUUID())
    expect(missing.statusCode).toBe(existing.statusCode)
    expect(missing.json()).toEqual(existing.json())
  })

  it('tells a system admin with no role in it the same', async () => {
    const borealis = await create(bob, 'Borealis')
    expect((await open(root, borealis)).json().message).toBe(NOT_VISIBLE_MESSAGE)
  })

  it('says so for every request about the project: its members, their roles and its audit log', async () => {
    const borealis = await create(bob, 'Borealis')
    const responses = await Promise.all([
      app.inject({ method: 'GET', url: `/api/projects/${borealis}/members`, headers: as(alice) }),
      app.inject({
        method: 'PUT',
        url: `/api/projects/${borealis}/members/${alice.id}`,
        headers: as(alice),
        payload: { role: 'admin' },
      }),
      app.inject({
        method: 'DELETE',
        url: `/api/projects/${borealis}/members/${bob.id}`,
        headers: as(alice),
      }),
      app.inject({
        method: 'GET',
        url: '/api/audit-log',
        query: { projectId: borealis },
        headers: as(alice),
      }),
    ])
    for (const response of responses) {
      expect(response.statusCode).toBe(403)
      expect(response.json()).toMatchObject({ error: 'Not Visible', message: NOT_VISIBLE_MESSAGE })
    }
  })

  it('tells a member whose role does not allow a change that it is not allowed, not that the project is invisible', async () => {
    const borealis = await create(bob, 'Borealis')
    await app.inject({
      method: 'PUT',
      url: `/api/projects/${borealis}/members/${alice.id}`,
      headers: as(bob),
      payload: { role: 'read-only' },
    })
    const response = await app.inject({
      method: 'PUT',
      url: `/api/projects/${borealis}/members/${alice.id}`,
      headers: as(alice),
      payload: { role: 'admin' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: "Only the project's admins can manage its members, roles, repositories and settings",
    })
  })

  // TC-024 (depending on an unreadable project's milestone is rejected) verifies FR-016, which the
  // task relation module (SC-002) delivers; it asks that the refusal reveal nothing beyond what
  // FR-017 allows. Pending: tasks, milestones and blocked-by relations (SC-001, SC-002).
})
