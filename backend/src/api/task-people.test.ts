import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { notVisible } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import type { TaskPerson } from '../service/task-people.ts'
import type { Authenticator } from './caller.ts'

// The route of the people on a task translates requests for the service and nothing more
// (DD-039); the rules are tested against the database in test/integration/task-people.test.ts.
// Here the service is a stub, so these tests show what the route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const BOB = '6f1c2a5e-0000-4000-8000-000000000002'
const T = '6f1c2a5e-0000-4000-8000-0000000000b1'

const PEOPLE: TaskPerson[] = [
  { accountId: BOB, username: 'bob', canReadProject: false },
  { accountId: ERIN, username: 'erin', canReadProject: true },
]

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
  const peopleOnTask = vi.spyOn(services.taskPeople, 'peopleOnTask')
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, peopleOnTask }
}

const url = `/api/tasks/${T}/people`

describe('GET /api/tasks/:taskId/people', () => {
  it('hands the service the caller and the task, and sends back the people', async () => {
    const { app, peopleOnTask } = stubbed()
    peopleOnTask.mockResolvedValue(PEOPLE)
    const response = await app.inject({ method: 'GET', url, headers: erin })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(PEOPLE)
    expect(peopleOnTask).toHaveBeenCalledWith(caller, T)
  })

  it('refuses a task id that is not one before the service is reached', async () => {
    const { app, peopleOnTask } = stubbed()
    const response = await app.inject({ method: 'GET', url: '/api/tasks/t/people', headers: erin })
    expect(response.statusCode).toBe(400)
    expect(peopleOnTask).not.toHaveBeenCalled()
  })

  it("answers the service's refusal of a task the caller cannot see as not visible", async () => {
    const { app, peopleOnTask } = stubbed()
    peopleOnTask.mockRejectedValue(notVisible())
    const response = await app.inject({ method: 'GET', url, headers: erin })
    expect(response.statusCode).toBe(403)
  })

  it('refuses a caller who is not signed in', async () => {
    const { app, peopleOnTask } = stubbed()
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401)
    expect(peopleOnTask).not.toHaveBeenCalled()
  })
})
