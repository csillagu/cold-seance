import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { notVisible, ServiceError } from '../service/errors.ts'
import type { SavedView } from '../service/saved-views.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The saved view routes and the group deletion route translate requests for the service layer
// and nothing more (DD-039); the rules are tested against the database in
// test/integration/saved-views.test.ts. Here the services are stubs, so these tests show what the
// routes hand them and what they send back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const APOLLO = '6f1c2a5e-0000-4000-8000-0000000000c1'
const PLATFORM = '6f1c2a5e-0000-4000-8000-0000000000d1'
const VIEW = '6f1c2a5e-0000-4000-8000-0000000000e1'
const SAVED: SavedView = {
  id: VIEW,
  name: 'MY kanban',
  kind: 'kanban',
  keptIn: 'group',
  projectId: null,
  groupId: PLATFORM,
  ownerId: null,
  projects: [APOLLO],
  filter: [{ field: 'assignees', operator: 'contains', value: { viewer: true } }],
}

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
  const views = services.savedViews
  const spies = {
    saveView: vi.spyOn(views, 'saveView'),
    listViews: vi.spyOn(views, 'listViews'),
    listProjectViews: vi.spyOn(views, 'listProjectViews'),
    listGroupViews: vi.spyOn(views, 'listGroupViews'),
    getView: vi.spyOn(views, 'getView'),
    openView: vi.spyOn(views, 'openView'),
    deleteGroup: vi.spyOn(services.groups, 'deleteGroup'),
  }
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, ...spies }
}

describe('the saved view routes', () => {
  it('hands POST /api/saved-views the body as given, and answers 201 with the view', async () => {
    const { app, saveView } = stubbed()
    saveView.mockResolvedValue(SAVED)
    const body = {
      name: 'MY kanban',
      kind: 'kanban',
      keptIn: 'group',
      groupId: PLATFORM,
      projects: [APOLLO],
      filter: SAVED.filter,
    }
    const response = await app.inject({
      method: 'POST',
      url: '/api/saved-views',
      headers: erin,
      payload: body,
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual(SAVED)
    expect(saveView).toHaveBeenCalledWith(caller, body)
  })

  it('refuses a kind that has no saved views before the service is called', async () => {
    const { app, saveView } = stubbed()
    const response = await app.inject({
      method: 'POST',
      url: '/api/saved-views',
      headers: erin,
      payload: { name: 'Load view', kind: 'person-load', keptIn: 'personal', projects: [APOLLO] },
    })
    expect(response.statusCode).toBe(400)
    expect(saveView).not.toHaveBeenCalled()
  })

  it('lists, reads and opens views through the service', async () => {
    const { app, listViews, listProjectViews, listGroupViews, getView, openView } = stubbed()
    listViews.mockResolvedValue([SAVED])
    listProjectViews.mockResolvedValue([])
    listGroupViews.mockResolvedValue([SAVED])
    getView.mockResolvedValue(SAVED)
    openView.mockResolvedValue([])
    const get = (url: string) => app.inject({ method: 'GET', url: `/api${url}`, headers: erin })

    expect((await get('/saved-views')).json()).toEqual([SAVED])
    expect(listViews).toHaveBeenCalledWith(caller)
    expect((await get(`/projects/${APOLLO}/saved-views`)).json()).toEqual([])
    expect(listProjectViews).toHaveBeenCalledWith(caller, APOLLO)
    expect((await get(`/groups/${PLATFORM}/saved-views`)).json()).toEqual([SAVED])
    expect(listGroupViews).toHaveBeenCalledWith(caller, PLATFORM)
    expect((await get(`/saved-views/${VIEW}`)).json()).toEqual(SAVED)
    expect(getView).toHaveBeenCalledWith(caller, VIEW)
    expect((await get(`/saved-views/${VIEW}/tasks`)).json()).toEqual([])
    expect(openView).toHaveBeenCalledWith(caller, VIEW)
  })

  it("answers the service's refusals with their statuses", async () => {
    const { app, getView } = stubbed()
    const cases = [
      [new ServiceError('not-found', 'There is no such saved view'), 404],
      [notVisible(), 403],
    ] as const
    for (const [error, status] of cases) {
      getView.mockRejectedValueOnce(error)
      const response = await app.inject({
        method: 'GET',
        url: `/api/saved-views/${VIEW}`,
        headers: erin,
      })
      expect(response.statusCode).toBe(status)
    }
  })
})

describe('DELETE /api/groups/:groupId', () => {
  it('hands the service the caller and the group, and answers 204', async () => {
    const { app, deleteGroup } = stubbed()
    deleteGroup.mockResolvedValue()
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/groups/${PLATFORM}`,
      headers: erin,
    })
    expect(response.statusCode).toBe(204)
    expect(deleteGroup).toHaveBeenCalledWith(caller, PLATFORM)
  })

  it('answers a refusal with 403', async () => {
    const { app, deleteGroup } = stubbed()
    deleteGroup.mockRejectedValue(
      new ServiceError('forbidden', 'Only system admins can delete a group'),
    )
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/groups/${PLATFORM}`,
      headers: erin,
    })
    expect(response.statusCode).toBe(403)
  })
})
