import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import type { Caller } from '../../src/service/caller.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { TaskInput } from '../../src/service/tasks.ts'
import type { UnassignedTaskRating } from '../../src/service/unassigned-ratings.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The unassigned task load rating (SC-041) against a real PostgreSQL: its rules through the
// service layer, then the test cases of FR-045 through the REST API.

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const by = (account: Seeded): Caller => ({ accountId: account.id, channel: 'ui' })

// Monday 2027-03-01 to Friday 2027-03-05.
const WEEK = { plannedStart: '2027-03-01', durationWorkingDays: 5 } as const

describe('the unassigned task load rating', () => {
  let x: TestDatabase
  let services: Services
  let alice: Seeded
  let bob: Seeded
  let carol: Seeded
  let dave: Seeded
  let apollo: string
  let borealis: string

  beforeAll(async () => {
    x = await createTestDatabase()
    services = createServices(x.db, { today: () => '2027-01-01' })
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
    carol = await seedAccount(x.db, { username: 'carol' })
    dave = await seedAccount(x.db, { username: 'dave' })
    apollo = await seedProject(x.db, alice, 'Apollo')
    borealis = await seedProject(x.db, carol, 'Borealis')
    await grantRole(x.db, bob, apollo, 'read-only')
    await grantRole(x.db, carol, apollo, 'read-only')
    await grantRole(x.db, bob, borealis, 'read-only')
  })

  afterAll(async () => {
    await x?.drop()
  })

  afterEach(async () => {
    await x.db.execute('delete from task_assignees')
    await x.db.execute('delete from audit_log')
    await x.db.execute('delete from red_flags')
    await x.db.execute('delete from tasks')
    await x.db.execute('delete from absences')
    await x.db.execute('delete from personal_holidays')
    await x.db.execute(`update accounts set capacity = 100`)
  })

  const create = (projectId: string, owner: Seeded, task: TaskInput) =>
    services.tasks.createTask(by(owner), projectId, { title: 'T', ...task })
  const unassigned = (eligibility: unknown, task: TaskInput = {}) =>
    create(apollo, alice, { title: 'U', eligibility, ...WEEK, ...task })
  const ratings = async (viewer: Seeded = alice) =>
    Object.fromEntries(
      (await services.unassignedRatings.ratingsOf(by(viewer), apollo)).map((r) => [
        r.title,
        r.rating,
      ]),
    )

  describe('the rating (FR-045)', () => {
    it('counts load from other projects, and the task load after its AI share', async () => {
      await create(borealis, carol, { assignees: [bob.id], aiShare: 50, ...WEEK })
      await unassigned(bob.id, { title: 'Half', aiShare: 50 })
      await unassigned(bob.id, { title: 'Full', aiShare: 0 })
      expect(await ratings()).toEqual({ Half: 'green', Full: 'red' })
    })

    it('reads an AND as needing everyone in it', async () => {
      await create(apollo, alice, { assignees: [alice.id], ...WEEK })
      await unassigned({ all: [alice.id, bob.id] })
      await unassigned({ all: [bob.id, { any: [alice.id, carol.id] }] }, { title: 'V' })
      expect(await ratings()).toEqual({ U: 'red', V: 'amber' })
    })

    it("counts a person's absence and capacity, but no load on their days off", async () => {
      await services.calendars.recordAbsence(by(bob), bob.id, {
        from: '2027-03-03',
        to: '2027-03-03',
      })
      await services.calendars.setCapacity(by(carol), carol.id, 50)
      await unassigned({ any: [bob.id, carol.id] })
      expect(await ratings()).toEqual({ U: 'red' })

      await services.calendars.changePersonalCalendar(by(bob), bob.id, {
        addHolidays: ['2027-03-03'],
      })
      expect(await ratings()).toEqual({ U: 'amber' })
    })

    it('rates no assigned, cancelled, unscheduled or ineligible task', async () => {
      await unassigned(bob.id, { title: 'Assigned', assignees: [carol.id] })
      const cancelled = await unassigned(bob.id, { title: 'Cancelled' })
      await services.taskCancellation.cancel(by(alice), cancelled.id)
      await create(apollo, alice, { title: 'Unscheduled', eligibility: bob.id })
      await create(apollo, alice, { title: 'Nobody', ...WEEK })
      await unassigned(bob.id, { title: 'Rated' })
      expect(await ratings()).toEqual({ Rated: 'green' })
    })

    it('gives each task its dates and eligibility, in the order created', async () => {
      const first = await unassigned(bob.id, { title: 'First' })
      const second = await unassigned({ any: [bob.id, carol.id] }, { title: 'Second' })
      expect(await services.unassignedRatings.ratingsOf(by(bob), apollo)).toEqual([
        {
          taskId: first.id,
          title: 'First',
          plannedStart: '2027-03-01',
          plannedFinish: '2027-03-05',
          eligibility: bob.id,
          rating: 'green',
        },
        {
          taskId: second.id,
          title: 'Second',
          plannedStart: '2027-03-01',
          plannedFinish: '2027-03-05',
          eligibility: { any: [bob.id, carol.id] },
          rating: 'green',
        },
      ])
    })

    it('assigns nobody', async () => {
      const task = await unassigned({ any: [alice.id, bob.id] })
      await ratings()
      expect((await services.tasks.getTask(by(alice), task.id)).assignees).toEqual([])
    })
  })

  describe('refusals', () => {
    it('refuses someone with no role in the project as not visible (FR-017)', async () => {
      await expect(services.unassignedRatings.ratingsOf(by(dave), apollo)).rejects.toMatchObject({
        kind: 'not-visible',
      })
    })

    it('refuses a project id that is not one', async () => {
      await expect(services.unassignedRatings.ratingsOf(by(alice), 'apollo')).rejects.toMatchObject(
        {
          kind: 'not-found',
        },
      )
    })
  })
})

describe('test cases through the REST API', () => {
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let alice: Seeded
  let bob: Seeded
  let apollo: string

  beforeEach(async () => {
    // A fresh test deployment for each test case: empty database and the first system admin root,
    // with the default global calendar of Saturday and Sunday as the weekend and no holidays.
    x = await createTestDatabase()
    app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
    apollo = await seedProject(x.db, alice, 'Apollo')
    await grantRole(x.db, bob, apollo, 'read-only')
    return async () => {
      await app.close()
      await x.drop()
    }
  })

  const api = async (account: Seeded, method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: as(account, 'rest-api'), ...(payload && { payload }) })
  const createTask = async (task: object) => {
    const created = await api(alice, 'POST', `/api/projects/${apollo}/tasks`, {
      aiShare: 0,
      ...WEEK,
      ...task,
    })
    expect(created.statusCode).toBe(201)
    return created.json<{ id: string }>().id
  }
  const createU = () => createTask({ title: 'U', eligibility: { any: [alice.id, bob.id] } })
  const ratingOfU = async () => {
    const response = await api(alice, 'GET', `/api/projects/${apollo}/unassigned-task-ratings`)
    expect(response.statusCode).toBe(200)
    const [u, ...others] = response.json<UnassignedTaskRating[]>()
    expect(others).toEqual([])
    expect(u?.title).toBe('U')
    return u?.rating
  }
  const assigneesOf = async (taskId: string) =>
    (await api(alice, 'GET', `/api/tasks/${taskId}`)).json<{ assignees: string[] }>().assignees

  // Pending, for TC-060, TC-061 and TC-062: showing U in its colour in the person load view in the
  // browser, as alice opens it for 2027-03-01 to 2027-03-05 (SC-069, node F20).

  describe('TC-060: an unassigned task is red when every eligible combination overloads someone', () => {
    it('rates U red, not amber or green, and leaves it unassigned', async () => {
      await createTask({ title: 'X', assignees: [alice.id] })
      await createTask({ title: 'Y', assignees: [bob.id] })
      const u = await createU()

      expect(await ratingOfU()).toBe('red')
      expect(await assigneesOf(u)).toEqual([])
    })
  })

  describe('TC-061: an unassigned task is amber when only some eligible combinations overload someone', () => {
    it('rates U amber, not red', async () => {
      await createTask({ title: 'X', assignees: [alice.id] })
      await createU()

      expect(await ratingOfU()).toBe('amber')
    })
  })

  describe('TC-062: an unassigned task is green when an eligible combination fits', () => {
    it('rates U green, not red or amber', async () => {
      await createU()

      expect(await ratingOfU()).toBe('green')
    })
  })
})
