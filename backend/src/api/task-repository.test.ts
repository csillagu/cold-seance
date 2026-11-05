import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { notVisible, ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import { NOT_PULLED_MESSAGE } from '../service/task-repository.ts'
import type { Task } from '../service/tasks.ts'
import type { Authenticator } from './caller.ts'

// The task repository route translates requests for the task repository assignment and nothing
// more (DD-039); the rules themselves are tested against the database in
// test/integration/task-repository.test.ts. Here the service is a stub, so these tests show what
// the route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const REPOSITORY = '6f1c2a5e-0000-4000-8000-0000000000c1'
const TASK: Task = {
  id: '6f1c2a5e-0000-4000-8000-0000000000b1',
  projectId: '6f1c2a5e-0000-4000-8000-0000000000a1',
  title: 'Write install guide',
  description: '',
  status: 'not-started',
  plannedStart: null,
  plannedFinish: null,
  durationWorkingDays: null,
  effort: null,
  aiShare: null,
  personLoad: 100,
  milestone: null,
  eligibility: null,
  assignees: [],
  loadOverrides: {},
  withoutReadAccess: [],
  actualStart: null,
  actualFinish: null,
  repositoryId: REPOSITORY,
  githubIssue: null,
}
const url = `/api/tasks/${TASK.id}/repository`

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
  const assignRepository = vi.spyOn(services.taskRepository, 'assignRepository')
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, assignRepository }
}

const put = (app: ReturnType<typeof buildApp>, payload: object) =>
  app.inject({ method: 'PUT', url, headers: erin, payload })

describe('PUT /api/tasks/:taskId/repository', () => {
  it('hands the service the caller, the task and the repository, and sends the task', async () => {
    const { app, assignRepository } = stubbed()
    assignRepository.mockResolvedValue(TASK)
    const response = await put(app, { repositoryId: REPOSITORY })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(TASK)
    expect(assignRepository).toHaveBeenCalledWith(caller, TASK.id, REPOSITORY)
  })

  it('hands the service any value given, uncoerced, for it alone to decide on', async () => {
    const { app, assignRepository } = stubbed()
    assignRepository.mockRejectedValue(new ServiceError('invalid', NOT_PULLED_MESSAGE))
    for (const repositoryId of [42, null, 'not-an-id']) {
      const response = await put(app, { repositoryId })
      expect(response.statusCode).toBe(400)
      expect(assignRepository).toHaveBeenLastCalledWith(caller, TASK.id, repositoryId)
    }
  })

  it("sends the service's refusal of a repository the project does not pull from as 400", async () => {
    const { app, assignRepository } = stubbed()
    assignRepository.mockRejectedValue(new ServiceError('invalid', NOT_PULLED_MESSAGE))
    const response = await put(app, { repositoryId: REPOSITORY })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: NOT_PULLED_MESSAGE,
    })
  })

  it.each([
    ['forbidden', 403],
    ['not-found', 404],
  ] as const)('sends a %s refusal as %i', async (kind, code) => {
    const { app, assignRepository } = stubbed()
    assignRepository.mockRejectedValue(new ServiceError(kind, 'no'))
    expect((await put(app, { repositoryId: REPOSITORY })).statusCode).toBe(code)
  })

  it('sends a task in a project the caller cannot see as not visible', async () => {
    const { app, assignRepository } = stubbed()
    assignRepository.mockRejectedValue(notVisible())
    const response = await put(app, { repositoryId: REPOSITORY })
    expect(response.statusCode).toBe(403)
    expect(response.json().message).toBe(notVisible().message)
  })

  it.each([
    ['no repository', {}],
    ['a body that is not an object', [REPOSITORY]],
  ])('refuses %s before the service is asked', async (_, payload) => {
    const { app, assignRepository } = stubbed()
    expect((await put(app, payload)).statusCode).toBe(400)
    expect(assignRepository).not.toHaveBeenCalled()
  })

  it('drops any other field, such as a title, which the assignment does not set', async () => {
    const { app, assignRepository } = stubbed()
    assignRepository.mockResolvedValue(TASK)
    await put(app, { repositoryId: REPOSITORY, title: 'Renamed' })
    expect(assignRepository).toHaveBeenCalledWith(caller, TASK.id, REPOSITORY)
  })

  it('refuses a task id that is not one before the service is asked', async () => {
    const { app, assignRepository } = stubbed()
    const response = await app.inject({
      method: 'PUT',
      url: '/api/tasks/build/repository',
      headers: erin,
      payload: { repositoryId: REPOSITORY },
    })
    expect(response.statusCode).toBe(400)
    expect(assignRepository).not.toHaveBeenCalled()
  })

  it('refuses a caller who is not signed in before the service is asked', async () => {
    const { app, assignRepository } = stubbed()
    const response = await app.inject({ method: 'PUT', url, payload: { repositoryId: REPOSITORY } })
    expect(response.statusCode).toBe(401)
    expect(assignRepository).not.toHaveBeenCalled()
  })

  it('is described in the OpenAPI description, answering the task with its repository', async () => {
    const { app } = stubbed()
    const paths = (
      await app.inject({ method: 'GET', url: '/api/openapi.json', headers: erin })
    ).json().paths
    expect(Object.keys(paths['/api/tasks/{taskId}/repository'])).toEqual(['put'])
    const operation = paths['/api/tasks/{taskId}/repository'].put
    expect(operation.requestBody.content['application/json'].schema.required).toEqual([
      'repositoryId',
    ])
    const task = operation.responses['200'].content['application/json'].schema
    expect(task.required).toContain('repositoryId')
    expect(task.properties.repositoryId.format).toBe('uuid')
    expect(task.properties.repositoryId.type).toEqual(expect.arrayContaining(['null', 'string']))
  })
})
