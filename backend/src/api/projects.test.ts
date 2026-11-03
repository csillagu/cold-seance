import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { notVisible, ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The project routes translate requests for the project service and nothing more (DD-039); the
// rules themselves are tested against the database in test/integration/projects.test.ts. Here the
// service is a stub, so these tests show what each route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const PROJECT = { id: '6f1c2a5e-0000-4000-8000-0000000000a1', name: "Erin's project" }

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
  const projects = {
    createProject: vi.spyOn(services.projects, 'createProject'),
    listProjects: vi.spyOn(services.projects, 'listProjects'),
    getProject: vi.spyOn(services.projects, 'getProject'),
  }
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, projects }
}

describe('POST /api/projects', () => {
  it('hands the service the caller and the name and sends the project as 201', async () => {
    const { app, projects } = stubbed()
    projects.createProject.mockResolvedValue(PROJECT)
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: erin,
      payload: { name: "Erin's project" },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual(PROJECT)
    expect(projects.createProject).toHaveBeenCalledWith(caller, { name: "Erin's project" })
  })

  it.each([
    ['no name', {}],
    ['a name that is not text', { name: { first: 'Apollo' } }],
  ])('refuses %s before the service is asked', async (_, payload) => {
    const { app, projects } = stubbed()
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: erin,
      payload,
    })
    expect(response.statusCode).toBe(400)
    expect(projects.createProject).not.toHaveBeenCalled()
  })

  it("answers 400 with the service's message when it refuses the name", async () => {
    const { app, projects } = stubbed()
    projects.createProject.mockRejectedValue(
      new ServiceError('invalid', 'A project name is required'),
    )
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: erin,
      payload: { name: ' ' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().message).toBe('A project name is required')
  })

  it('refuses a caller no authenticator recognises with 401', async () => {
    const { app, projects } = stubbed()
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Apollo' },
    })
    expect(response.statusCode).toBe(401)
    expect(projects.createProject).not.toHaveBeenCalled()
  })
})

describe('GET /api/projects', () => {
  it("sends the caller's projects", async () => {
    const { app, projects } = stubbed()
    projects.listProjects.mockResolvedValue([PROJECT])
    const response = await app.inject({ method: 'GET', url: '/api/projects', headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([PROJECT])
    expect(projects.listProjects).toHaveBeenCalledWith(caller)
  })
})

describe('GET /api/projects/:projectId', () => {
  it('hands the service the caller and the project and sends the project', async () => {
    const { app, projects } = stubbed()
    projects.getProject.mockResolvedValue(PROJECT)
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT.id}`,
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(PROJECT)
    expect(projects.getProject).toHaveBeenCalledWith(caller, PROJECT.id)
  })

  it('answers a project the caller cannot see with 403 and the plain message', async () => {
    const { app, projects } = stubbed()
    projects.getProject.mockRejectedValue(notVisible())
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${PROJECT.id}`,
      headers: erin,
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({
      statusCode: 403,
      error: 'Not Visible',
      message: 'This project is not visible to you',
    })
  })

  it('refuses a project id that is not a UUID before the service is asked', async () => {
    const { app, projects } = stubbed()
    const response = await app.inject({ method: 'GET', url: '/api/projects/apollo', headers: erin })
    expect(response.statusCode).toBe(400)
    expect(projects.getProject).not.toHaveBeenCalled()
  })
})

describe('the OpenAPI description', () => {
  it('describes the project routes beside the member routes', async () => {
    const { app } = stubbed()
    const paths = (
      await app.inject({ method: 'GET', url: '/api/openapi.json', headers: erin })
    ).json().paths
    expect(Object.keys(paths['/api/projects/']).sort()).toEqual(['get', 'post'])
    expect(paths['/api/projects/{projectId}/members']).toBeDefined()
    expect(Object.keys(paths['/api/projects/{projectId}'])).toEqual(['get'])
  })
})
