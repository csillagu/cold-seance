import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { notVisible, ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The group routes translate requests for the group service and nothing more (DD-039); the rules
// themselves are tested against the database in test/integration/groups.test.ts. Here the service
// is a stub, so these tests show what each route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const GROUP = { id: '6f1c2a5e-0000-4000-8000-0000000000b1', name: "Erin's group" }
const MEMBER = { accountId: ERIN, username: 'erin', role: 'admin' as const }
const BOB = '6f1c2a5e-0000-4000-8000-000000000002'
const PROJECT = { id: '6f1c2a5e-0000-4000-8000-0000000000a1', name: 'Apollo' }

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
    setMemberRole: vi.spyOn(services.groups, 'setMemberRole'),
    removeMember: vi.spyOn(services.groups, 'removeMember'),
    leaveGroup: vi.spyOn(services.groups, 'leaveGroup'),
    listProjects: vi.spyOn(services.groups, 'listProjects'),
    addProject: vi.spyOn(services.groups, 'addProject'),
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

describe('PUT /api/groups/:groupId/members/:accountId', () => {
  const url = `/api/groups/${GROUP.id}/members/${BOB}`
  const BOB_MEMBER = { accountId: BOB, username: 'bob', role: 'contributor' as const }

  it('hands the service the caller, the group, the person and the role and sends the member', async () => {
    const { app, groups } = stubbed()
    groups.setMemberRole.mockResolvedValue(BOB_MEMBER)
    const response = await app.inject({
      method: 'PUT',
      url,
      headers: erin,
      payload: { role: 'contributor' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(BOB_MEMBER)
    expect(groups.setMemberRole).toHaveBeenCalledWith(caller, GROUP.id, BOB, 'contributor')
  })

  it.each([
    ['no role', url, {}],
    ['a role that is not one of the four', url, { role: 'owner' }],
    ['a group id that is not a UUID', `/api/groups/platform/members/${BOB}`, { role: 'admin' }],
    ['an account id that is not a UUID', `/api/groups/${GROUP.id}/members/bob`, { role: 'admin' }],
  ])('refuses %s before the service is asked', async (_, target, payload) => {
    const { app, groups } = stubbed()
    const response = await app.inject({ method: 'PUT', url: target, headers: erin, payload })
    expect(response.statusCode).toBe(400)
    expect(groups.setMemberRole).not.toHaveBeenCalled()
  })

  it.each([
    ['forbidden', 403, "Only the group's admins can manage its members"],
    ['not-found', 404, 'There is no such account'],
    ['conflict', 409, 'A group must keep at least one admin'],
  ] as const)('answers a %s refusal with %i and its message', async (kind, statusCode, message) => {
    const { app, groups } = stubbed()
    groups.setMemberRole.mockRejectedValue(new ServiceError(kind, message))
    const response = await app.inject({
      method: 'PUT',
      url,
      headers: erin,
      payload: { role: 'read-only' },
    })
    expect(response.statusCode).toBe(statusCode)
    expect(response.json().message).toBe(message)
  })

  it('refuses a caller no authenticator recognises with 401', async () => {
    const { app, groups } = stubbed()
    const response = await app.inject({ method: 'PUT', url, payload: { role: 'read-only' } })
    expect(response.statusCode).toBe(401)
    expect(groups.setMemberRole).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/groups/:groupId/members/:accountId', () => {
  const url = `/api/groups/${GROUP.id}/members/${BOB}`

  it('hands the service the caller, the group and the person and answers 204', async () => {
    const { app, groups } = stubbed()
    groups.removeMember.mockResolvedValue(undefined)
    const response = await app.inject({ method: 'DELETE', url, headers: erin })
    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
    expect(groups.removeMember).toHaveBeenCalledWith(caller, GROUP.id, BOB)
  })

  it('refuses an account id that is not a UUID before the service is asked', async () => {
    const { app, groups } = stubbed()
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/groups/${GROUP.id}/members/bob`,
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(groups.removeMember).not.toHaveBeenCalled()
  })

  it.each([
    ['forbidden', 403, "Only the group's admins can manage its members"],
    ['not-found', 404, 'There is no such member'],
    ['conflict', 409, 'A group must keep at least one admin'],
  ] as const)('answers a %s refusal with %i and its message', async (kind, statusCode, message) => {
    const { app, groups } = stubbed()
    groups.removeMember.mockRejectedValue(new ServiceError(kind, message))
    const response = await app.inject({ method: 'DELETE', url, headers: erin })
    expect(response.statusCode).toBe(statusCode)
    expect(response.json().message).toBe(message)
  })

  it('refuses a caller no authenticator recognises with 401', async () => {
    const { app, groups } = stubbed()
    const response = await app.inject({ method: 'DELETE', url })
    expect(response.statusCode).toBe(401)
    expect(groups.removeMember).not.toHaveBeenCalled()
  })
})

describe('POST /api/groups/:groupId/leave', () => {
  const url = `/api/groups/${GROUP.id}/leave`

  it('hands the service the caller and the group and answers 204', async () => {
    const { app, groups } = stubbed()
    groups.leaveGroup.mockResolvedValue(undefined)
    const response = await app.inject({ method: 'POST', url, headers: erin })
    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
    expect(groups.leaveGroup).toHaveBeenCalledWith(caller, GROUP.id)
  })

  it('takes an empty object as its body too', async () => {
    const { app, groups } = stubbed()
    groups.leaveGroup.mockResolvedValue(undefined)
    const response = await app.inject({ method: 'POST', url, headers: erin, payload: {} })
    expect(response.statusCode).toBe(204)
    expect(groups.leaveGroup).toHaveBeenCalledWith(caller, GROUP.id)
  })

  it('refuses a group id that is not a UUID before the service is asked', async () => {
    const { app, groups } = stubbed()
    const response = await app.inject({
      method: 'POST',
      url: '/api/groups/platform/leave',
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(groups.leaveGroup).not.toHaveBeenCalled()
  })

  it.each([
    ['not-found', 404, 'You are not a member of this group'],
    ['conflict', 409, "The group's last admin cannot leave it"],
  ] as const)('answers a %s refusal with %i and its message', async (kind, statusCode, message) => {
    const { app, groups } = stubbed()
    groups.leaveGroup.mockRejectedValue(new ServiceError(kind, message))
    const response = await app.inject({ method: 'POST', url, headers: erin })
    expect(response.statusCode).toBe(statusCode)
    expect(response.json().message).toBe(message)
  })

  it('refuses a caller no authenticator recognises with 401', async () => {
    const { app, groups } = stubbed()
    const response = await app.inject({ method: 'POST', url })
    expect(response.statusCode).toBe(401)
    expect(groups.leaveGroup).not.toHaveBeenCalled()
  })
})

describe('GET /api/groups/:groupId/projects', () => {
  const url = `/api/groups/${GROUP.id}/projects`

  it("hands the service the caller and the group and sends the group's projects", async () => {
    const { app, groups } = stubbed()
    groups.listProjects.mockResolvedValue([PROJECT])
    const response = await app.inject({ method: 'GET', url, headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([PROJECT])
    expect(groups.listProjects).toHaveBeenCalledWith(caller, GROUP.id)
  })

  it('refuses a group id that is not a UUID before the service is asked', async () => {
    const { app, groups } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/groups/platform/projects',
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(groups.listProjects).not.toHaveBeenCalled()
  })

  it("answers a not-found refusal with 404 and the service's message", async () => {
    const { app, groups } = stubbed()
    groups.listProjects.mockRejectedValue(new ServiceError('not-found', 'There is no such group'))
    const response = await app.inject({ method: 'GET', url, headers: erin })
    expect(response.statusCode).toBe(404)
    expect(response.json().message).toBe('There is no such group')
  })

  it('refuses a caller no authenticator recognises with 401', async () => {
    const { app, groups } = stubbed()
    const response = await app.inject({ method: 'GET', url })
    expect(response.statusCode).toBe(401)
    expect(groups.listProjects).not.toHaveBeenCalled()
  })
})

describe('PUT /api/groups/:groupId/projects/:projectId', () => {
  const url = `/api/groups/${GROUP.id}/projects/${PROJECT.id}`

  it('hands the service the caller, the group and the project and sends the project', async () => {
    const { app, groups } = stubbed()
    groups.addProject.mockResolvedValue(PROJECT)
    const response = await app.inject({ method: 'PUT', url, headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(PROJECT)
    expect(groups.addProject).toHaveBeenCalledWith(caller, GROUP.id, PROJECT.id)
  })

  it.each([
    ['an empty object', {}],
    ['fields the route does not take, which it drops', { role: 'admin' }],
  ])('takes %s as its body too', async (_, payload) => {
    const { app, groups } = stubbed()
    groups.addProject.mockResolvedValue(PROJECT)
    const response = await app.inject({ method: 'PUT', url, headers: erin, payload })
    expect(response.statusCode).toBe(200)
    expect(groups.addProject).toHaveBeenCalledWith(caller, GROUP.id, PROJECT.id)
  })

  it.each([
    ['a group id that is not a UUID', `/api/groups/platform/projects/${PROJECT.id}`, undefined],
    ['a project id that is not a UUID', `/api/groups/${GROUP.id}/projects/apollo`, undefined],
  ])('refuses %s before the service is asked', async (_, target, payload) => {
    const { app, groups } = stubbed()
    const response = await app.inject({
      method: 'PUT',
      url: target,
      headers: erin,
      ...(payload ? { payload } : {}),
    })
    expect(response.statusCode).toBe(400)
    expect(groups.addProject).not.toHaveBeenCalled()
  })

  it.each([
    [
      'forbidden',
      new ServiceError(
        'forbidden',
        "Only the project's admins can manage its members, roles, repositories and settings",
      ),
      403,
    ],
    ['not-visible', notVisible(), 403],
    ['not-found', new ServiceError('not-found', 'There is no such group'), 404],
  ] as const)('answers a %s refusal with %i and its message', async (_, error, statusCode) => {
    const { app, groups } = stubbed()
    groups.addProject.mockRejectedValue(error)
    const response = await app.inject({ method: 'PUT', url, headers: erin })
    expect(response.statusCode).toBe(statusCode)
    expect(response.json().message).toBe(error.message)
  })

  it('refuses a caller no authenticator recognises with 401', async () => {
    const { app, groups } = stubbed()
    const response = await app.inject({ method: 'PUT', url })
    expect(response.statusCode).toBe(401)
    expect(groups.addProject).not.toHaveBeenCalled()
  })
})
