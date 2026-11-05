import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { auditLog, baselines, baselineTasks } from '../../src/db/schema.ts'
import type { Baseline, BaselineSummary } from '../../src/service/baselines.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { TaskInput } from '../../src/service/tasks.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The baseline snapshots (SC-009: FR-064, FR-065, FR-153) against a real PostgreSQL, each test in
// a fresh test deployment: a fresh database, first system admin `root`, and a global calendar with
// Saturday and Sunday as the weekend and no company holidays. First the test cases through the
// REST API, then the rules through the service layer.

type Account = Awaited<ReturnType<typeof seedAccount>>
type Method = 'GET' | 'POST' | 'PATCH'

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
  return error
}

describe('the baseline snapshots', () => {
  let x: TestDatabase
  let services: Services
  let app: ReturnType<typeof buildApp>
  let alice: Account
  let bob: Account
  let carol: Account

  beforeEach(async () => {
    x = await createTestDatabase()
    services = createServices(x.db)
    app = buildApp({}, { authenticators: [testAuthenticator], services })
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
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

  const list = (who: Account, projectId: string) =>
    ok<BaselineSummary[]>(who, 'GET', `/projects/${projectId}/baselines`)

  const read = (who: Account, baselineId: string) =>
    ok<Baseline>(who, 'GET', `/baselines/${baselineId}`)

  /** The dates a baseline holds, by task id. */
  const dates = (baseline: Baseline) =>
    Object.fromEntries(
      baseline.tasks.map((held) => [held.taskId, [held.plannedStart, held.plannedFinish]]),
    )

  describe('its test cases through the REST API', () => {
    it("TC-090: a named baseline keeps a snapshot of every task's planned dates", async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const a = await task(alice, apollo, {
        title: 'A',
        plannedStart: '2027-03-01',
        durationWorkingDays: 3,
      })
      const b = await task(alice, apollo, {
        title: 'B',
        plannedStart: '2027-03-08',
        durationWorkingDays: 2,
      })

      // Step 1: alice saves a baseline of Apollo named `v1 approved`.
      const saved = await save(alice, apollo, 'v1 approved')

      // Step 2: A is moved to start on 2027-03-15.
      await ok(alice, 'PATCH', `/tasks/${a}`, { plannedStart: '2027-03-15' })
      const moved = await ok<{ plannedStart: string }>(alice, 'GET', `/tasks/${a}`)
      expect(moved.plannedStart).toBe('2027-03-15')

      // Step 3: baseline `v1 approved` holds A on 2027-03-01 to 03-03 and B on 03-08 to 03-09.
      const baseline = await read(alice, saved.id)
      expect(baseline.name).toBe('v1 approved')
      expect(baseline.tasks).toEqual([
        { taskId: a, title: 'A', plannedStart: '2027-03-01', plannedFinish: '2027-03-03' },
        { taskId: b, title: 'B', plannedStart: '2027-03-08', plannedFinish: '2027-03-09' },
      ])
      // Negative: it does not follow the move of A made at step 2.
      expect(dates(baseline)[a]).not.toContain('2027-03-15')
    })

    it('TC-091: saving a baseline without the read-write role is rejected', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      await grantRole(x.db, bob, apollo, 'read-only')
      await grantRole(x.db, carol, apollo, 'contributor')
      await task(alice, apollo, { title: 'T', plannedStart: '2027-03-01', durationWorkingDays: 1 })

      // Step 1: bob, read-only, tries through the REST API.
      const byBob = await call(bob, 'POST', `/projects/${apollo}/baselines`, { name: "bob's" })
      // Step 2: carol, a contributor, tries.
      const byCarol = await call(carol, 'POST', `/projects/${apollo}/baselines`, {
        name: "carol's",
      })

      // Both attempts are rejected.
      expect(byBob.statusCode).toBe(403)
      expect(byCarol.statusCode).toBe(403)
      for (const response of [byBob, byCarol]) {
        expect(response.json()).toMatchObject({
          message: "Only the project's read-write members and admins can save a baseline",
        })
      }

      // Step 3, negative: Apollo has no baselines.
      expect(await list(alice, apollo)).toEqual([])
      expect(await x.db.select().from(baselines)).toEqual([])
    })

    it('TC-225: a project keeps several named baselines', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const t = await task(alice, apollo, {
        title: 'T',
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })

      // Step 1: alice saves `v1 approved`.
      const v1 = await save(alice, apollo, 'v1 approved')
      // Step 2: T moves to 2027-03-08, and alice saves `v2 after re-plan`.
      await ok(alice, 'PATCH', `/tasks/${t}`, { plannedStart: '2027-03-08' })
      const v2 = await save(alice, apollo, 'v2 after re-plan')

      // Step 3: both are listed under their names.
      const listed = await list(alice, apollo)
      expect(listed.map((baseline) => baseline.name)).toEqual(['v1 approved', 'v2 after re-plan'])
      expect(listed.map((baseline) => baseline.id)).toEqual([v1.id, v2.id])

      // Each holds T on its own date, and v2 did not replace or change v1.
      expect(dates(await read(alice, v1.id))).toEqual({ [t]: ['2027-03-01', '2027-03-01'] })
      expect(dates(await read(alice, v2.id))).toEqual({ [t]: ['2027-03-08', '2027-03-08'] })
    })
  })

  describe('through the service layer', () => {
    let apollo: string

    beforeEach(async () => {
      apollo = await seedProject(x.db, alice, 'Apollo')
    })

    const create = (fields: TaskInput, projectId = apollo) =>
      services.tasks.createTask(by(alice), projectId, fields)

    describe('saveBaseline', () => {
      it('lets a read-write member save one, as well as an admin', async () => {
        await grantRole(x.db, bob, apollo, 'read-write')
        const saved = await services.baselines.saveBaseline(by(bob), apollo, { name: 'by bob' })
        expect(saved).toEqual({
          id: expect.any(String),
          projectId: apollo,
          name: 'by bob',
          savedAt: expect.any(Date),
          tasks: [],
        })
      })

      it('refuses the read-only and contributor roles as forbidden, and saves nothing', async () => {
        await grantRole(x.db, bob, apollo, 'read-only')
        await grantRole(x.db, carol, apollo, 'contributor')
        await refused(services.baselines.saveBaseline(by(bob), apollo, { name: 'b' }), 'forbidden')
        await refused(
          services.baselines.saveBaseline(by(carol), apollo, { name: 'c' }),
          'forbidden',
        )
        expect(await x.db.select().from(baselines)).toEqual([])
        expect(
          await x.db.select().from(auditLog).where(eq(auditLog.action, 'baseline.saved')),
        ).toEqual([])
      })

      it('refuses someone with no role in the project as not visible, before the name', async () => {
        const error = await refused(
          services.baselines.saveBaseline(by(bob), apollo, { name: '' }),
          'not-visible',
        )
        expect(error.message).toBe('This project is not visible to you')
      })

      it('refuses a project that does not exist, or an id that is not one, as not visible', async () => {
        await refused(
          services.baselines.saveBaseline(by(alice), '6f1c2a5e-0000-4000-8000-000000000000', {
            name: 'v1',
          }),
          'not-visible',
        )
        await refused(
          services.baselines.saveBaseline(by(alice), 'apollo', { name: 'v1' }),
          'not-visible',
        )
        expect(await x.db.select().from(baselines)).toEqual([])
      })

      it('refuses an empty name and one longer than 200 characters as invalid', async () => {
        await refused(services.baselines.saveBaseline(by(alice), apollo, { name: '  ' }), 'invalid')
        await refused(
          services.baselines.saveBaseline(by(alice), apollo, { name: 'x'.repeat(201) }),
          'invalid',
        )
        const longest = await services.baselines.saveBaseline(by(alice), apollo, {
          name: 'x'.repeat(200),
        })
        expect(longest.name).toHaveLength(200)
        expect(await x.db.select().from(baselines)).toHaveLength(1)
      })

      it('keeps the name trimmed and in one Unicode form', async () => {
        const saved = await services.baselines.saveBaseline(by(alice), apollo, {
          name: '  Café plan ',
        })
        expect(saved.name).toBe('Café plan')
      })

      it("refuses a name another of the project's baselines has, typed either way", async () => {
        const first = await services.baselines.saveBaseline(by(alice), apollo, {
          name: 'Café',
        })
        const error = await refused(
          services.baselines.saveBaseline(by(alice), apollo, { name: ' Café' }),
          'conflict',
        )
        expect(error.message).toBe('This project already has a baseline named Café')
        expect(await services.baselines.listBaselines(by(alice), apollo)).toEqual([
          { id: first.id, projectId: apollo, name: 'Café', savedAt: first.savedAt },
        ])
      })

      it('lets two projects each have a baseline of the same name', async () => {
        const borealis = await seedProject(x.db, alice, 'Borealis')
        await services.baselines.saveBaseline(by(alice), apollo, { name: 'v1' })
        const other = await services.baselines.saveBaseline(by(alice), borealis, { name: 'v1' })
        expect(other.projectId).toBe(borealis)
      })

      it('lets only one of two concurrent saves of one name succeed', async () => {
        const outcomes = await Promise.allSettled([
          services.baselines.saveBaseline(by(alice), apollo, { name: 'v1' }),
          services.baselines.saveBaseline(by(alice), apollo, { name: 'v1' }),
        ])
        expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
        const [failed] = outcomes.filter((outcome) => outcome.status === 'rejected')
        const reason: unknown = failed?.reason
        expect(reason).toBeInstanceOf(ServiceError)
        expect(reason instanceof ServiceError && reason.kind).toBe('conflict')
      })

      it('holds every task of the project, scheduled or not, milestones by their day', async () => {
        const a = await create({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 3 })
        const loose = await create({ title: 'Loose' })
        const fixed = await create({
          title: 'Launch',
          milestone: { variant: 'fixed-date', date: '2027-03-12' },
        })
        const floating = await create({ title: 'Ready', milestone: { variant: 'floating' } })
        const unplaced = await create({ title: 'Unplaced', milestone: { variant: 'floating' } })
        await services.taskRelations.addBlocker(by(alice), floating.id, a.id)
        const cancelled = await create({
          title: 'Dropped',
          plannedStart: '2027-03-02',
          durationWorkingDays: 1,
        })
        await services.taskCancellation.cancel(by(alice), cancelled.id)
        // Another project's task is not in Apollo's baseline.
        const borealis = await seedProject(x.db, alice, 'Borealis')
        await create({ title: 'Elsewhere', plannedStart: '2027-03-01' }, borealis)

        const saved = await services.baselines.saveBaseline(by(alice), apollo, { name: 'v1' })

        const expected = [
          { taskId: a.id, title: 'A', plannedStart: '2027-03-01', plannedFinish: '2027-03-03' },
          { taskId: loose.id, title: 'Loose', plannedStart: null, plannedFinish: null },
          {
            taskId: fixed.id,
            title: 'Launch',
            plannedStart: '2027-03-12',
            plannedFinish: '2027-03-12',
          },
          {
            taskId: floating.id,
            title: 'Ready',
            plannedStart: '2027-03-03',
            plannedFinish: '2027-03-03',
          },
          { taskId: unplaced.id, title: 'Unplaced', plannedStart: null, plannedFinish: null },
          {
            taskId: cancelled.id,
            title: 'Dropped',
            plannedStart: '2027-03-02',
            plannedFinish: '2027-03-02',
          },
        ]
        expect(saved.tasks).toEqual(expected)
        expect((await services.baselines.getBaseline(by(alice), saved.id)).tasks).toEqual(expected)
        expect(await x.db.select().from(baselineTasks)).toHaveLength(6)
      })

      it('records the saving in the audit log, in the project, by whoever saved it', async () => {
        await create({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 3 })
        const saved = await services.baselines.saveBaseline(
          { accountId: alice.id, channel: 'rest-api' },
          apollo,
          { name: 'v1' },
        )
        const entries = await x.db
          .select()
          .from(auditLog)
          .where(eq(auditLog.action, 'baseline.saved'))
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({
          actorAccountId: alice.id,
          channels: ['rest-api'],
          projectId: apollo,
          subjectType: 'baseline',
          subjectId: saved.id,
          details: { name: 'v1', tasks: 1 },
        })
      })
    })

    describe('listBaselines and getBaseline', () => {
      it('serve every role in the project, the read-only one included', async () => {
        await grantRole(x.db, bob, apollo, 'read-only')
        const a = await create({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 2 })
        const saved = await services.baselines.saveBaseline(by(alice), apollo, { name: 'v1' })
        expect(await services.baselines.listBaselines(by(bob), apollo)).toEqual([
          { id: saved.id, projectId: apollo, name: 'v1', savedAt: saved.savedAt },
        ])
        expect(await services.baselines.getBaseline(by(bob), saved.id)).toEqual({
          id: saved.id,
          projectId: apollo,
          name: 'v1',
          savedAt: saved.savedAt,
          tasks: [
            { taskId: a.id, title: 'A', plannedStart: '2027-03-01', plannedFinish: '2027-03-02' },
          ],
        })
      })

      it('refuse someone with no role in the project as not visible', async () => {
        const saved = await services.baselines.saveBaseline(by(alice), apollo, { name: 'v1' })
        await refused(services.baselines.listBaselines(by(bob), apollo), 'not-visible')
        const error = await refused(
          services.baselines.getBaseline(by(bob), saved.id),
          'not-visible',
        )
        expect(error.message).toBe('This project is not visible to you')
      })

      it('list only the project’s own baselines', async () => {
        const borealis = await seedProject(x.db, alice, 'Borealis')
        await services.baselines.saveBaseline(by(alice), borealis, { name: 'other' })
        expect(await services.baselines.listBaselines(by(alice), apollo)).toEqual([])
      })

      it('refuse a baseline that does not exist, or an id that is not one, as not found', async () => {
        await refused(
          services.baselines.getBaseline(by(alice), '6f1c2a5e-0000-4000-8000-000000000000'),
          'not-found',
        )
        const error = await refused(services.baselines.getBaseline(by(alice), 'v1'), 'not-found')
        expect(error.message).toBe('There is no such baseline')
      })

      it("show a task's title as it is now, and its dates as they were saved", async () => {
        const a = await create({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 1 })
        const saved = await services.baselines.saveBaseline(by(alice), apollo, { name: 'v1' })
        await services.tasks.updateTask(by(alice), a.id, {
          title: 'A renamed',
          plannedStart: '2027-04-01',
        })
        expect((await services.baselines.getBaseline(by(alice), saved.id)).tasks).toEqual([
          {
            taskId: a.id,
            title: 'A renamed',
            plannedStart: '2027-03-01',
            plannedFinish: '2027-03-01',
          },
        ])
      })

      it('leave out of a baseline a task created after it was saved', async () => {
        const saved = await services.baselines.saveBaseline(by(alice), apollo, { name: 'v1' })
        await create({ title: 'Later', plannedStart: '2027-03-01' })
        expect((await services.baselines.getBaseline(by(alice), saved.id)).tasks).toEqual([])
      })
    })
  })

  describe('the REST API', () => {
    it('answers a save with 201, a duplicate name with 409 and a bad name with 400', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const first = await call(alice, 'POST', `/projects/${apollo}/baselines`, { name: 'v1' })
      expect(first.statusCode).toBe(201)
      const again = await call(alice, 'POST', `/projects/${apollo}/baselines`, { name: 'v1' })
      expect(again.statusCode).toBe(409)
      const empty = await call(alice, 'POST', `/projects/${apollo}/baselines`, { name: '' })
      expect(empty.statusCode).toBe(400)
    })

    it('answers a baseline of a project the caller cannot see as not visible', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const saved = await save(alice, apollo, 'v1')
      const response = await call(bob, 'GET', `/baselines/${saved.id}`)
      expect(response.statusCode).toBe(403)
      expect(response.json()).toMatchObject({ message: 'This project is not visible to you' })
    })
  })
})
