import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { ServiceError } from '../service/errors.ts'
import type { ProjectMember } from '../service/project-roles.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The project member routes translate requests for the project role store and nothing more
// (DD-039); the rules themselves are tested against the database in
// test/integration/project-roles.test.ts. Here the store is a stub, so these tests show what each
// route hands it and what it sends back.

const ALICE = '6f1c2a5e-0000-4000-8000-000000000001'
const BOB = '6f1c2a5e-0000-4000-8000-000000000002'
const APOLLO = '6f1c2a5e-0000-4000-8000-0000000000a1'
const BOB_MEMBER: ProjectMember = { accountId: BOB, username: 'bob', role: 'read-write' }

const asAlice: Authenticator = async (request) =>
  request.headers.authorization === 'Bearer alice'
    ? { accountId: ALICE, channel: 'rest-api' }
    : undefined
const alice = { authorization: 'Bearer alice' }
const caller = { accountId: ALICE, channel: 'rest-api' }

let closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(closers.map((close) => close()))
  closers = []
})

/** The REST API over the real service layer, its role store's methods spied on. */
function stubbed() {
  const { db, close } = createDatabase('postgres://nobody@unused.invalid/none')
  const services = createServices(db)
  const store = {
    listMembers: vi.spyOn(services.projectRoles, 'listMembers'),
    setRole: vi.spyOn(services.projectRoles, 'setRole'),
    removeMember: vi.spyOn(services.projectRoles, 'removeMember'),
  }
  const app = buildApp({}, { authenticators: [asAlice], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, store }
}

describe('GET /api/projects/:projectId/members', () => {
  it("hands the store the caller and the project and sends the project's members", async () => {
    const { app, store } = stubbed()
    store.listMembers.mockResolvedValue([BOB_MEMBER])
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${APOLLO}/members`,
      headers: alice,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([BOB_MEMBER])
    expect(store.listMembers).toHaveBeenCalledWith(caller, APOLLO)
  })

  it('refuses a project id that is not a UUID before the store is asked', async () => {
    const { app, store } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/projects/apollo/members',
      headers: alice,
    })
    expect(response.statusCode).toBe(400)
    expect(store.listMembers).not.toHaveBeenCalled()
  })

  it("answers 403 with the store's message when the store refuses", async () => {
    const { app, store } = stubbed()
    store.listMembers.mockRejectedValue(new ServiceError('forbidden', 'Not yours'))
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${APOLLO}/members`,
      headers: alice,
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ statusCode: 403, error: 'Forbidden', message: 'Not yours' })
  })

  it('refuses a caller no authenticator recognises with 401', async () => {
    const { app, store } = stubbed()
    const response = await app.inject({ method: 'GET', url: `/api/projects/${APOLLO}/members` })
    expect(response.statusCode).toBe(401)
    expect(store.listMembers).not.toHaveBeenCalled()
  })
})

describe('PUT /api/projects/:projectId/members/:accountId', () => {
  it('hands the store the project, the person and the role, and sends the member', async () => {
    const { app, store } = stubbed()
    store.setRole.mockResolvedValue(BOB_MEMBER)
    const response = await app.inject({
      method: 'PUT',
      url: `/api/projects/${APOLLO}/members/${BOB}`,
      headers: alice,
      payload: { role: 'read-write' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(BOB_MEMBER)
    expect(store.setRole).toHaveBeenCalledWith(caller, APOLLO, BOB, 'read-write')
  })

  it.each([
    ['a role outside the four', { role: 'owner' }],
    ['no role', {}],
  ])('refuses %s before the store is asked', async (_, payload) => {
    const { app, store } = stubbed()
    const response = await app.inject({
      method: 'PUT',
      url: `/api/projects/${APOLLO}/members/${BOB}`,
      headers: alice,
      payload,
    })
    expect(response.statusCode).toBe(400)
    expect(store.setRole).not.toHaveBeenCalled()
  })

  it("answers 409 with the store's message when it would remove the last admin", async () => {
    const { app, store } = stubbed()
    store.setRole.mockRejectedValue(
      new ServiceError('conflict', "The project's last admin cannot be removed"),
    )
    const response = await app.inject({
      method: 'PUT',
      url: `/api/projects/${APOLLO}/members/${ALICE}`,
      headers: alice,
      payload: { role: 'read-only' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json().message).toBe("The project's last admin cannot be removed")
  })
})

describe('DELETE /api/projects/:projectId/members/:accountId', () => {
  it('hands the store the project and the person and answers 204 with no body', async () => {
    const { app, store } = stubbed()
    store.removeMember.mockResolvedValue()
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${APOLLO}/members/${BOB}`,
      headers: alice,
    })
    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
    expect(store.removeMember).toHaveBeenCalledWith(caller, APOLLO, BOB)
  })

  it('refuses an account id that is not a UUID before the store is asked', async () => {
    const { app, store } = stubbed()
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${APOLLO}/members/bob`,
      headers: alice,
    })
    expect(response.statusCode).toBe(400)
    expect(store.removeMember).not.toHaveBeenCalled()
  })

  it('answers 404 when the store finds no such member', async () => {
    const { app, store } = stubbed()
    store.removeMember.mockRejectedValue(new ServiceError('not-found', 'There is no such member'))
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${APOLLO}/members/${BOB}`,
      headers: alice,
    })
    expect(response.statusCode).toBe(404)
  })
})

describe('the OpenAPI description', () => {
  it('describes the member routes with the four roles', async () => {
    const { app } = stubbed()
    const response = await app.inject({ method: 'GET', url: '/api/openapi.json', headers: alice })
    const paths = response.json().paths
    expect(Object.keys(paths['/api/projects/{projectId}/members'])).toEqual(['get'])
    expect(Object.keys(paths['/api/projects/{projectId}/members/{accountId}']).sort()).toEqual([
      'delete',
      'put',
    ])
    const put = paths['/api/projects/{projectId}/members/{accountId}'].put
    expect(put.requestBody.content['application/json'].schema.properties.role.enum).toEqual([
      'read-only',
      'contributor',
      'read-write',
      'admin',
    ])
  })
})
