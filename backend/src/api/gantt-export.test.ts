import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { notVisible } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The Gantt export route translates requests for the Mermaid Gantt exporter and nothing more
// (DD-039); the exporter is tested in service/gantt-export.test.ts and against the database in
// test/integration/gantt-export.test.ts. Here the service is a stub, so these tests show what the
// route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const APOLLO = '6f1c2a5e-0000-4000-8000-0000000000c1'
const CHART = { markdown: '```mermaid\ngantt\n    title Apollo\n```\n' }

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
  const exportProjectGantt = vi.spyOn(services.ganttExport, 'exportProjectGantt')
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, exportProjectGantt }
}

const url = `/api/projects/${APOLLO}/gantt/mermaid`

describe('GET /api/projects/:projectId/gantt/mermaid', () => {
  it('hands the service the caller and the project, and sends back the chart', async () => {
    const { app, exportProjectGantt } = stubbed()
    exportProjectGantt.mockResolvedValue(CHART)
    const response = await app.inject({ method: 'GET', url, headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(CHART)
    expect(exportProjectGantt).toHaveBeenCalledWith(caller, APOLLO)
  })

  it('refuses a project id that is not one before the service is reached', async () => {
    const { app, exportProjectGantt } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/projects/apollo/gantt/mermaid',
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(exportProjectGantt).not.toHaveBeenCalled()
  })

  it("answers the service's refusal of a project the caller cannot see as not visible", async () => {
    const { app, exportProjectGantt } = stubbed()
    exportProjectGantt.mockRejectedValue(notVisible())
    const response = await app.inject({ method: 'GET', url, headers: erin })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ message: 'This project is not visible to you' })
  })

  it('refuses a caller who is not signed in', async () => {
    const { app, exportProjectGantt } = stubbed()
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
    expect(exportProjectGantt).not.toHaveBeenCalled()
  })
})
