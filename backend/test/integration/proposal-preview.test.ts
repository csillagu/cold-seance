import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { auditLog, proposalChanges, redFlags, tasks } from '../../src/db/schema.ts'
import type { Caller, Channel } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import type { Proposal } from '../../src/service/proposals.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { Task, TaskInput } from '../../src/service/tasks.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The proposal preview (SC-011: FR-071, FR-072, FR-079) against a real PostgreSQL, each test in a
// fresh test deployment: a fresh database, first system admin `root`, and a global calendar with
// Saturday and Sunday as the weekend and no company holidays. First the test cases' service and
// REST parts, then the rules through the service layer. Each proposal is created through the
// service layer with the MCP server's channel; proposals made through the MCP server itself
// (SC-027) are tested in mcp-server.test.ts. The browser steps are in
// e2e/tests/proposal-preview.spec.ts (SC-034).

type Account = Awaited<ReturnType<typeof seedAccount>>
type Method = 'GET' | 'POST' | 'PATCH'

interface PreviewedTask extends Task {
  parentId: string | null
  blockedBy: string[]
}

interface Preview {
  proposalId: string
  differences: {
    taskId: string
    projectId: string
    newTask: string | null
    before: PreviewedTask | null
    after: PreviewedTask
  }[]
  newRedFlags: ({ kind: string; projectId: string } & Record<string, unknown>)[]
}

const by = (account: Account, channel: Channel = 'mcp'): Caller => ({
  accountId: account.id,
  channel,
})

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

describe('the proposal preview', () => {
  let x: TestDatabase
  let services: Services
  let app: ReturnType<typeof buildApp>
  let alice: Account
  let bob: Account
  let apollo: string

  beforeEach(async () => {
    x = await createTestDatabase()
    services = createServices(x.db)
    app = buildApp({}, { authenticators: [testAuthenticator], services })
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
    apollo = await seedProject(x.db, alice, 'Apollo')
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

  const task = async (fields: TaskInput, who: Account = alice) =>
    ok<Task>(who, 'POST', `/projects/${apollo}/tasks`, fields)

  const block = (taskId: string, blockerId: string) =>
    ok(alice, 'POST', `/tasks/${taskId}/blocked-by`, { blockerId })

  const propose = async (changes: object[][], who: Account = alice): Promise<Proposal> =>
    services.proposals.createProposal(by(who), {
      groups: changes.map((group) => ({ changes: group })),
    })

  const preview = (who: Account, proposalId: string) =>
    ok<Preview>(who, 'GET', `/proposals/${proposalId}/preview`)

  const after = (result: Preview, taskId: string) =>
    result.differences.find((difference) => difference.taskId === taskId)?.after

  /** Everything the preview must leave as it was: the tasks, the red flags and the audit log. */
  const live = async () => ({
    tasks: await x.db.select().from(tasks),
    redFlags: await x.db.select().from(redFlags),
    auditLog: await x.db.select().from(auditLog),
    proposalChanges: await x.db.select().from(proposalChanges),
  })

  describe('the test cases', () => {
    it('TC-100: a proposal leaves the live plan unchanged before approval', async () => {
      // The service and REST part; opening it in the browser and the plain Gantt are in
      // e2e/tests/proposal-preview.spec.ts (SC-034).
      const a = await task({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 1 })
      const proposal = await propose([
        [{ kind: 'update-task', task: { taskId: a.id }, fields: { plannedStart: '2027-03-08' } }],
      ])
      const before = await live()

      // Step 2, opened without approving it: the preview moves A...
      const result = await preview(alice, proposal.id)
      expect(after(result, a.id)?.plannedStart).toBe('2027-03-08')

      // ...and step 3: A still starts 2027-03-01, and nothing was recorded or changed.
      expect((await ok<Task>(alice, 'GET', `/tasks/${a.id}`)).plannedStart).toBe('2027-03-01')
      expect(await live()).toEqual(before)
    })

    it('TC-101: opening a proposal previews its rescheduled differences and new red flags', async () => {
      // The service and REST part; showing them in the browser is in proposal-preview.spec.ts.
      const a = await task({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 3 })
      const b = await task({
        title: 'B',
        durationWorkingDays: 2,
        assignees: [alice.id],
        aiShare: 0,
      })
      await block(b.id, a.id)
      const c = await task({
        title: 'C',
        plannedStart: '2027-03-09',
        durationWorkingDays: 1,
        assignees: [alice.id],
        aiShare: 0,
      })
      const proposal = await propose([
        [{ kind: 'update-task', task: { taskId: a.id }, fields: { durationWorkingDays: 5 } }],
      ])

      // Step 1: the preview shows A finishing 2027-03-05 and B moved to 2027-03-08 to 03-09...
      const result = await preview(alice, proposal.id)
      expect(after(result, a.id)).toMatchObject({
        plannedStart: '2027-03-01',
        plannedFinish: '2027-03-05',
        durationWorkingDays: 5,
      })
      const movedB = result.differences.find((difference) => difference.taskId === b.id)
      expect(movedB?.before).toMatchObject({
        plannedStart: '2027-03-04',
        plannedFinish: '2027-03-05',
      })
      expect(movedB?.after).toMatchObject({
        plannedStart: '2027-03-08',
        plannedFinish: '2027-03-09',
      })
      // C itself does not move.
      expect(after(result, c.id)).toBeUndefined()
      // ...and a new red flag: alice overloaded on 2027-03-09.
      expect(result.newRedFlags).toContainEqual({
        kind: 'overload',
        projectId: apollo,
        accountId: alice.id,
        date: '2027-03-09',
      })
      // No red flag the plan raises now is given as new.
      const current = await ok<{ kind: string }[]>(alice, 'GET', `/projects/${apollo}/red-flags`)
      expect(current).toEqual([])

      // Step 2: nothing was saved.
      expect(await ok<Task>(alice, 'GET', `/tasks/${a.id}`)).toMatchObject({
        plannedFinish: '2027-03-03',
        durationWorkingDays: 3,
      })
      expect(await ok<Task>(alice, 'GET', `/tasks/${b.id}`)).toMatchObject({
        plannedStart: '2027-03-04',
        plannedFinish: '2027-03-05',
      })
    })

    it("TC-112: a plan change does not rewrite a proposal's changes", async () => {
      // The service and REST part; opening the preview in the browser is in the e2e spec.
      await grantRole(x.db, bob, apollo, 'read-write')
      const a = await task({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 1 })
      const b = await task({ title: 'B', durationWorkingDays: 1 })
      await block(b.id, a.id)
      expect((await ok<Task>(alice, 'GET', `/tasks/${b.id}`)).plannedStart).toBe('2027-03-02')
      const assign = {
        kind: 'update-task',
        task: { taskId: b.id },
        fields: { assignees: [bob.id] },
      }
      const proposal = await propose([[assign]])
      // Then bob moves A to 2027-03-08, so that B is rescheduled to 2027-03-09.
      await ok(bob, 'PATCH', `/tasks/${a.id}`, { plannedStart: '2027-03-08' })
      expect((await ok<Task>(alice, 'GET', `/tasks/${b.id}`)).plannedStart).toBe('2027-03-09')

      // Step 1: the proposal still holds exactly its one change.
      const read = await ok<Proposal>(alice, 'GET', `/proposals/${proposal.id}`)
      expect(read.groups.flatMap((group) => group.changes)).toEqual([
        { ...assign, id: proposal.groups[0]?.changes[0]?.id, projectId: apollo },
      ])

      // Step 2: the preview shows B on 2027-03-09, assigned to bob.
      const result = await preview(alice, proposal.id)
      expect(after(result, b.id)).toMatchObject({
        plannedStart: '2027-03-09',
        plannedFinish: '2027-03-09',
        assignees: [bob.id],
      })
      expect(result.differences.map((difference) => difference.taskId)).toEqual([b.id])

      // Previewing it added or altered nothing in the proposal.
      expect(await ok<Proposal>(alice, 'GET', `/proposals/${proposal.id}`)).toEqual(read)
    })

    it('TC-226: a proposal holds the changed input and no derived dates', async () => {
      // The preview's content, through the service layer; step 1 is in proposals.test.ts.
      // Opening it in the browser is in e2e/tests/proposal-preview.spec.ts (SC-034).
      const a = await task({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 3 })
      const b = await task({ title: 'B', durationWorkingDays: 2 })
      await block(b.id, a.id)
      const proposal = await propose([
        [{ kind: 'update-task', task: { taskId: a.id }, fields: { durationWorkingDays: 5 } }],
      ])

      const result = await services.proposalPreview.previewProposal(by(alice, 'ui'), proposal.id)
      const shown = result.differences.find((difference) => difference.taskId === b.id)
      expect(shown?.after).toMatchObject({
        plannedStart: '2027-03-08',
        plannedFinish: '2027-03-09',
      })
      // The dates are the preview's own: the stored proposal still holds none of them.
      const rows = await x.db.select({ change: proposalChanges.change }).from(proposalChanges)
      expect(JSON.stringify(rows)).not.toContain('2027-03')
    })
  })

  describe('the rules', () => {
    it('shows a task the proposal creates, with its relations, under its key', async () => {
      const a = await task({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 1 })
      const proposal = await propose([
        [
          {
            kind: 'create-task',
            key: 'N',
            projectId: apollo,
            fields: { title: 'N', durationWorkingDays: 2 },
          },
          { kind: 'add-blocker', task: { newTask: 'N' }, blocker: { taskId: a.id } },
        ],
      ])
      const before = await live()

      const result = await preview(alice, proposal.id)
      expect(result.differences).toHaveLength(1)
      const [created] = result.differences
      expect(created).toMatchObject({ projectId: apollo, newTask: 'N', before: null })
      expect(created?.after).toMatchObject({
        title: 'N',
        plannedStart: '2027-03-02',
        plannedFinish: '2027-03-03',
        blockedBy: [a.id],
        parentId: null,
      })
      expect(await live()).toEqual(before)
    })

    it('shows a relation the proposal changes', async () => {
      const parent = await task({ title: 'P' })
      const child = await task({ title: 'C', plannedStart: '2027-03-01', durationWorkingDays: 1 })
      const proposal = await propose([
        [{ kind: 'set-parent', task: { taskId: child.id }, parent: { taskId: parent.id } }],
      ])

      const result = await preview(alice, proposal.id)
      expect(after(result, child.id)?.parentId).toBe(parent.id)
      // The parent spans its new subtask.
      expect(after(result, parent.id)).toMatchObject({
        plannedStart: '2027-03-01',
        plannedFinish: '2027-03-01',
      })
    })

    it('refuses as a conflict a change the plan does not allow now, saving nothing', async () => {
      const a = await task({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 1 })
      const proposal = await propose([
        [{ kind: 'update-task', task: { taskId: a.id }, fields: { durationWorkingDays: 2 } }],
        // 2027-03-06 is a Saturday, a forbidden date (FR-011).
        [{ kind: 'update-task', task: { taskId: a.id }, fields: { plannedStart: '2027-03-06' } }],
      ])
      const before = await live()

      const response = await call(alice, 'GET', `/proposals/${proposal.id}/preview`)
      expect(response.statusCode).toBe(409)
      expect(response.json<{ message: string }>().message).toMatch(
        /^Change 1 of group 2 of the proposal cannot be made on the plan as it is now: /,
      )
      expect(await live()).toEqual(before)
    })

    it("makes the changes as the proposal's creator, for anyone who may read it", async () => {
      await grantRole(x.db, bob, apollo, 'read-only')
      const a = await task({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 1 })
      const proposal = await propose([
        [{ kind: 'update-task', task: { taskId: a.id }, fields: { plannedStart: '2027-03-08' } }],
      ])

      // bob may not change the plan, but may read the proposal and so preview it.
      const result = await preview(bob, proposal.id)
      expect(after(result, a.id)?.plannedStart).toBe('2027-03-08')
    })

    it('is refused to someone who may not read the proposal, and for no such proposal', async () => {
      const a = await task({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 1 })
      const proposal = await propose([
        [{ kind: 'update-task', task: { taskId: a.id }, fields: { plannedStart: '2027-03-08' } }],
      ])

      await refused(services.proposalPreview.previewProposal(by(bob), proposal.id), 'not-visible')
      await refused(
        services.proposalPreview.previewProposal(by(alice), '00000000-0000-4000-8000-000000000000'),
        'not-found',
      )
      expect((await call(bob, 'GET', `/proposals/${proposal.id}/preview`)).statusCode).toBe(403)
    })

    it('gives only the red flags the proposal would newly raise', async () => {
      // alice is already overloaded on 2027-03-01; the proposal adds an overload on 2027-03-08.
      const load = { durationWorkingDays: 1, assignees: [alice.id], aiShare: 0 }
      await task({ title: 'A', plannedStart: '2027-03-01', ...load })
      await task({ title: 'B', plannedStart: '2027-03-01', ...load })
      await task({ title: 'C', plannedStart: '2027-03-08', ...load })
      const d = await task({ title: 'D', plannedStart: '2027-03-10', ...load })
      const proposal = await propose([
        [{ kind: 'update-task', task: { taskId: d.id }, fields: { plannedStart: '2027-03-08' } }],
      ])

      const result = await preview(alice, proposal.id)
      const overloads = result.newRedFlags.filter((flag) => flag.kind === 'overload')
      expect(overloads).toEqual([
        { kind: 'overload', projectId: apollo, accountId: alice.id, date: '2027-03-08' },
      ])
    })
  })
})
