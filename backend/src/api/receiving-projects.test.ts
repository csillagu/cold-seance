import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { ServiceError } from '../service/errors.ts'
import type { ReceivingRepository } from '../service/receiving-projects.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The routes of the receiving project register translate requests for the service and nothing
// more (DD-039); the rules themselves are tested against the database in
// test/integration/receiving-projects.test.ts. Here the service is a stub, so these tests show
// what each route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const PROJECT_ID = '6f1c2a5e-0000-4000-8000-0000000000a1'
const REPO_ID = '6f1c2a5e-0000-4000-8000-0000000000c1'

const RECEIVING: ReceivingRepository = {
  repository: { id: REPO_ID, githubId: 7001, owner: 'csillagu', name: 'tc-repo' },
  pulls: true,
}
const sent = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown

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
  const service = services.receivingProjects
  const stubs = {
    listReceiving: vi.spyOn(service, 'listReceiving'),
    markReceiving: vi.spyOn(service, 'markReceiving'),
    giveUpReceiving: vi.spyOn(service, 'giveUpReceiving'),
  }
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, stubs }
}

const one = `/api/projects/${PROJECT_ID}/receiving-repositories/${REPO_ID}`

describe('GET /api/projects/:projectId/receiving-repositories', () => {
  it('hands the service the caller and the project and sends its repositories', async () => {
    const { app, stubs } = stubbed()
    stubs.listReceiving.mockResolvedValue([RECEIVING])
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT_ID}/receiving-repositories`,
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([sent(RECEIVING)])
    expect(stubs.listReceiving).toHaveBeenCalledWith(caller, PROJECT_ID)
  })

  it('answers a project the caller cannot see as 403 Not Visible', async () => {
    const { app, stubs } = stubbed()
    stubs.listReceiving.mockRejectedValue(
      new ServiceError('not-visible', 'This project is not visible to you'),
    )
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT_ID}/receiving-repositories`,
      headers: erin,
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: 'Not Visible' })
  })

  it('refuses a caller no authenticator recognises before the service is asked', async () => {
    const { app, stubs } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT_ID}/receiving-repositories`,
    })
    expect(response.statusCode).toBe(401)
    expect(stubs.listReceiving).not.toHaveBeenCalled()
  })
})

describe('PUT /api/projects/:projectId/receiving-repositories/:repositoryId', () => {
  it('hands the service the caller, the project and the repository and sends the marking', async () => {
    const { app, stubs } = stubbed()
    stubs.markReceiving.mockResolvedValue(RECEIVING)
    const response = await app.inject({ method: 'PUT', url: one, headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(sent(RECEIVING))
    expect(stubs.markReceiving).toHaveBeenCalledWith(caller, PROJECT_ID, REPO_ID)
  })

  it('takes an empty object as the body', async () => {
    const { app, stubs } = stubbed()
    stubs.markReceiving.mockResolvedValue(RECEIVING)
    const response = await app.inject({ method: 'PUT', url: one, headers: erin, payload: {} })
    expect(response.statusCode).toBe(200)
  })

  it.each([
    ['a project id', `/api/projects/apollo/receiving-repositories/${REPO_ID}`],
    ['a repository id', `/api/projects/${PROJECT_ID}/receiving-repositories/csillagu%2Ftc-repo`],
  ])('refuses %s that is not a UUID before the service is asked', async (_, url) => {
    const { app, stubs } = stubbed()
    const response = await app.inject({ method: 'PUT', url, headers: erin })
    expect(response.statusCode).toBe(400)
    expect(stubs.markReceiving).not.toHaveBeenCalled()
  })

  it.each([
    [
      'invalid',
      400,
      'A project can be marked as receiving only for a repository it pulls issues from',
    ],
    ['forbidden', 403, "Only the project's admins can manage its members"],
    ['conflict', 409, 'Another project is already the receiving project of this repository'],
  ] as const)(
    "answers the service's %s refusal as %i with its message",
    async (kind, status, message) => {
      const { app, stubs } = stubbed()
      stubs.markReceiving.mockRejectedValue(new ServiceError(kind, message))
      const response = await app.inject({ method: 'PUT', url: one, headers: erin })
      expect(response.statusCode).toBe(status)
      expect(response.json()).toMatchObject({ message })
    },
  )
})

describe('DELETE /api/projects/:projectId/receiving-repositories/:repositoryId', () => {
  it('hands the service the caller, the project and the repository and answers 204', async () => {
    const { app, stubs } = stubbed()
    stubs.giveUpReceiving.mockResolvedValue()
    const response = await app.inject({ method: 'DELETE', url: one, headers: erin })
    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
    expect(stubs.giveUpReceiving).toHaveBeenCalledWith(caller, PROJECT_ID, REPO_ID)
  })

  it("answers the service's conflict as 409 with its message", async () => {
    const { app, stubs } = stubbed()
    const message = "This project is not the repository's receiving project"
    stubs.giveUpReceiving.mockRejectedValue(new ServiceError('conflict', message))
    const response = await app.inject({ method: 'DELETE', url: one, headers: erin })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ message })
  })

  it('refuses a caller no authenticator recognises before the service is asked', async () => {
    const { app, stubs } = stubbed()
    const response = await app.inject({ method: 'DELETE', url: one })
    expect(response.statusCode).toBe(401)
    expect(stubs.giveUpReceiving).not.toHaveBeenCalled()
  })
})
