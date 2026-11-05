import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { ServiceError } from '../service/errors.ts'
import type { RepositoryRequest } from '../service/project-repositories.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The routes of the project repository approvals translate requests for the service and nothing
// more (DD-039); the rules themselves are tested against the database in
// test/integration/project-repositories.test.ts. Here the service is a stub, so these tests show
// what each route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const BOB = '6f1c2a5e-0000-4000-8000-000000000002'
const PROJECT_ID = '6f1c2a5e-0000-4000-8000-0000000000a1'
const REPO_ID = '6f1c2a5e-0000-4000-8000-0000000000c1'
const REQUEST_ID = '6f1c2a5e-0000-4000-8000-0000000000d1'
const AT = new Date('2026-11-05T10:00:00.000Z')

const REPOSITORY = { id: REPO_ID, githubId: 7001, owner: 'csillagu', name: 'tc-repo' }
const REQUEST: RepositoryRequest = {
  id: REQUEST_ID,
  project: { id: PROJECT_ID, name: 'Apollo' },
  repository: REPOSITORY,
  state: 'requested',
  requestedBy: { accountId: ERIN, username: 'erin' },
  requestedAt: AT,
  decidedBy: null,
  decidedAt: null,
  withdrawnBy: null,
  withdrawnAt: null,
}
const APPROVED: RepositoryRequest = {
  ...REQUEST,
  state: 'approved',
  decidedBy: { accountId: BOB, username: 'bob' },
  decidedAt: AT,
}
const WITHDRAWN: RepositoryRequest = {
  ...APPROVED,
  state: 'withdrawn',
  withdrawnBy: { accountId: BOB, username: 'bob' },
  withdrawnAt: AT,
}
/** A request as it is sent: its times as ISO strings. */
const sent = (request: RepositoryRequest) => JSON.parse(JSON.stringify(request)) as unknown

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
  const service = services.projectRepositories
  const stubs = {
    requestRepository: vi.spyOn(service, 'requestRepository'),
    approveRequest: vi.spyOn(service, 'approveRequest'),
    rejectRequest: vi.spyOn(service, 'rejectRequest'),
    withdrawApproval: vi.spyOn(service, 'withdrawApproval'),
    listProjectRepositories: vi.spyOn(service, 'listProjectRepositories'),
    listProjectRequests: vi.spyOn(service, 'listProjectRequests'),
    listAdminRequests: vi.spyOn(service, 'listAdminRequests'),
  }
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, stubs }
}

describe('GET /api/projects/:projectId/repositories', () => {
  it('hands the service the caller and the project and sends its repositories', async () => {
    const { app, stubs } = stubbed()
    stubs.listProjectRepositories.mockResolvedValue([REPOSITORY])
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT_ID}/repositories`,
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([REPOSITORY])
    expect(stubs.listProjectRepositories).toHaveBeenCalledWith(caller, PROJECT_ID)
  })

  it('answers a project the caller cannot see as 403 Not Visible', async () => {
    const { app, stubs } = stubbed()
    stubs.listProjectRepositories.mockRejectedValue(
      new ServiceError('not-visible', 'This project is not visible to you'),
    )
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT_ID}/repositories`,
      headers: erin,
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'Not Visible' })
  })

  it('refuses a caller no authenticator recognises before the service is asked', async () => {
    const { app, stubs } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT_ID}/repositories`,
    })
    expect(response.statusCode).toBe(401)
    expect(stubs.listProjectRepositories).not.toHaveBeenCalled()
  })
})

describe('GET /api/projects/:projectId/repository-requests', () => {
  it('hands the service the caller and the project and sends its requests', async () => {
    const { app, stubs } = stubbed()
    stubs.listProjectRequests.mockResolvedValue([WITHDRAWN, REQUEST])
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT_ID}/repository-requests`,
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([sent(WITHDRAWN), sent(REQUEST)])
    expect(stubs.listProjectRequests).toHaveBeenCalledWith(caller, PROJECT_ID)
  })

  it('refuses a project id that is not a UUID before the service is asked', async () => {
    const { app, stubs } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/projects/apollo/repository-requests',
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(stubs.listProjectRequests).not.toHaveBeenCalled()
  })
})

describe('POST /api/projects/:projectId/repository-requests', () => {
  const ask = (app: ReturnType<typeof stubbed>['app'], payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/api/projects/${PROJECT_ID}/repository-requests`,
      headers: erin,
      payload,
    })

  it('hands the service the caller, the project and the repository and sends the request as 201', async () => {
    const { app, stubs } = stubbed()
    stubs.requestRepository.mockResolvedValue(REQUEST)
    const response = await ask(app, { repositoryId: REPO_ID })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual(sent(REQUEST))
    expect(stubs.requestRepository).toHaveBeenCalledWith(caller, PROJECT_ID, REPO_ID)
  })

  it('hands the service only the repository, dropping fields the route does not take', async () => {
    const { app, stubs } = stubbed()
    stubs.requestRepository.mockResolvedValue(REQUEST)
    const response = await ask(app, { repositoryId: REPO_ID, state: 'approved' })
    expect(response.statusCode).toBe(201)
    expect(stubs.requestRepository).toHaveBeenCalledWith(caller, PROJECT_ID, REPO_ID)
  })

  it('sends a request approved at once as it is', async () => {
    const { app, stubs } = stubbed()
    stubs.requestRepository.mockResolvedValue(APPROVED)
    const response = await ask(app, { repositoryId: REPO_ID })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ state: 'approved', decidedBy: { username: 'bob' } })
  })

  it.each([
    ['no repository', {}],
    ['a repository id that is not a UUID', { repositoryId: 'csillagu/tc-repo' }],
  ])('refuses %s before the service is asked', async (_, payload) => {
    const { app, stubs } = stubbed()
    const response = await ask(app, payload)
    expect(response.statusCode).toBe(400)
    expect(stubs.requestRepository).not.toHaveBeenCalled()
  })

  it.each([
    ['forbidden', 403, "Only the project's admins can manage its members"],
    ['not-found', 404, 'There is no such registered repository'],
    ['conflict', 409, 'Apollo already pulls issues from csillagu/tc-repo'],
  ] as const)(
    "answers the service's %s refusal as %i with its message",
    async (kind, status, message) => {
      const { app, stubs } = stubbed()
      stubs.requestRepository.mockRejectedValue(new ServiceError(kind, message))
      const response = await ask(app, { repositoryId: REPO_ID })
      expect(response.statusCode).toBe(status)
      expect(response.json()).toMatchObject({ statusCode: status, message })
    },
  )
})

describe('GET /api/repository-requests', () => {
  it('hands the service the caller, and no state when none is asked', async () => {
    const { app, stubs } = stubbed()
    stubs.listAdminRequests.mockResolvedValue([REQUEST])
    const response = await app.inject({
      method: 'GET',
      url: '/api/repository-requests',
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([sent(REQUEST)])
    expect(stubs.listAdminRequests).toHaveBeenCalledWith(caller, undefined)
  })

  it('hands the service the state asked for', async () => {
    const { app, stubs } = stubbed()
    stubs.listAdminRequests.mockResolvedValue([])
    const response = await app.inject({
      method: 'GET',
      url: '/api/repository-requests?state=requested',
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(stubs.listAdminRequests).toHaveBeenCalledWith(caller, 'requested')
  })

  it('refuses a state that is not one before the service is asked', async () => {
    const { app, stubs } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/repository-requests?state=pending',
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(stubs.listAdminRequests).not.toHaveBeenCalled()
  })

  it('drops query parameters the route does not take', async () => {
    const { app, stubs } = stubbed()
    stubs.listAdminRequests.mockResolvedValue([])
    const response = await app.inject({
      method: 'GET',
      url: '/api/repository-requests?owner=csillagu',
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(stubs.listAdminRequests).toHaveBeenCalledWith(caller, undefined)
  })
})

describe.each([
  ['approve', 'approveRequest', APPROVED],
  ['reject', 'rejectRequest', { ...REQUEST, state: 'rejected' as const }],
  ['withdraw', 'withdrawApproval', WITHDRAWN],
] as const)('POST /api/repository-requests/:requestId/%s', (path, method, result) => {
  const url = `/api/repository-requests/${REQUEST_ID}/${path}`

  it(`hands the service's ${method} the caller and the request and sends the request`, async () => {
    const { app, stubs } = stubbed()
    stubs[method].mockResolvedValue(result)
    const response = await app.inject({ method: 'POST', url, headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(sent(result))
    expect(stubs[method]).toHaveBeenCalledWith(caller, REQUEST_ID)
  })

  it('takes an empty body too', async () => {
    const { app, stubs } = stubbed()
    stubs[method].mockResolvedValue(result)
    const response = await app.inject({ method: 'POST', url, headers: erin, payload: {} })
    expect(response.statusCode).toBe(200)
  })

  it('drops fields sent in the body, so a body cannot choose the outcome', async () => {
    const { app, stubs } = stubbed()
    stubs[method].mockResolvedValue(result)
    const response = await app.inject({
      method: 'POST',
      url,
      headers: erin,
      payload: { state: 'approved' },
    })
    expect(response.statusCode).toBe(200)
    expect(stubs[method]).toHaveBeenCalledWith(caller, REQUEST_ID)
  })

  it('refuses a request id that is not a UUID before the service is asked', async () => {
    const { app, stubs } = stubbed()
    const response = await app.inject({
      method: 'POST',
      url: `/api/repository-requests/request-1/${path}`,
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(stubs[method]).not.toHaveBeenCalled()
  })

  it.each([
    ['forbidden', 403],
    ['not-found', 404],
    ['conflict', 409],
  ] as const)("answers the service's %s refusal as %i", async (kind, status) => {
    const { app, stubs } = stubbed()
    stubs[method].mockRejectedValue(new ServiceError(kind, 'refused'))
    const response = await app.inject({ method: 'POST', url, headers: erin })
    expect(response.statusCode).toBe(status)
    expect(response.json()).toMatchObject({ message: 'refused' })
  })
})
