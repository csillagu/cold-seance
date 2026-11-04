import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { notVisible, ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import { OPEN_SUBTASK_MESSAGE } from '../service/task-status-constraints.ts'
import type { Task } from '../service/tasks.ts'
import type { Authenticator } from './caller.ts'

// The status route translates requests for the status transitions and nothing more (DD-039); the
// rules themselves are tested against the database in test/integration/task-status.test.ts. Here
// the service is a stub, so these tests show what the route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const TASK: Task = {
  id: '6f1c2a5e-0000-4000-8000-0000000000b1',
  projectId: '6f1c2a5e-0000-4000-8000-0000000000a1',
  title: 'Write install guide',
  description: '',
  status: 'in-progress',
  plannedStart: '2027-03-01',
  plannedFinish: '2027-03-05',
  durationWorkingDays: 5,
  effort: null,
  aiShare: 0,
  personLoad: 100,
  milestone: null,
  eligibility: null,
  assignees: [],
  loadOverrides: {},
  withoutReadAccess: [],
  actualStart: '2027-03-01',
  actualFinish: null,
  githubIssue: null,
}
const url = `/api/tasks/${TASK.id}/status`

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
  const setStatus = vi.spyOn(services.taskStatus, 'setStatus')
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, setStatus }
}

describe('PUT /api/tasks/:taskId/status', () => {
  it.each<Task['status']>(['in-progress', 'on-hold', 'done'])(
    'hands the service the caller, the task and %s, and sends the task',
    async (status) => {
      const { app, setStatus } = stubbed()
      setStatus.mockResolvedValue({ ...TASK, status })
      const response = await app.inject({ method: 'PUT', url, headers: erin, payload: { status } })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ ...TASK, status })
      expect(setStatus).toHaveBeenCalledWith(caller, TASK.id, status)
    },
  )

  it('leaves it to the service to decide which statuses are valid, and sends its refusal as 400', async () => {
    const { app, setStatus } = stubbed()
    setStatus.mockRejectedValue(
      new ServiceError(
        'invalid',
        'A task is cancelled by cancelling it, not by setting its status',
      ),
    )
    const response = await app.inject({
      method: 'PUT',
      url,
      headers: erin,
      payload: { status: 'cancelled' },
    })
    expect(setStatus).toHaveBeenCalledWith(caller, TASK.id, 'cancelled')
    expect(response.statusCode).toBe(400)
    expect(response.json().message).toBe(
      'A task is cancelled by cancelling it, not by setting its status',
    )
  })

  it("sends the constraint checks' refusal as 409, with its message", async () => {
    const { app, setStatus } = stubbed()
    setStatus.mockRejectedValue(new ServiceError('conflict', OPEN_SUBTASK_MESSAGE))
    const response = await app.inject({
      method: 'PUT',
      url,
      headers: erin,
      payload: { status: 'done' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: OPEN_SUBTASK_MESSAGE,
    })
  })

  it.each([
    ['forbidden', 403],
    ['not-found', 404],
  ] as const)('sends a %s refusal as %i', async (kind, code) => {
    const { app, setStatus } = stubbed()
    setStatus.mockRejectedValue(new ServiceError(kind, 'no'))
    const response = await app.inject({
      method: 'PUT',
      url,
      headers: erin,
      payload: { status: 'done' },
    })
    expect(response.statusCode).toBe(code)
  })

  it('sends a task in a project the caller cannot see as not visible', async () => {
    const { app, setStatus } = stubbed()
    setStatus.mockRejectedValue(notVisible())
    const response = await app.inject({
      method: 'PUT',
      url,
      headers: erin,
      payload: { status: 'done' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json().message).toBe(notVisible().message)
  })

  it('drops any other field, such as an actual start, which only the transitions set', async () => {
    const { app, setStatus } = stubbed()
    setStatus.mockResolvedValue(TASK)
    await app.inject({
      method: 'PUT',
      url,
      headers: erin,
      payload: { status: 'done', actualFinish: '2020-01-01' },
    })
    expect(setStatus).toHaveBeenCalledWith(caller, TASK.id, 'done')
  })

  it.each([
    ['no status', {}],
    ['a status that is an object', { status: { to: 'done' } }],
    ['a body that is not an object', [1]],
  ])('refuses %s before the service is asked', async (_, payload) => {
    const { app, setStatus } = stubbed()
    const response = await app.inject({ method: 'PUT', url, headers: erin, payload })
    expect(response.statusCode).toBe(400)
    expect(setStatus).not.toHaveBeenCalled()
  })

  it('refuses a task id that is not one before the service is asked', async () => {
    const { app, setStatus } = stubbed()
    const response = await app.inject({
      method: 'PUT',
      url: '/api/tasks/build/status',
      headers: erin,
      payload: { status: 'done' },
    })
    expect(response.statusCode).toBe(400)
    expect(setStatus).not.toHaveBeenCalled()
  })

  it('refuses a caller who is not signed in before the service is asked', async () => {
    const { app, setStatus } = stubbed()
    const response = await app.inject({ method: 'PUT', url, payload: { status: 'done' } })
    expect(response.statusCode).toBe(401)
    expect(setStatus).not.toHaveBeenCalled()
  })

  it('is described in the OpenAPI description, answering the task with its actual dates', async () => {
    const { app } = stubbed()
    const paths = (
      await app.inject({ method: 'GET', url: '/api/openapi.json', headers: erin })
    ).json().paths
    expect(Object.keys(paths['/api/tasks/{taskId}/status'])).toEqual(['put'])
    const operation = paths['/api/tasks/{taskId}/status'].put
    expect(operation.requestBody.content['application/json'].schema.required).toEqual(['status'])
    const task = operation.responses['200'].content['application/json'].schema
    expect(task.required).toEqual(expect.arrayContaining(['status', 'actualStart', 'actualFinish']))
    for (const field of ['actualStart', 'actualFinish']) {
      expect(task.properties[field].format).toBe('date')
      expect(task.properties[field].type).toEqual(expect.arrayContaining(['null', 'string']))
    }
  })
})
