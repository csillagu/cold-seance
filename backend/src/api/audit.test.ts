import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { MAX_PAGE_SIZE, type AuditEntry } from '../service/audit.ts'
import { ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The audit log route translates requests for the audit log service and nothing more (DD-039);
// the rules themselves are tested against the database in test/integration/audit-log.test.ts.
// Here the service is a stub, so these tests show what the route hands it and what it sends back.

const ROOT = '6f1c2a5e-0000-4000-8000-000000000001'
const APOLLO = '6f1c2a5e-0000-4000-8000-0000000000a1'

const ENTRY: AuditEntry = {
  id: 7,
  at: new Date('2027-03-01T09:30:00.000Z'),
  by: { accountId: ROOT, username: 'root' },
  channels: ['mcp', 'ui'],
  projectId: APOLLO,
  action: 'task.updated',
  subject: { type: 'task', id: 'T' },
  details: { title: { from: 'Draft', to: 'Final' } },
}

const asRoot: Authenticator = async (request) =>
  request.headers.authorization === 'Bearer root'
    ? { accountId: ROOT, channel: 'rest-api' }
    : undefined

let closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(closers.map((close) => close()))
  closers = []
})

/** The REST API over the real service layer, its audit log's `readLog` spied on. */
function stubbed() {
  const { db, close } = createDatabase('postgres://nobody@unused.invalid/none')
  const services = createServices(db)
  const readLog = vi.spyOn(services.audit, 'readLog')
  const app = buildApp({}, { authenticators: [asRoot], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, readLog }
}

const root = { authorization: 'Bearer root' }

describe('GET /api/audit-log', () => {
  it('reads the whole log for the caller and sends each entry with its time as ISO 8601', async () => {
    const { app, readLog } = stubbed()
    readLog.mockResolvedValue([ENTRY])
    const response = await app.inject({ method: 'GET', url: '/api/audit-log', headers: root })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([{ ...ENTRY, at: '2027-03-01T09:30:00.000Z' }])
    expect(readLog).toHaveBeenCalledWith({ accountId: ROOT, channel: 'rest-api' }, {})
  })

  it('hands the service the project, the page size and the entry to read before, as numbers', async () => {
    const { app, readLog } = stubbed()
    readLog.mockResolvedValue([])
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit-log',
      query: { projectId: APOLLO, limit: '20', before: '41' },
      headers: root,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
    expect(readLog).toHaveBeenCalledWith(
      { accountId: ROOT, channel: 'rest-api' },
      { projectId: APOLLO, limit: 20, before: 41 },
    )
  })

  it('sends an entry outside any project with a null project', async () => {
    const { app, readLog } = stubbed()
    readLog.mockResolvedValue([{ ...ENTRY, projectId: null, details: {} }])
    const response = await app.inject({ method: 'GET', url: '/api/audit-log', headers: root })
    expect(response.json()).toEqual([
      { ...ENTRY, at: ENTRY.at.toISOString(), projectId: null, details: {} },
    ])
  })

  it('sends nothing the entry schema does not declare, outside the details', async () => {
    const { app, readLog } = stubbed()
    readLog.mockResolvedValue([
      {
        ...ENTRY,
        by: { ...ENTRY.by, passwordHash: '$argon2id$secret' },
        internal: 'not for the caller',
      } as AuditEntry,
    ])
    const response = await app.inject({ method: 'GET', url: '/api/audit-log', headers: root })
    expect(response.body).not.toContain('argon2id')
    expect(response.body).not.toContain('not for the caller')
  })

  it.each([
    ['a project id that is not a UUID', { projectId: 'Apollo' }],
    ['a limit of 0', { limit: '0' }],
    [`a limit above ${MAX_PAGE_SIZE}`, { limit: String(MAX_PAGE_SIZE + 1) }],
    ['a limit that is not a whole number', { limit: '2.5' }],
    ['an entry to read before of 0', { before: '0' }],
    [
      'an entry to read before beyond the largest safe whole number',
      { before: '100000000000000000000' },
    ],
    ['an entry to read before that is not a number', { before: 'last' }],
  ])('refuses %s, before the service is called', async (_, query) => {
    const { app, readLog } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit-log',
      query,
      headers: root,
    })
    expect(response.statusCode).toBe(400)
    expect(readLog).not.toHaveBeenCalled()
  })

  it('drops a query parameter it does not know instead of handing it to the service', async () => {
    const { app, readLog } = stubbed()
    readLog.mockResolvedValue([])
    const response = await app.inject({
      method: 'GET',
      url: '/api/audit-log',
      query: { limit: '5', accountId: ROOT },
      headers: root,
    })
    expect(response.statusCode).toBe(200)
    expect(readLog).toHaveBeenCalledWith({ accountId: ROOT, channel: 'rest-api' }, { limit: 5 })
  })

  it("answers the service's refusal as the REST API's error", async () => {
    const { app, readLog } = stubbed()
    readLog.mockRejectedValue(
      new ServiceError('forbidden', 'Only system admins can read the whole audit log'),
    )
    const response = await app.inject({ method: 'GET', url: '/api/audit-log', headers: root })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Only system admins can read the whole audit log',
    })
  })

  it('refuses a caller nobody authenticated, before the service is called', async () => {
    const { app, readLog } = stubbed()
    const response = await app.inject({ method: 'GET', url: '/api/audit-log' })
    expect(response.statusCode).toBe(401)
    expect(readLog).not.toHaveBeenCalled()
  })

  it('is in the OpenAPI description, with its query parameters', async () => {
    const { app } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/openapi.json',
      headers: root,
    })
    const operation = response.json<{
      paths: Record<string, { get?: { parameters?: { name: string }[] } }>
    }>().paths['/api/audit-log/']?.get
    expect(operation?.parameters?.map((p) => p.name).sort()).toEqual([
      'before',
      'limit',
      'projectId',
    ])
  })
})
