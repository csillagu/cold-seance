import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The repository routes translate requests for the repository registry and nothing more
// (DD-039); the rules themselves are tested against the database in
// test/integration/repositories.test.ts. Here the service is a stub, so these tests show what each
// route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const BOB = '6f1c2a5e-0000-4000-8000-000000000002'
const REPO_ID = '6f1c2a5e-0000-4000-8000-0000000000c1'
const REPOSITORY = {
  id: REPO_ID,
  githubId: 7001,
  owner: 'csillagu',
  name: 'tc-repo',
  admins: [{ accountId: ERIN, username: 'erin' }],
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
  const repositories = {
    registerRepository: vi.spyOn(services.repositories, 'registerRepository'),
    listRepositories: vi.spyOn(services.repositories, 'listRepositories'),
    getRepository: vi.spyOn(services.repositories, 'getRepository'),
    addAdmin: vi.spyOn(services.repositories, 'addAdmin'),
    addAdminByUsername: vi.spyOn(services.repositories, 'addAdminByUsername'),
    removeAdmin: vi.spyOn(services.repositories, 'removeAdmin'),
  }
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, repositories }
}

describe('GET /api/repositories', () => {
  it('hands the service the caller and sends every repository', async () => {
    const { app, repositories } = stubbed()
    repositories.listRepositories.mockResolvedValue([REPOSITORY])
    const response = await app.inject({ method: 'GET', url: '/api/repositories', headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([REPOSITORY])
    expect(repositories.listRepositories).toHaveBeenCalledWith(caller)
  })

  it('refuses a caller no authenticator recognises before the service is asked', async () => {
    const { app, repositories } = stubbed()
    const response = await app.inject({ method: 'GET', url: '/api/repositories' })
    expect(response.statusCode).toBe(401)
    expect(repositories.listRepositories).not.toHaveBeenCalled()
  })
})

describe('POST /api/repositories', () => {
  it('hands the service the caller, owner and name and sends the repository as 201', async () => {
    const { app, repositories } = stubbed()
    repositories.registerRepository.mockResolvedValue(REPOSITORY)
    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      headers: erin,
      payload: { owner: 'csillagu', name: 'tc-repo' },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual(REPOSITORY)
    expect(repositories.registerRepository).toHaveBeenCalledWith(caller, {
      owner: 'csillagu',
      name: 'tc-repo',
    })
  })

  it.each([
    ['no owner', { name: 'tc-repo' }],
    ['no name', { owner: 'csillagu' }],
    ['a name that is not text', { owner: 'csillagu', name: { first: 'tc-repo' } }],
  ])('refuses %s before the service is asked', async (_, payload) => {
    const { app, repositories } = stubbed()
    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      headers: erin,
      payload,
    })
    expect(response.statusCode).toBe(400)
    expect(repositories.registerRepository).not.toHaveBeenCalled()
  })

  it('hands the service only the owner and name, dropping fields the route does not take', async () => {
    const { app, repositories } = stubbed()
    repositories.registerRepository.mockResolvedValue(REPOSITORY)
    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      headers: erin,
      payload: { owner: 'csillagu', name: 'tc-repo', admins: [BOB] },
    })
    expect(response.statusCode).toBe(201)
    expect(repositories.registerRepository).toHaveBeenCalledWith(caller, {
      owner: 'csillagu',
      name: 'tc-repo',
    })
  })

  it.each([
    ['conflict', 409, 'csillagu/tc-repo is already registered'],
    ['invalid', 400, 'The tool cannot reach csillagu/tc-closed on GitHub'],
    ['unavailable', 503, 'GitHub could not tell whether the tool can reach csillagu/tc-repo'],
  ] as const)(
    "answers the service's %s refusal as %i with its message",
    async (kind, status, message) => {
      const { app, repositories } = stubbed()
      repositories.registerRepository.mockRejectedValue(new ServiceError(kind, message))
      const response = await app.inject({
        method: 'POST',
        url: '/api/repositories',
        headers: erin,
        payload: { owner: 'csillagu', name: 'tc-repo' },
      })
      expect(response.statusCode).toBe(status)
      expect(response.json()).toMatchObject({ statusCode: status, message })
    },
  )
})

describe('GET /api/repositories/:repositoryId', () => {
  it('hands the service the caller and the id and sends the repository', async () => {
    const { app, repositories } = stubbed()
    repositories.getRepository.mockResolvedValue(REPOSITORY)
    const response = await app.inject({
      method: 'GET',
      url: `/api/repositories/${REPO_ID}`,
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(REPOSITORY)
    expect(repositories.getRepository).toHaveBeenCalledWith(caller, REPO_ID)
  })

  it('refuses an id that is not a UUID before the service is asked', async () => {
    const { app, repositories } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/repositories/tc-repo',
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(repositories.getRepository).not.toHaveBeenCalled()
  })

  it('answers a repository the service does not find as 404', async () => {
    const { app, repositories } = stubbed()
    repositories.getRepository.mockRejectedValue(
      new ServiceError('not-found', 'There is no such repository'),
    )
    const response = await app.inject({
      method: 'GET',
      url: `/api/repositories/${REPO_ID}`,
      headers: erin,
    })
    expect(response.statusCode).toBe(404)
  })
})

describe('POST /api/repositories/:repositoryId/admins', () => {
  it('hands the service the caller, the repository and the account and sends the repository', async () => {
    const { app, repositories } = stubbed()
    const changed = {
      ...REPOSITORY,
      admins: [...REPOSITORY.admins, { accountId: BOB, username: 'bob' }],
    }
    repositories.addAdmin.mockResolvedValue(changed)
    const response = await app.inject({
      method: 'POST',
      url: `/api/repositories/${REPO_ID}/admins`,
      headers: erin,
      payload: { accountId: BOB },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(changed)
    expect(repositories.addAdmin).toHaveBeenCalledWith(caller, REPO_ID, BOB)
  })

  it('hands the service a username given in place of the account id', async () => {
    const { app, repositories } = stubbed()
    repositories.addAdminByUsername.mockResolvedValue(REPOSITORY)
    const response = await app.inject({
      method: 'POST',
      url: `/api/repositories/${REPO_ID}/admins`,
      headers: erin,
      payload: { username: 'Bob' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(REPOSITORY)
    expect(repositories.addAdminByUsername).toHaveBeenCalledWith(caller, REPO_ID, 'Bob')
    expect(repositories.addAdmin).not.toHaveBeenCalled()
  })

  it.each([
    ['no account', {}],
    ['an account id that is not a UUID', { accountId: 'bob' }],
    ['both an account id and a username', { accountId: BOB, username: 'bob' }],
  ])('refuses %s before the service is asked', async (_, payload) => {
    const { app, repositories } = stubbed()
    const response = await app.inject({
      method: 'POST',
      url: `/api/repositories/${REPO_ID}/admins`,
      headers: erin,
      payload,
    })
    expect(response.statusCode).toBe(400)
    expect(repositories.addAdmin).not.toHaveBeenCalled()
    expect(repositories.addAdminByUsername).not.toHaveBeenCalled()
  })

  it("answers the service's refusal of someone who may not change the admins as 403", async () => {
    const { app, repositories } = stubbed()
    repositories.addAdmin.mockRejectedValue(
      new ServiceError(
        'forbidden',
        "Only the repository's admins and system admins can change its admins",
      ),
    )
    const response = await app.inject({
      method: 'POST',
      url: `/api/repositories/${REPO_ID}/admins`,
      headers: erin,
      payload: { accountId: BOB },
    })
    expect(response.statusCode).toBe(403)
  })
})

describe('DELETE /api/repositories/:repositoryId/admins/:accountId', () => {
  it('hands the service the caller, the repository and the account and answers 204', async () => {
    const { app, repositories } = stubbed()
    repositories.removeAdmin.mockResolvedValue(undefined)
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/repositories/${REPO_ID}/admins/${ERIN}`,
      headers: erin,
    })
    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
    expect(repositories.removeAdmin).toHaveBeenCalledWith(caller, REPO_ID, ERIN)
  })

  it("answers the service's refusal to leave the repository without an admin as 409", async () => {
    const { app, repositories } = stubbed()
    repositories.removeAdmin.mockRejectedValue(
      new ServiceError('conflict', 'csillagu/tc-repo cannot be left without an admin'),
    )
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/repositories/${REPO_ID}/admins/${ERIN}`,
      headers: erin,
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({
      message: 'csillagu/tc-repo cannot be left without an admin',
    })
  })

  it('refuses ids that are not UUIDs before the service is asked', async () => {
    const { app, repositories } = stubbed()
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/repositories/${REPO_ID}/admins/erin`,
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(repositories.removeAdmin).not.toHaveBeenCalled()
  })
})
