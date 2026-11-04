import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { notVisible, ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import {
  FINISHED_TASK_MESSAGE,
  REFERENCED_MILESTONE_MESSAGE,
} from '../service/task-cancellation.ts'
import type { Task } from '../service/tasks.ts'
import type { Authenticator } from './caller.ts'

// The cancel route translates requests for the task cancellation and nothing more (DD-039); the
// rules themselves are tested against the database in test/integration/task-cancellation.test.ts.
// Here the service is a stub, so these tests show what the route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const TASK: Task = {
  id: '6f1c2a5e-0000-4000-8000-0000000000b1',
  projectId: '6f1c2a5e-0000-4000-8000-0000000000a1',
  title: 'Write install guide',
  description: '',
  status: 'cancelled',
  plannedStart: null,
  plannedFinish: null,
  durationWorkingDays: null,
  effort: null,
  aiShare: null,
  milestone: null,
  eligibility: null,
  assignees: [],
  withoutReadAccess: [],
  actualStart: null,
  actualFinish: null,
  githubIssue: null,
}
const url = `/api/tasks/${TASK.id}/cancel`

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
  const cancel = vi.spyOn(services.taskCancellation, 'cancel')
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, cancel }
}

describe('POST /api/tasks/:taskId/cancel', () => {
  it('hands the service the caller and the task with no body, and sends the task', async () => {
    const { app, cancel } = stubbed()
    cancel.mockResolvedValue(TASK)
    const response = await app.inject({ method: 'POST', url, headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(TASK)
    expect(cancel).toHaveBeenCalledWith(caller, TASK.id)
  })

  it('takes an empty object as the body too', async () => {
    const { app, cancel } = stubbed()
    cancel.mockResolvedValue(TASK)
    const response = await app.inject({ method: 'POST', url, headers: erin, payload: {} })
    expect(response.statusCode).toBe(200)
    expect(cancel).toHaveBeenCalledWith(caller, TASK.id)
  })

  it("sends the service's conflict as 409, with its message", async () => {
    const { app, cancel } = stubbed()
    cancel.mockRejectedValue(new ServiceError('conflict', REFERENCED_MILESTONE_MESSAGE))
    const response = await app.inject({ method: 'POST', url, headers: erin })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: REFERENCED_MILESTONE_MESSAGE,
    })
  })

  it("sends the service's refusal of a finished task as 400, with its message", async () => {
    const { app, cancel } = stubbed()
    cancel.mockRejectedValue(new ServiceError('invalid', FINISHED_TASK_MESSAGE))
    const response = await app.inject({ method: 'POST', url, headers: erin })
    expect(response.statusCode).toBe(400)
    expect(response.json().message).toBe(FINISHED_TASK_MESSAGE)
  })

  it.each([
    ['forbidden', 403],
    ['not-found', 404],
  ] as const)('sends a %s refusal as %i', async (kind, code) => {
    const { app, cancel } = stubbed()
    cancel.mockRejectedValue(new ServiceError(kind, 'no'))
    const response = await app.inject({ method: 'POST', url, headers: erin })
    expect(response.statusCode).toBe(code)
  })

  it('sends a task in a project the caller cannot see as not visible', async () => {
    const { app, cancel } = stubbed()
    cancel.mockRejectedValue(notVisible())
    const response = await app.inject({ method: 'POST', url, headers: erin })
    expect(response.statusCode).toBe(403)
    expect(response.json().message).toBe(notVisible().message)
  })

  it('drops any field sent, such as a status, which the cancellation sets', async () => {
    const { app, cancel } = stubbed()
    cancel.mockResolvedValue(TASK)
    const response = await app.inject({
      method: 'POST',
      url,
      headers: erin,
      payload: { status: 'done' },
    })
    expect(response.statusCode).toBe(200)
    expect(cancel).toHaveBeenCalledWith(caller, TASK.id)
  })

  it('refuses a body that is not an object before the service is asked', async () => {
    const { app, cancel } = stubbed()
    const response = await app.inject({ method: 'POST', url, headers: erin, payload: [1] })
    expect(response.statusCode).toBe(400)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('refuses a task id that is not one before the service is asked', async () => {
    const { app, cancel } = stubbed()
    const response = await app.inject({
      method: 'POST',
      url: '/api/tasks/build/cancel',
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('refuses a caller who is not signed in before the service is asked', async () => {
    const { app, cancel } = stubbed()
    const response = await app.inject({ method: 'POST', url })
    expect(response.statusCode).toBe(401)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('is described in the OpenAPI description, answering the task', async () => {
    const { app } = stubbed()
    const paths = (
      await app.inject({ method: 'GET', url: '/api/openapi.json', headers: erin })
    ).json().paths
    expect(Object.keys(paths['/api/tasks/{taskId}/cancel'])).toEqual(['post'])
    const operation = paths['/api/tasks/{taskId}/cancel'].post
    expect(operation.description).toMatch(/blocked by whatever it was blocked by/)
    const task = operation.responses['200'].content['application/json'].schema
    expect(task.properties.status.enum).toContain('cancelled')
  })
})
