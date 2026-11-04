import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The group routes translate requests for the group service and nothing more (DD-039); the rules
// themselves are tested against the database in test/integration/groups.test.ts. Here the service
// is a stub, so these tests show what each route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const GROUP = { id: '6f1c2a5e-0000-4000-8000-0000000000b1', name: "Erin's group" }
const MEMBER = { accountId: ERIN, username: 'erin', role: 'admin' as const }

const asErin: Authenticator = async (request) =>
  request.headers.authorization === 'Bearer erin' ? { accountId: ERIN, channel: 'ui' } : undefined
const erin = { authorization: 'Bearer erin' }
const caller = { accountId: ERIN, channel: 'ui' }

let closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(closers.map((close) => close()))
  closers = []
})

function stubbed() {
  const { db, close } = createDatabase('postgres://nobody@unused.invalid/none')
  const services = createServices(db)
  const groups = {
    createGroup: vi.spyOn(services.groups, 'createGroup'),
    listGroups: vi.spyOn(services.groups, 'listGroups'),
    listMembers: vi.spyOn(services.groups, 'listMembers'),
  }
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, groups }
}

describe('POST /api/groups', () => {
  it('hands the service the caller and the name and sends the group as 201', async () => {
    const { app, groups } = stubbed()
    groups.createGroup.mockResolvedValue(GROUP)
    const response = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: erin,
      payload: { name: "Erin's group" },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual(GROUP)
    expect(groups.createGroup).toHaveBeenCalledWith(caller, { name: "Erin's group" })
  })

  it.each([
    ['no name', {}],
    ['a name that is not text', { name: { first: 'Platform' } }],
  ])('refuses %s before the service is asked', async (_, payload) => {
    const { app, groups } = stubbed()
    const response = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: erin,
      payload,
    })
    expect(response.statusCode).toBe(400)
    expect(groups.createGroup).not.toHaveBeenCalled()
  })

  it('hands the service only the name, dropping fields the route does not take', async () => {
    const { app, groups } = stubbed()
    groups.createGroup.mockResolvedValue(GROUP)
    const response = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: erin,
      payload: { name: "Erin's group", members: [{ accountId: ERIN, role: 'admin' }] },
    })
    expect(response.statusCode).toBe(201)
    expect(groups.createGroup).toHaveBeenCalledWith(caller, { name: "Erin's group" })
  })

  it("answers 400 with the service's message when it refuses the name", async () => {
    const { app, groups } = stubbed()
    groups.createGroup.mockRejectedValue(new ServiceError('invalid', 'A group name is required'))
    const response = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: erin,
      payload: { name: ' ' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().message).toBe('A group name is required')
  })

  it("answers 409 with the service's message when another group has the name", async () => {
    const { app, groups } = stubbed()
    groups.createGroup.mockRejectedValue(
      new ServiceError('conflict', 'A group named Platform already exists'),
    )
    const response = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: erin,
      payload: { name: 'Platform' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json().message).toBe('A group named Platform already exists')
  })

  it('refuses a caller no authenticator recognises with 401', async () => {
    const { app, groups } = stubbed()
    const response = await app.inject({
      method: 'POST',
      url: '/api/groups',
      payload: { name: 'Platform' },
    })
    expect(response.statusCode).toBe(401)
    expect(groups.createGroup).not.toHaveBeenCalled()
  })
})

describe('GET /api/groups', () => {
  it('sends every group the service lists', async () => {
    const { app, groups } = stubbed()
    groups.listGroups.mockResolvedValue([GROUP])
    const response = await app.inject({ method: 'GET', url: '/api/groups', headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([GROUP])
    expect(groups.listGroups).toHaveBeenCalledWith(caller)
  })

  it('refuses a caller no authenticator recognises with 401', async () => {
    const { app, groups } = stubbed()
    const response = await app.inject({ method: 'GET', url: '/api/groups' })
    expect(response.statusCode).toBe(401)
    expect(groups.listGroups).not.toHaveBeenCalled()
  })
})

describe('GET /api/groups/:groupId/members', () => {
  it('hands the service the caller and the group and sends its members', async () => {
    const { app, groups } = stubbed()
    groups.listMembers.mockResolvedValue([MEMBER])
    const response = await app.inject({
      method: 'GET',
      url: `/api/groups/${GROUP.id}/members`,
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([MEMBER])
    expect(groups.listMembers).toHaveBeenCalledWith(caller, GROUP.id)
  })

  it('refuses a group id that is not a UUID before the service is asked', async () => {
    const { app, groups } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/groups/platform/members',
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(groups.listMembers).not.toHaveBeenCalled()
  })

  it.each([
    ['forbidden', 403, "Only the group's members can see its members"],
    ['not-found', 404, 'There is no such group'],
  ] as const)('answers a %s refusal with %i and its message', async (kind, statusCode, message) => {
    const { app, groups } = stubbed()
    groups.listMembers.mockRejectedValue(new ServiceError(kind, message))
    const response = await app.inject({
      method: 'GET',
      url: `/api/groups/${GROUP.id}/members`,
      headers: erin,
    })
    expect(response.statusCode).toBe(statusCode)
    expect(response.json().message).toBe(message)
  })

  it('refuses a caller no authenticator recognises with 401', async () => {
    const { app, groups } = stubbed()
    const response = await app.inject({ method: 'GET', url: `/api/groups/${GROUP.id}/members` })
    expect(response.statusCode).toBe(401)
    expect(groups.listMembers).not.toHaveBeenCalled()
  })
})
