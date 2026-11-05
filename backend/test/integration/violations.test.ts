import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { TaskInput } from '../../src/service/tasks.ts'
import { type Violation, violationsIn } from '../../src/service/violations.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The milestone and dependency violation detector (SC-007: FR-013, FR-019, FR-147) against a real
// PostgreSQL, each test in a fresh test deployment: a fresh database, first system admin `root`,
// and a global calendar with Saturday and Sunday as the weekend and no company holidays. First
// the test cases through the REST API, then the rules through the service layer.

type Account = Awaited<ReturnType<typeof seedAccount>>
type Method = 'GET' | 'POST' | 'PATCH'

interface TaskBody {
  id: string
  plannedStart: string | null
  plannedFinish: string | null
  milestone: { variant: string; date: string | null } | null
}

const by = (account: Account): Caller => ({ accountId: account.id, channel: 'ui' })

describe('the milestone and dependency violation detector', () => {
  let x: TestDatabase
  let services: Services
  let app: ReturnType<typeof buildApp>
  let alice: Account
  let bob: Account

  beforeEach(async () => {
    x = await createTestDatabase()
    services = createServices(x.db)
    app = buildApp({}, { authenticators: [testAuthenticator], services })
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterEach(async () => {
    await app?.close()
    await x?.drop()
  })

  const ok = async <T = TaskBody>(who: Account, method: Method, url: string, payload?: object) => {
    const response = await app.inject({
      method,
      url: `/api${url}`,
      headers: as(who, 'rest-api'),
      ...(payload === undefined ? {} : { payload }),
    })
    if (response.statusCode >= 300) throw new Error(`${method} ${url}: ${response.body}`)
    return response.json<T>()
  }

  const task = async (who: Account, projectId: string, fields: TaskInput) =>
    (await ok(who, 'POST', `/projects/${projectId}/tasks`, fields)).id

  const block = (who: Account, taskId: string, blockerId: string) =>
    ok(who, 'POST', `/tasks/${taskId}/blocked-by`, { blockerId })

  const read = (who: Account, taskId: string) => ok(who, 'GET', `/tasks/${taskId}`)

  /** What the Gantt of the project shows in red, as `who` sees it. */
  const red = (who: Account, projectId: string) =>
    ok<Violation[]>(who, 'GET', `/projects/${projectId}/violations`)

  const fixed = (date: string) => ({ variant: 'fixed-date', date }) as const

  describe('its test cases through the REST API', () => {
    it('TC-021: a milestone pushed past its fixed date shows a red violation', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const a = await task(alice, apollo, {
        title: 'A',
        plannedStart: '2027-03-01',
        durationWorkingDays: 5,
      })
      const m = await task(alice, apollo, { title: 'M', milestone: fixed('2027-03-12') })
      await block(alice, m, a)
      expect((await read(alice, a)).plannedFinish).toBe('2027-03-05')

      // Step 1: M shows no red violation.
      expect(await red(alice, apollo)).toEqual([])

      // Step 2: A now runs 15 working days, finishing 2027-03-19.
      await ok(alice, 'PATCH', `/tasks/${a}`, { durationWorkingDays: 15 })
      expect((await read(alice, a)).plannedFinish).toBe('2027-03-19')

      // Step 3: the violation on M's dependency on A is red.
      expect(await red(alice, apollo)).toEqual([
        {
          kind: 'fixed-date-milestone-pushed',
          task: { id: m, projectId: apollo, title: 'M' },
          blocker: { id: a, projectId: apollo, title: 'A' },
          crossProject: false,
          start: '2027-03-12',
          blockerFinish: '2027-03-19',
        },
      ])
      // Negative: M is still on 2027-03-12.
      expect((await read(alice, m)).milestone).toEqual(fixed('2027-03-12'))
    })

    it("TC-028: a dependency turns red when the other project's milestone moves past the task's start", async () => {
      const borealis = await seedProject(x.db, bob, 'Borealis')
      await grantRole(x.db, alice, borealis, 'read-only')
      const m = await task(bob, borealis, { title: 'M', milestone: fixed('2027-03-10') })
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const t = await task(alice, apollo, {
        title: 'T',
        plannedStart: '2027-03-11',
        durationWorkingDays: 2,
      })
      await block(alice, t, m)

      // Step 1: the dependency is not red.
      expect(await red(alice, apollo)).toEqual([])

      // Step 2: bob moves M to 2027-03-17.
      await ok(bob, 'PATCH', `/tasks/${m}`, { milestone: fixed('2027-03-17') })

      // Step 3: the dependency of T on M is red in Apollo.
      expect(await red(alice, apollo)).toEqual([
        {
          kind: 'cross-project-dependency',
          task: { id: t, projectId: apollo, title: 'T' },
          blocker: { id: m, projectId: borealis, title: 'M' },
          crossProject: true,
          start: '2027-03-11',
          blockerFinish: '2027-03-17',
        },
      ])
      // Negative: T still starts on 2027-03-11.
      const after = await read(alice, t)
      expect([after.plannedStart, after.plannedFinish]).toEqual(['2027-03-11', '2027-03-12'])
    })

    it('TC-217: a cross-project conflict is red to the owners of both projects', async () => {
      // The personal Gantt views covering both projects are the saved views' (SC-020); here each
      // person asks for the violations of each of the two projects their view would cover.
      const borealis = await seedProject(x.db, bob, 'Borealis')
      await grantRole(x.db, alice, borealis, 'read-only')
      const m = await task(bob, borealis, { title: 'M', milestone: fixed('2027-03-17') })
      const apollo = await seedProject(x.db, alice, 'Apollo')
      await grantRole(x.db, bob, apollo, 'read-only')
      const t = await task(alice, apollo, { title: 'T', plannedStart: '2027-03-11' })
      await block(alice, t, m)

      const conflict = {
        kind: 'cross-project-dependency',
        task: { id: t, projectId: apollo, title: 'T' },
        blocker: { id: m, projectId: borealis, title: 'M' },
        crossProject: true,
        start: '2027-03-11',
        blockerFinish: '2027-03-17',
      }
      for (const who of [alice, bob]) {
        for (const project of [apollo, borealis]) {
          expect(await red(who, project)).toEqual([conflict])
        }
      }
      // Negative: neither T nor M has been moved to remove the conflict.
      expect((await read(alice, t)).plannedStart).toBe('2027-03-11')
      expect((await read(bob, m)).milestone).toEqual(fixed('2027-03-17'))
    })
  })

  describe('violationsOf', () => {
    let apollo: string
    let borealis: string

    beforeEach(async () => {
      apollo = await seedProject(x.db, alice, 'Apollo')
      borealis = await seedProject(x.db, bob, 'Borealis')
      await grantRole(x.db, alice, borealis, 'read-only')
    })

    const create = async (who: Account, projectId: string, fields: TaskInput) =>
      (await services.tasks.createTask(by(who), projectId, fields)).id

    const blockedBy = (who: Account, taskId: string, blockerId: string) =>
      services.taskRelations.addBlocker(by(who), taskId, blockerId)

    const of = (who: Account, projectId: string) =>
      services.violations.violationsOf(by(who), projectId)

    /** A task of Apollo blocked by a milestone of Borealis lying after its start. */
    const crossConflict = async () => {
      const m = await create(bob, borealis, { title: 'M', milestone: fixed('2027-03-17') })
      const t = await create(alice, apollo, { title: 'T', plannedStart: '2027-03-11' })
      await blockedBy(alice, t, m)
      return { m, t }
    }

    it('refuses as not visible someone with no role in the project', async () => {
      const carol = await seedAccount(x.db, { username: 'carol' })
      await expect(of(carol, apollo)).rejects.toThrow(ServiceError)
      await expect(of(carol, apollo)).rejects.toMatchObject({ kind: 'not-visible' })
    })

    it('answers every role in the project, the read-only role included', async () => {
      const carol = await seedAccount(x.db, { username: 'carol' })
      await grantRole(x.db, carol, apollo, 'read-only')
      const a = await create(alice, apollo, {
        title: 'A',
        plannedStart: '2027-03-01',
        durationWorkingDays: 10,
      })
      const m = await create(alice, apollo, { title: 'M', milestone: fixed('2027-03-05') })
      await blockedBy(alice, m, a)
      expect(await of(carol, apollo)).toMatchObject([{ task: { id: m }, blocker: { id: a } }])
    })

    it('reports a cross-project conflict in the dependent project and the milestone’s', async () => {
      const { m, t } = await crossConflict()
      const expected = [{ kind: 'cross-project-dependency', task: { id: t }, blocker: { id: m } }]
      expect(await of(alice, apollo)).toMatchObject(expected)
      expect(await of(alice, borealis)).toMatchObject(expected)
    })

    it('gives a cross-project conflict only to a caller who can read both projects', async () => {
      await crossConflict()
      // Bob owns the milestone, but cannot read Apollo, so learns nothing of its task.
      expect(await of(bob, borealis)).toEqual([])
      // A violation within one project is given to whoever can read it.
      const a = await create(bob, borealis, {
        title: 'A',
        plannedStart: '2027-03-01',
        durationWorkingDays: 10,
      })
      const launch = await create(bob, borealis, { title: 'L', milestone: fixed('2027-03-05') })
      await blockedBy(bob, launch, a)
      expect(await of(bob, borealis)).toMatchObject([
        { kind: 'fixed-date-milestone-pushed', task: { id: launch }, blocker: { id: a } },
      ])
      // Once Bob can read Apollo, he sees the conflict too.
      await grantRole(x.db, bob, apollo, 'read-only')
      expect(await of(bob, borealis)).toHaveLength(2)
    })

    it('stops reporting a conflict once it is gone', async () => {
      const { m, t } = await crossConflict()
      expect(await of(alice, apollo)).toHaveLength(1)
      // Alice moves her own task to start on the milestone's date: no longer after its start.
      await services.tasks.updateTask(by(alice), t, { plannedStart: '2027-03-17' })
      expect(await of(alice, apollo)).toEqual([])
      // Bob moves the milestone later again: red once more.
      await services.tasks.updateTask(by(bob), m, { milestone: fixed('2027-03-18') })
      expect(await of(alice, apollo)).toHaveLength(1)
      // And the relation removed: nothing left to check.
      await services.taskRelations.removeBlocker(by(alice), t, m)
      expect(await of(alice, apollo)).toEqual([])
    })

    it('checks no dependency of a cancelled task', async () => {
      const { t } = await crossConflict()
      await services.taskCancellation.cancel(by(alice), t)
      expect(await of(alice, apollo)).toEqual([])
    })

    it('reports nothing for an unscheduled task or a floating milestone with no date', async () => {
      const m = await create(bob, borealis, { title: 'M', milestone: fixed('2027-03-17') })
      const unscheduled = await create(alice, apollo, { title: 'U' })
      await blockedBy(alice, unscheduled, m)
      const floating = await create(bob, borealis, {
        title: 'F',
        milestone: { variant: 'floating' },
      })
      const t = await create(alice, apollo, { title: 'T', plannedStart: '2027-03-11' })
      await blockedBy(alice, t, floating)
      expect(await of(alice, apollo)).toEqual([])
    })

    it("takes a floating milestone's scheduled date across projects", async () => {
      const b = await create(bob, borealis, {
        title: 'B',
        plannedStart: '2027-03-01',
        durationWorkingDays: 10,
      })
      const floating = await create(bob, borealis, {
        title: 'F',
        milestone: { variant: 'floating' },
      })
      await blockedBy(bob, floating, b)
      const t = await create(alice, apollo, { title: 'T', plannedStart: '2027-03-11' })
      await blockedBy(alice, t, floating)
      expect(await of(alice, apollo)).toMatchObject([
        { kind: 'cross-project-dependency', start: '2027-03-11', blockerFinish: '2027-03-12' },
      ])
    })

    it("reports a fixed-date milestone pushed by another project's milestone once", async () => {
      const m = await create(bob, borealis, { title: 'M', milestone: fixed('2027-03-17') })
      const launch = await create(alice, apollo, { title: 'L', milestone: fixed('2027-03-12') })
      await blockedBy(alice, launch, m)
      expect(await of(alice, apollo)).toEqual([
        {
          kind: 'fixed-date-milestone-pushed',
          task: { id: launch, projectId: apollo, title: 'L' },
          blocker: { id: m, projectId: borealis, title: 'M' },
          crossProject: true,
          start: '2027-03-12',
          blockerFinish: '2027-03-17',
        },
      ])
    })

    it('reports each pushing blocker of a milestone, and leaves out what does not push it', async () => {
      const early = await create(alice, apollo, {
        title: 'Early',
        plannedStart: '2027-03-01',
        durationWorkingDays: 2,
      })
      const late = await create(alice, apollo, {
        title: 'Late',
        plannedStart: '2027-03-01',
        durationWorkingDays: 10,
      })
      const later = await create(alice, apollo, {
        title: 'Later',
        plannedStart: '2027-03-01',
        durationWorkingDays: 12,
      })
      const launch = await create(alice, apollo, { title: 'L', milestone: fixed('2027-03-05') })
      for (const blocker of [early, late, later]) await blockedBy(alice, launch, blocker)
      const found = await of(alice, apollo)
      expect(found.map((v) => [v.task.id, v.blocker.id, v.blockerFinish])).toEqual([
        [launch, late, '2027-03-12'],
        [launch, later, '2027-03-16'],
      ])
    })

    it('leaves a violation in another project out, and moves no task', async () => {
      const carol = await seedAccount(x.db, { username: 'carol' })
      const cassini = await seedProject(x.db, carol, 'Cassini')
      const a = await create(carol, cassini, {
        title: 'A',
        plannedStart: '2027-03-01',
        durationWorkingDays: 10,
      })
      const launch = await create(carol, cassini, { title: 'L', milestone: fixed('2027-03-05') })
      await blockedBy(carol, launch, a)
      await crossConflict()
      expect(await of(alice, apollo)).toHaveLength(1)
      expect(await violationsIn(x.db, cassini)).toHaveLength(1)
      // Reading the violations changes nothing.
      expect((await services.tasks.getTask(by(carol), launch)).milestone).toEqual(
        fixed('2027-03-05'),
      )
      expect((await services.tasks.getTask(by(carol), a)).plannedFinish).toBe('2027-03-12')
    })
  })
})
