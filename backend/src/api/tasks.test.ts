import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { notVisible, ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import type { Task } from '../service/tasks.ts'
import type { Authenticator } from './caller.ts'

// The task routes translate requests for the task service and nothing more (DD-039); the rules
// themselves are tested against the database in test/integration/tasks.test.ts. Here the service
// is a stub, so these tests show what each route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const PROJECT = '6f1c2a5e-0000-4000-8000-0000000000a1'
const TASK: Task = {
  id: '6f1c2a5e-0000-4000-8000-0000000000b1',
  projectId: PROJECT,
  title: 'Write install guide',
  description: 'Steps for a fresh install',
  status: 'not-started',
  plannedStart: '2027-03-01',
  plannedFinish: null,
  durationWorkingDays: 3,
  effort: 5,
  aiShare: 0,
  githubIssue: null,
}
const UNSCHEDULED: Task = {
  ...TASK,
  id: '6f1c2a5e-0000-4000-8000-0000000000b2',
  title: 'Triage backlog',
  description: '',
  plannedStart: null,
  durationWorkingDays: null,
  effort: null,
  aiShare: null,
}

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
  const tasks = {
    createTask: vi.spyOn(services.tasks, 'createTask'),
    updateTask: vi.spyOn(services.tasks, 'updateTask'),
    getTask: vi.spyOn(services.tasks, 'getTask'),
    listTasks: vi.spyOn(services.tasks, 'listTasks'),
  }
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, tasks }
}

describe('POST /api/projects/:projectId/tasks', () => {
  const url = `/api/projects/${PROJECT}/tasks`

  it('hands the service the caller, the project and the fields, and sends the task as 201', async () => {
    const { app, tasks } = stubbed()
    tasks.createTask.mockResolvedValue(TASK)
    const payload = {
      title: 'Write install guide',
      description: 'Steps for a fresh install',
      plannedStart: '2027-03-01',
      durationWorkingDays: 3,
      effort: 5,
      aiShare: 0,
    }
    const response = await app.inject({ method: 'POST', url, headers: erin, payload })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual(TASK)
    expect(tasks.createTask).toHaveBeenCalledWith(caller, PROJECT, payload)
  })

  it('hands on null fields as null, to leave them unset', async () => {
    const { app, tasks } = stubbed()
    tasks.createTask.mockResolvedValue(UNSCHEDULED)
    const payload = { title: 'Triage backlog', plannedStart: null, durationWorkingDays: null }
    const response = await app.inject({ method: 'POST', url, headers: erin, payload })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual(UNSCHEDULED)
    expect(tasks.createTask).toHaveBeenCalledWith(caller, PROJECT, payload)
  })

  it('hands a fractional duration to the service, which decides on it, and sends its 400', async () => {
    const { app, tasks } = stubbed()
    tasks.createTask.mockRejectedValue(
      new ServiceError(
        'invalid',
        "A task's duration is a whole number of working days, at least 1",
      ),
    )
    const response = await app.inject({
      method: 'POST',
      url,
      headers: erin,
      payload: { title: 'Draft schema', durationWorkingDays: 2.5 },
    })
    expect(tasks.createTask).toHaveBeenCalledWith(caller, PROJECT, {
      title: 'Draft schema',
      durationWorkingDays: 2.5,
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().message).toBe(
      "A task's duration is a whole number of working days, at least 1",
    )
  })

  it.each([
    ['no title', {}],
    ['a title that is not text', { title: { text: 'x' } }],
    ['a duration that is not a number', { title: 'x', durationWorkingDays: 'three' }],
    ['an effort that is not a number', { title: 'x', effort: [] }],
  ])('refuses %s before the service is asked', async (_, payload) => {
    const { app, tasks } = stubbed()
    const response = await app.inject({ method: 'POST', url, headers: erin, payload })
    expect(response.statusCode).toBe(400)
    expect(tasks.createTask).not.toHaveBeenCalled()
  })

  it('refuses a project id that is not a UUID before the service is asked', async () => {
    const { app, tasks } = stubbed()
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects/apollo/tasks',
      headers: erin,
      payload: { title: 'x' },
    })
    expect(response.statusCode).toBe(400)
    expect(tasks.createTask).not.toHaveBeenCalled()
  })

  it('answers a refusal by role with 403', async () => {
    const { app, tasks } = stubbed()
    tasks.createTask.mockRejectedValue(
      new ServiceError(
        'forbidden',
        "Only the project's read-write members and admins can edit its plan",
      ),
    )
    const response = await app.inject({
      method: 'POST',
      url,
      headers: erin,
      payload: { title: 'x' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json().error).toBe('Forbidden')
  })

  it('answers a project the caller cannot see with 403 Not Visible', async () => {
    const { app, tasks } = stubbed()
    tasks.createTask.mockRejectedValue(notVisible())
    const response = await app.inject({
      method: 'POST',
      url,
      headers: erin,
      payload: { title: 'x' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({
      statusCode: 403,
      error: 'Not Visible',
      message: 'This project is not visible to you',
    })
  })

  it('refuses a caller no authenticator recognises with 401', async () => {
    const { app, tasks } = stubbed()
    const response = await app.inject({ method: 'POST', url, payload: { title: 'x' } })
    expect(response.statusCode).toBe(401)
    expect(tasks.createTask).not.toHaveBeenCalled()
  })
})

describe('GET /api/projects/:projectId/tasks', () => {
  it("sends the project's tasks, scheduled and unscheduled", async () => {
    const { app, tasks } = stubbed()
    tasks.listTasks.mockResolvedValue([TASK, UNSCHEDULED])
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT}/tasks`,
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([TASK, UNSCHEDULED])
    expect(tasks.listTasks).toHaveBeenCalledWith(caller, PROJECT)
  })
})

describe('GET /api/tasks/:taskId', () => {
  it('hands the service the caller and the task and sends the task', async () => {
    const { app, tasks } = stubbed()
    tasks.getTask.mockResolvedValue(TASK)
    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${TASK.id}`,
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(TASK)
    expect(tasks.getTask).toHaveBeenCalledWith(caller, TASK.id)
  })

  it('answers a task that does not exist with 404', async () => {
    const { app, tasks } = stubbed()
    tasks.getTask.mockRejectedValue(new ServiceError('not-found', 'There is no such task'))
    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${TASK.id}`,
      headers: erin,
    })
    expect(response.statusCode).toBe(404)
    expect(response.json().message).toBe('There is no such task')
  })

  it('refuses a task id that is not a UUID before the service is asked', async () => {
    const { app, tasks } = stubbed()
    const response = await app.inject({ method: 'GET', url: '/api/tasks/first', headers: erin })
    expect(response.statusCode).toBe(400)
    expect(tasks.getTask).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/tasks/:taskId', () => {
  it('hands the service only the fields given, null to clear one, and sends the task', async () => {
    const { app, tasks } = stubbed()
    tasks.updateTask.mockResolvedValue(UNSCHEDULED)
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${TASK.id}`,
      headers: erin,
      payload: { plannedStart: null, effort: 8 },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(UNSCHEDULED)
    expect(tasks.updateTask).toHaveBeenCalledWith(caller, TASK.id, {
      plannedStart: null,
      effort: 8,
    })
  })

  it('drops a field no task has, such as its status, which its own module sets', async () => {
    const { app, tasks } = stubbed()
    tasks.updateTask.mockResolvedValue(TASK)
    await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${TASK.id}`,
      headers: erin,
      payload: { status: 'done', projectId: PROJECT },
    })
    expect(tasks.updateTask).toHaveBeenCalledWith(caller, TASK.id, {})
  })

  it('refuses a body that is not an object before the service is asked', async () => {
    const { app, tasks } = stubbed()
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${TASK.id}`,
      headers: erin,
      payload: [1, 2],
    })
    expect(response.statusCode).toBe(400)
    expect(tasks.updateTask).not.toHaveBeenCalled()
  })
})

describe('the OpenAPI description', () => {
  it('describes the task routes, with the duration in working days only', async () => {
    const { app } = stubbed()
    const paths = (
      await app.inject({ method: 'GET', url: '/api/openapi.json', headers: erin })
    ).json().paths
    expect(Object.keys(paths['/api/projects/{projectId}/tasks']).sort()).toEqual(['get', 'post'])
    expect(Object.keys(paths['/api/tasks/{taskId}']).sort()).toEqual(['get', 'patch'])
    const body =
      paths['/api/projects/{projectId}/tasks'].post.requestBody.content['application/json'].schema
    expect(body.required).toEqual(['title'])
    expect(Object.keys(body.properties).filter((name) => /duration/i.test(name))).toEqual([
      'durationWorkingDays',
    ])
  })
})
