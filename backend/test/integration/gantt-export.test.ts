import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { TaskInput } from '../../src/service/tasks.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The Mermaid Gantt exporter (SC-021: FR-063, DD-004) against a real PostgreSQL, each test in a
// fresh test deployment: a fresh database, first system admin `root`, and a global calendar with
// Saturday and Sunday as the weekend and no company holidays. First its test case through the REST
// API, then the rules through the service layer.

type Account = Awaited<ReturnType<typeof seedAccount>>
type Method = 'GET' | 'POST' | 'PATCH'

const by = (account: Account): Caller => ({ accountId: account.id, channel: 'ui' })

describe('the Mermaid Gantt exporter', () => {
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

  const ok = async <T = { id: string }>(
    who: Account,
    method: Method,
    url: string,
    payload?: object,
  ) => {
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

  const exported = async (who: Account, projectId: string) =>
    (await ok<{ markdown: string }>(who, 'GET', `/projects/${projectId}/gantt/mermaid`)).markdown

  describe('its test case through the REST API', () => {
    it('TC-089: the exported Gantt holds the tasks, dates, dependencies and milestones', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const busy = { assignees: [alice.id], aiShare: 0, plannedStart: '2027-03-01' }
      const a = await task(alice, apollo, { title: 'A', ...busy, durationWorkingDays: 3 })
      await task(alice, apollo, { title: 'B', ...busy, durationWorkingDays: 1 })
      const c = await task(alice, apollo, { title: 'C', durationWorkingDays: 2 })
      await block(alice, c, a)
      const m = await task(alice, apollo, {
        title: 'M',
        milestone: { variant: 'fixed-date', date: '2027-03-12' },
      })
      await block(alice, m, c)
      // alice is overloaded on 2027-03-01, so both her tasks are red on the Gantt.
      const flags = await ok<unknown[]>(alice, 'GET', `/projects/${apollo}/red-flags`)
      expect(flags).not.toEqual([])

      // Step 1: as alice, export the Gantt of Apollo.
      const chart = await exported(alice, apollo)

      // The tasks with their dates, the dependencies C on A and M on C, and M on 2027-03-12.
      expect(chart).toBe(
        [
          '```mermaid',
          'gantt',
          '    title Apollo',
          '    dateFormat YYYY-MM-DD',
          '    inclusiveEndDates',
          '    A : 2027-03-01, 2027-03-03',
          '    B : 2027-03-01, 2027-03-01',
          '    C (after A) : 2027-03-04, 2027-03-05',
          '    M (after C) : milestone, 2027-03-12, 0d',
          '```',
          '',
        ].join('\n'),
      )
      // Negative: no load figure for alice, and no red flag or red marking.
      expect(chart).not.toMatch(/%|alice|load|crit|red/i)

      // Step 2, GitHub rendering the chart, is not tested here.
      // Pending: the export dialog, SC-096 (node F17), and GitHub's rendered view of the file.
    })
  })

  describe('exportProjectGantt', () => {
    const refused = async (promise: Promise<unknown>) => {
      const error = await promise.then(
        () => undefined,
        (e: unknown) => e,
      )
      if (!(error instanceof ServiceError)) {
        throw new Error(`expected a ServiceError, got ${String(error)}`)
      }
      return error
    }

    it('is given to anyone with a role in the project, a read-only one too', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      await grantRole(x.db, bob, apollo, 'read-only')
      await task(alice, apollo, { title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 1 })
      const { markdown } = await services.ganttExport.exportProjectGantt(by(bob), apollo)
      expect(markdown).toContain('\n    A : 2027-03-01, 2027-03-01\n')
    })

    it('is refused as not visible to someone with no role in the project', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const error = await refused(services.ganttExport.exportProjectGantt(by(bob), apollo))
      expect(error.kind).toBe('not-visible')
    })

    it('leaves out the unscheduled tasks and the floating milestones with no day', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const u = await task(alice, apollo, { title: 'Unscheduled' })
      const f = await task(alice, apollo, { title: 'Floating', milestone: { variant: 'floating' } })
      await block(alice, f, u)
      const { markdown } = await services.ganttExport.exportProjectGantt(by(alice), apollo)
      expect(markdown).not.toMatch(/Unscheduled|Floating/)
    })

    it('puts a floating milestone on the day its last blocker finishes', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const a = await task(alice, apollo, {
        title: 'A',
        plannedStart: '2027-03-01',
        durationWorkingDays: 5,
      })
      const f = await task(alice, apollo, {
        title: 'Docs ready',
        milestone: { variant: 'floating' },
      })
      await block(alice, f, a)
      const { markdown } = await services.ganttExport.exportProjectGantt(by(alice), apollo)
      expect(markdown).toContain('\n    Docs ready (after A) : milestone, 2027-03-05, 0d\n')
    })

    it('names no milestone of another project, nor its tasks, in either direction', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const borealis = await seedProject(x.db, alice, 'Borealis')
      const a = await task(alice, apollo, {
        title: 'A',
        plannedStart: '2027-03-15',
        durationWorkingDays: 1,
      })
      const ours = await task(alice, apollo, {
        title: 'Ours',
        milestone: { variant: 'fixed-date', date: '2027-03-05' },
      })
      const theirs = await task(alice, borealis, {
        title: 'Theirs',
        milestone: { variant: 'fixed-date', date: '2027-03-10' },
      })
      const later = await task(alice, borealis, {
        title: 'Later',
        plannedStart: '2027-03-08',
        durationWorkingDays: 1,
      })
      await block(alice, a, theirs)
      await block(alice, later, ours)
      const { markdown } = await services.ganttExport.exportProjectGantt(by(alice), apollo)
      expect(markdown).toContain('\n    A : 2027-03-15, 2027-03-15\n')
      expect(markdown).toContain('\n    Ours : milestone, 2027-03-05, 0d\n')
      expect(markdown).not.toMatch(/Theirs|Later|Borealis/)
    })

    it('keeps a cancelled task on the chart, as the Gantt does', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const a = await task(alice, apollo, {
        title: 'A',
        plannedStart: '2027-03-01',
        durationWorkingDays: 2,
      })
      await ok(alice, 'POST', `/tasks/${a}/cancel`, {})
      const { markdown } = await services.ganttExport.exportProjectGantt(by(alice), apollo)
      expect(markdown).toContain('\n    A : 2027-03-01, 2027-03-02\n')
    })
  })
})
