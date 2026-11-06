import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import type { Baseline } from '../../src/service/baselines.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { TaskInput } from '../../src/service/tasks.ts'
import type { BaselineVariance, TaskVariance } from '../../src/service/variance.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The variance calculator (SC-044: FR-066) against a real PostgreSQL, each test in a fresh test
// deployment: a fresh database, first system admin `root`, and a global calendar with Saturday
// and Sunday as the weekend and no company holidays. First the test cases through the REST API,
// then the rules through the service layer.

type Account = Awaited<ReturnType<typeof seedAccount>>
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT'

const by = (account: Account): Caller => ({ accountId: account.id, channel: 'ui' })

async function refused(promise: Promise<unknown>, kind: ServiceError['kind']) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  if (!(error instanceof ServiceError)) {
    throw new Error(`expected a ServiceError, got ${String(error)}`)
  }
  expect(error.kind).toBe(kind)
}

describe('the variance calculator', () => {
  let x: TestDatabase
  let services: Services
  let app: ReturnType<typeof buildApp>
  let today: string
  let root: Account
  let alice: Account
  let bob: Account
  let carol: Account

  beforeEach(async () => {
    x = await createTestDatabase()
    today = '2027-03-01'
    services = createServices(x.db, { today: () => today })
    app = buildApp({}, { authenticators: [testAuthenticator], services })
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
    carol = await seedAccount(x.db, { username: 'carol' })
  })

  afterEach(async () => {
    await app?.close()
    await x?.drop()
  })

  const call = (who: Account, method: Method, url: string, payload?: object) =>
    app.inject({
      method,
      url: `/api${url}`,
      headers: as(who, 'rest-api'),
      ...(payload === undefined ? {} : { payload }),
    })

  const ok = async <T>(who: Account, method: Method, url: string, payload?: object) => {
    const response = await call(who, method, url, payload)
    if (response.statusCode >= 300) throw new Error(`${method} ${url}: ${response.body}`)
    return response.json<T>()
  }

  const task = async (who: Account, projectId: string, fields: TaskInput) =>
    (await ok<{ id: string }>(who, 'POST', `/projects/${projectId}/tasks`, fields)).id

  const save = (who: Account, projectId: string, name: string) =>
    ok<Baseline>(who, 'POST', `/projects/${projectId}/baselines`, { name })

  const variance = (who: Account, baselineId: string) =>
    ok<BaselineVariance>(who, 'GET', `/baselines/${baselineId}/variance`)

  /** The variance's row of one task. */
  const row = (computed: BaselineVariance, taskId: string): TaskVariance => {
    const found = computed.tasks.find((held) => held.taskId === taskId)
    if (!found) throw new Error(`no row for ${taskId}`)
    return found
  }

  describe('its test cases through the REST API', () => {
    it('TC-092: variance follows the current plan where a task has no actual dates', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const t = await task(alice, apollo, {
        title: 'T',
        plannedStart: '2027-03-01',
        durationWorkingDays: 3,
      })
      const m = await task(alice, apollo, {
        title: 'M',
        milestone: { variant: 'fixed-date', date: '2027-03-10' },
      })
      const v1 = await save(alice, apollo, 'v1')
      await ok(alice, 'PATCH', `/tasks/${t}`, { plannedStart: '2027-03-02' })
      await ok(alice, 'PATCH', `/tasks/${m}`, {
        milestone: { variant: 'fixed-date', date: '2027-03-12' },
      })

      // Step 1: alice opens the variance of Apollo against v1.
      const computed = await variance(alice, v1.id)

      // T is +1 day on start and +1 day on finish.
      expect(row(computed, t)).toEqual({
        taskId: t,
        title: 'T',
        milestone: false,
        baseline: { start: '2027-03-01', finish: '2027-03-03' },
        planned: { start: '2027-03-02', finish: '2027-03-04' },
        actual: { start: null, finish: null },
        variance: { start: 1, finish: 1 },
      })
      // M is +2 days.
      expect(row(computed, m)).toMatchObject({
        milestone: true,
        baseline: { start: '2027-03-10', finish: '2027-03-10' },
        planned: { start: '2027-03-12', finish: '2027-03-12' },
        variance: { start: 2, finish: 2 },
      })
      // Negative: baseline v1 itself is unchanged.
      const held = await ok<Baseline>(alice, 'GET', `/baselines/${v1.id}`)
      expect(held.tasks).toEqual(v1.tasks)
    })

    it("TC-093: variance uses a task's actual start where it has one", async () => {
      // D is 2027-03-01, a Monday that is no company holiday; D+1 is 2027-03-02.
      today = '2027-03-01'
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const t = await task(alice, apollo, {
        title: 'T',
        plannedStart: '2027-03-02',
        durationWorkingDays: 1,
      })
      const v1 = await save(alice, apollo, 'v1')

      // Step 1: alice sets T to in progress on D, so its actual start is D.
      await ok(alice, 'PUT', `/tasks/${t}/status`, { status: 'in-progress' })
      // Step 2: she opens the variance of Apollo against v1.
      const computed = await variance(alice, v1.id)

      // T's start variance is -1 day: actual start D minus baseline start D+1.
      expect(row(computed, t).actual.start).toBe('2027-03-01')
      expect(row(computed, t).variance.start).toBe(-1)
      // Negative: it is not computed from the planned start, which would give 0.
      expect(row(computed, t).planned.start).toBe('2027-03-02')
      expect(row(computed, t).variance.start).not.toBe(0)
    })
  })

  describe('its rules through the service layer', () => {
    it('lists every task the project has now, a task created after the baseline included', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const guide = await task(alice, apollo, {
        title: 'Write guide',
        plannedStart: '2027-03-01',
        durationWorkingDays: 2,
      })
      const v1 = await save(alice, apollo, 'v1')
      const triage = await task(alice, apollo, { title: 'Triage backlog' })

      const computed = await services.variance.varianceAgainst(by(alice), v1.id)

      expect(computed.baseline).toMatchObject({ id: v1.id, projectId: apollo, name: 'v1' })
      expect(computed.tasks.map((held) => held.taskId)).toEqual([guide, triage])
      expect(row(computed, guide).variance).toEqual({ start: 0, finish: 0 })
      // The later task has no baseline dates, so no variance, and is given no dates.
      expect(row(computed, triage)).toEqual({
        taskId: triage,
        title: 'Triage backlog',
        milestone: false,
        baseline: null,
        planned: { start: null, finish: null },
        actual: { start: null, finish: null },
        variance: { start: null, finish: null },
      })
    })

    it('gives no variance to a date the baseline holds as none', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const loose = await task(alice, apollo, { title: 'Loose' })
      const v1 = await save(alice, apollo, 'v1')
      await ok(alice, 'PATCH', `/tasks/${loose}`, {
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })

      const computed = await services.variance.varianceAgainst(by(alice), v1.id)

      expect(row(computed, loose)).toMatchObject({
        baseline: { start: null, finish: null },
        planned: { start: '2027-03-01', finish: '2027-03-01' },
        variance: { start: null, finish: null },
      })
    })

    it('uses the actual finish once a task is done, and the plan for a date it has not reached', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const t = await task(alice, apollo, {
        title: 'T',
        plannedStart: '2027-03-01',
        durationWorkingDays: 2,
      })
      const v1 = await save(alice, apollo, 'v1')

      today = '2027-03-03'
      await services.taskStatus.setStatus(by(alice), t, 'in-progress')
      const started = await services.variance.varianceAgainst(by(alice), v1.id)
      // Started two days late; the finish still follows the plan, which has not moved.
      expect(row(started, t).variance).toEqual({ start: 2, finish: 0 })

      today = '2027-03-05'
      await services.taskStatus.setStatus(by(alice), t, 'done')
      const finished = await services.variance.varianceAgainst(by(alice), v1.id)
      expect(row(finished, t).actual).toEqual({ start: '2027-03-03', finish: '2027-03-05' })
      expect(row(finished, t).variance).toEqual({ start: 2, finish: 3 })
    })

    it('counts working days of the global calendar, leaving out its weekend and company holidays', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const t = await task(alice, apollo, {
        title: 'T',
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      const v1 = await save(alice, apollo, 'v1')
      // From Monday 2027-03-01 to the next Monday: five working days, not seven calendar days.
      await ok(alice, 'PATCH', `/tasks/${t}`, { plannedStart: '2027-03-08' })
      expect(row(await variance(alice, v1.id), t).variance).toEqual({ start: 5, finish: 5 })

      // A company holiday between the two, added later, is left out too: the calendar as it is now.
      await services.calendars.changeGlobalCalendar(by(root), { addHolidays: ['2027-03-03'] })
      expect(row(await variance(alice, v1.id), t).variance).toEqual({ start: 4, finish: 4 })
    })

    it('computes against the selected baseline, not another of the project', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const t = await task(alice, apollo, {
        title: 'T',
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      const v1 = await save(alice, apollo, 'v1')
      await ok(alice, 'PATCH', `/tasks/${t}`, { plannedStart: '2027-03-03' })
      const v2 = await save(alice, apollo, 'v2')

      expect(row(await variance(alice, v1.id), t).variance.start).toBe(2)
      expect(row(await variance(alice, v2.id), t).variance.start).toBe(0)
    })

    it('is read by anyone with a role in the project, a contributor included', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      await grantRole(x.db, bob, apollo, 'read-only')
      await grantRole(x.db, carol, apollo, 'contributor')
      await task(alice, apollo, { title: 'T', plannedStart: '2027-03-01', durationWorkingDays: 1 })
      const v1 = await save(alice, apollo, 'v1')

      for (const who of [bob, carol]) {
        const computed = await services.variance.varianceAgainst(by(who), v1.id)
        expect(computed.tasks).toHaveLength(1)
      }
    })

    it('is refused as not visible to someone with no role in the project', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const v1 = await save(alice, apollo, 'v1')
      await refused(services.variance.varianceAgainst(by(bob), v1.id), 'not-visible')
      expect((await call(bob, 'GET', `/baselines/${v1.id}/variance`)).statusCode).toBe(403)
    })

    it('is refused as not found for a baseline that does not exist', async () => {
      for (const id of ['6f1c2a5e-0000-4000-8000-0000000000d1', 'v1']) {
        await expect(services.variance.varianceAgainst(by(alice), id)).rejects.toMatchObject({
          kind: 'not-found',
        })
      }
    })
  })
})
