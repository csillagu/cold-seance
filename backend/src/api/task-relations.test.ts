import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { notVisible, ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import type { TaskRelations } from '../service/task-relations.ts'
import type { Authenticator } from './caller.ts'

// The task relation routes translate requests for the task relation service and nothing more
// (DD-039); the rules themselves are tested against the database in
// test/integration/task-relations.test.ts. Here the service is a stub, so these tests show what
// each route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const APOLLO = '6f1c2a5e-0000-4000-8000-0000000000a1'
const BOREALIS = '6f1c2a5e-0000-4000-8000-0000000000a2'
const TASK = '6f1c2a5e-0000-4000-8000-0000000000b1'
const PARENT = '6f1c2a5e-0000-4000-8000-0000000000b2'
const BLOCKER = '6f1c2a5e-0000-4000-8000-0000000000b3'
const MILESTONE = '6f1c2a5e-0000-4000-8000-0000000000b4'

const RELATIONS: TaskRelations = {
  taskId: TASK,
  parent: { id: PARENT, projectId: APOLLO },
  subtasks: [],
  blockedBy: [
    { id: BLOCKER, projectId: APOLLO },
    { id: MILESTONE, projectId: BOREALIS },
  ],
}
const NONE: TaskRelations = { taskId: TASK, parent: null, subtasks: [], blockedBy: [] }

const asErin: Authenticator = async (request) =>
  request.headers.authorization === 'Bearer erin'
    ? { accountId: ERIN, channel: 'rest-api' }
    : undefined
const erin = { authorization: 'Bearer erin' }
const caller = { accountId: ERIN, channel: 'rest-api' }

let closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(closers.map((close) => close()))
  closers = []
})

function stubbed() {
  const { db, close } = createDatabase('postgres://nobody@unused.invalid/none')
  const services = createServices(db)
  const relations = {
    getRelations: vi.spyOn(services.taskRelations, 'getRelations'),
    setParent: vi.spyOn(services.taskRelations, 'setParent'),
    addBlocker: vi.spyOn(services.taskRelations, 'addBlocker'),
    removeBlocker: vi.spyOn(services.taskRelations, 'removeBlocker'),
  }
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, relations }
}

describe('GET /api/tasks/:taskId/relations', () => {
  it("hands the service the caller and the task, and sends the task's relations", async () => {
    const { app, relations } = stubbed()
    relations.getRelations.mockResolvedValue(RELATIONS)
    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${TASK}/relations`,
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(RELATIONS)
    expect(relations.getRelations).toHaveBeenCalledWith(caller, TASK)
  })

  it('answers a project the caller cannot see with 403 Not Visible', async () => {
    const { app, relations } = stubbed()
    relations.getRelations.mockRejectedValue(notVisible())
    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${TASK}/relations`,
      headers: erin,
    })
    expect(response.statusCode).toBe(403)
    expect(response.json().error).toBe('Not Visible')
  })

  it('refuses a task id that is not a UUID before the service is asked', async () => {
    const { app, relations } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/tasks/build/relations',
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(relations.getRelations).not.toHaveBeenCalled()
  })

  it('refuses a caller who is not authenticated before the service is asked', async () => {
    const { app, relations } = stubbed()
    const response = await app.inject({ method: 'GET', url: `/api/tasks/${TASK}/relations` })
    expect(response.statusCode).toBe(401)
    expect(relations.getRelations).not.toHaveBeenCalled()
  })
})

describe('PUT /api/tasks/:taskId/parent', () => {
  const url = `/api/tasks/${TASK}/parent`

  it.each([
    ['a parent', PARENT, RELATIONS],
    ['no parent', null, NONE],
  ])('hands the service %s, and sends the relations', async (_, parentId, answer) => {
    const { app, relations } = stubbed()
    relations.setParent.mockResolvedValue(answer)
    const response = await app.inject({ method: 'PUT', url, headers: erin, payload: { parentId } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(answer)
    expect(relations.setParent).toHaveBeenCalledWith(caller, TASK, parentId)
  })

  it("sends the service's refusal of a milestone as 400, with its message", async () => {
    const { app, relations } = stubbed()
    const message = 'A task cannot be a subtask of a milestone'
    relations.setParent.mockRejectedValue(new ServiceError('invalid', message))
    const response = await app.inject({
      method: 'PUT',
      url,
      headers: erin,
      payload: { parentId: MILESTONE },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().message).toBe(message)
  })

  it.each([
    ['no parentId', {}],
    ['a parentId that is not text', { parentId: { id: PARENT } }],
  ])('refuses %s before the service is asked', async (_, payload) => {
    const { app, relations } = stubbed()
    const response = await app.inject({ method: 'PUT', url, headers: erin, payload })
    expect(response.statusCode).toBe(400)
    expect(relations.setParent).not.toHaveBeenCalled()
  })
})

describe('POST /api/tasks/:taskId/blocked-by', () => {
  const url = `/api/tasks/${TASK}/blocked-by`

  it('hands the service the caller, the task and the blocker, and sends the relations', async () => {
    const { app, relations } = stubbed()
    relations.addBlocker.mockResolvedValue(RELATIONS)
    const response = await app.inject({
      method: 'POST',
      url,
      headers: erin,
      payload: { blockerId: MILESTONE },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(RELATIONS)
    expect(relations.addBlocker).toHaveBeenCalledWith(caller, TASK, MILESTONE)
  })

  it.each([
    ['invalid', 400],
    ['not-visible', 403],
    ['forbidden', 403],
    ['not-found', 404],
  ] as const)('sends a refusal as %s with %i', async (kind, status) => {
    const { app, relations } = stubbed()
    relations.addBlocker.mockRejectedValue(new ServiceError(kind, 'refused'))
    const response = await app.inject({
      method: 'POST',
      url,
      headers: erin,
      payload: { blockerId: BLOCKER },
    })
    expect(response.statusCode).toBe(status)
  })

  it.each([
    ['no blockerId', {}],
    ['a blockerId that is not text', { blockerId: { id: BLOCKER } }],
  ])('refuses %s before the service is asked', async (_, payload) => {
    const { app, relations } = stubbed()
    const response = await app.inject({ method: 'POST', url, headers: erin, payload })
    expect(response.statusCode).toBe(400)
    expect(relations.addBlocker).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/tasks/:taskId/blocked-by/:blockerId', () => {
  it('hands the service the caller, the task and the blocker, and sends the relations', async () => {
    const { app, relations } = stubbed()
    relations.removeBlocker.mockResolvedValue(NONE)
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/tasks/${TASK}/blocked-by/${BLOCKER}`,
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(NONE)
    expect(relations.removeBlocker).toHaveBeenCalledWith(caller, TASK, BLOCKER)
  })

  it('refuses a blocker id that is not a UUID before the service is asked', async () => {
    const { app, relations } = stubbed()
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/tasks/${TASK}/blocked-by/build`,
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(relations.removeBlocker).not.toHaveBeenCalled()
  })
})

describe('the OpenAPI description', () => {
  it('describes the task relation routes and what they send', async () => {
    const { app } = stubbed()
    const paths = (
      await app.inject({ method: 'GET', url: '/api/openapi.json', headers: erin })
    ).json().paths
    expect(Object.keys(paths['/api/tasks/{taskId}/relations'])).toEqual(['get'])
    expect(Object.keys(paths['/api/tasks/{taskId}/parent'])).toEqual(['put'])
    expect(Object.keys(paths['/api/tasks/{taskId}/blocked-by'])).toEqual(['post'])
    expect(Object.keys(paths['/api/tasks/{taskId}/blocked-by/{blockerId}'])).toEqual(['delete'])
    const sent =
      paths['/api/tasks/{taskId}/relations'].get.responses['200'].content['application/json'].schema
    expect(sent.required).toEqual(['taskId', 'parent', 'subtasks', 'blockedBy'])
    expect(sent.properties.blockedBy.items.required).toEqual(['id', 'projectId'])
  })
})
