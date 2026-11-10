import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import type { Caller, Channel } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import type { ProposalConflicts } from '../../src/service/proposal-conflicts.ts'
import type { Proposal } from '../../src/service/proposals.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { Task, TaskInput } from '../../src/service/tasks.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The proposal conflict detector (SC-047: FR-076, DD-022) against a real PostgreSQL, each test in
// a fresh test deployment: a fresh database, first system admin `root`, accounts `alice` and
// `bob`, and project `Apollo` created by `alice`, where `bob` has the read-write role. First the
// test cases' service and REST parts, then the rules through the service layer. Each proposal is
// created through the service layer with the channel the MCP server will give it; the MCP server
// itself comes with SC-027 (B19). The browser steps come with the conflict panel (SC-035, F24).

type Account = Awaited<ReturnType<typeof seedAccount>>
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT'

const by = (account: Account, channel: Channel = 'mcp'): Caller => ({
  accountId: account.id,
  channel,
})

const move = (taskId: string, plannedStart: string) => ({
  kind: 'update-task',
  task: { taskId },
  fields: { plannedStart },
})

describe('the proposal conflict detector', () => {
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
    await grantRole(x.db, bob, apollo, 'read-write')
  })

  afterEach(async () => {
    await app?.close()
    await x?.drop()
  })

  const call = (who: Account, method: Method, url: string, payload?: object) =>
    app.inject({
      method,
      url: `/api${url}`,
      headers: as(who, 'ui'),
      ...(payload === undefined ? {} : { payload }),
    })

  const ok = async <T>(who: Account, method: Method, url: string, payload?: object) => {
    const response = await call(who, method, url, payload)
    if (response.statusCode >= 300) throw new Error(`${method} ${url}: ${response.body}`)
    return response.json<T>()
  }

  const task = async (fields: TaskInput, who: Account = alice) =>
    ok<Task>(who, 'POST', `/projects/${apollo}/tasks`, fields)

  /** Task A in Apollo, 2027-03-01, 1 working day, as the test cases give it. */
  const taskA = (fields: TaskInput = {}) =>
    task({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 1, ...fields })

  const edit = (who: Account, taskId: string, fields: TaskInput) =>
    ok<Task>(who, 'PATCH', `/tasks/${taskId}`, fields)

  /** A proposal by alice, as through the MCP server with her token. */
  const propose = (groups: object[][]): Promise<Proposal> =>
    services.proposals.createProposal(by(alice), {
      groups: groups.map((changes) => ({ changes })),
    })

  const conflicts = (who: Account, proposalId: string) =>
    ok<ProposalConflicts>(who, 'GET', `/proposals/${proposalId}/conflicts`)

  /** The conflicts as the service layer gives them to alice, without the ids. */
  const found = async (proposal: Proposal) =>
    (await services.proposalConflicts.conflictsOf(by(alice, 'ui'), proposal.id)).conflicts.map(
      ({ taskId, reason, inputs }) => ({ taskId, reason, inputs }),
    )

  describe('the test cases', () => {
    it("TC-106: another person's later edit to the same input is shown as a conflict", async () => {
      // The service and REST part. Pending: the conflict panel in the browser, with the choice to
      // resolve or drop (SC-035, F24).
      const a = await taskA()
      const proposal = await propose([[move(a.id, '2027-03-08')]])
      await edit(bob, a.id, { plannedStart: '2027-03-03' })

      // Step 1, as alice: the move of A is a conflict, in its group, naming the edited input.
      const [group] = proposal.groups
      const [change] = group?.changes ?? []
      expect(await conflicts(alice, proposal.id)).toEqual({
        proposalId: proposal.id,
        conflicts: [
          {
            groupId: group?.id,
            changeId: change?.id,
            taskId: a.id,
            reason: 'edited',
            inputs: ['plannedStart'],
          },
        ],
      })

      // Negative assertion: A is not moved by reading them; it still starts 2027-03-03.
      expect((await ok<Task>(alice, 'GET', `/tasks/${a.id}`)).plannedStart).toBe('2027-03-03')
    })

    // Pending: TC-107, a change to a deleted task is shown as a conflict. No SC deletes a task
    // (tasks are cancelled, SC-038), so there is no task to delete in a test; the detector marks
    // a change whose task no longer exists as `deleted`. The owner's question is open on #125.
    // The conflict panel comes with SC-035 (F24).

    it('TC-108: an edit to a different input on the same task is not a conflict', async () => {
      // The service and REST part. Pending: the conflict panel in the browser (SC-035, F24).
      const a = await taskA({ title: 'Draft' })
      const proposal = await propose([[move(a.id, '2027-03-08')]])
      await edit(bob, a.id, { title: 'Draft v2' })

      // Step 1, as alice: no conflict, and the move of A is not marked as one.
      expect(await conflicts(alice, proposal.id)).toEqual({
        proposalId: proposal.id,
        conflicts: [],
      })
    })
  })

  describe('the rules', () => {
    it("is no conflict when the proposal's creator edits the input herself", async () => {
      const a = await taskA()
      const proposal = await propose([[move(a.id, '2027-03-08')]])
      await edit(alice, a.id, { plannedStart: '2027-03-03' })
      expect(await found(proposal)).toEqual([])
    })

    it('is no conflict for an edit made before the proposal was created', async () => {
      const a = await taskA()
      await edit(bob, a.id, { plannedStart: '2027-03-03' })
      const proposal = await propose([[move(a.id, '2027-03-08')]])
      expect(await found(proposal)).toEqual([])
    })

    it('is no conflict when the scheduler moves the task because of an edit elsewhere', async () => {
      const blocker = await task({
        title: 'B',
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      const a = await taskA()
      await ok(alice, 'POST', `/tasks/${a.id}/blocked-by`, { blockerId: blocker.id })
      const proposal = await propose([[move(a.id, '2027-03-15')]])
      // Bob lengthens the blocker: A is rescheduled after it, but its inputs are not edited.
      await edit(bob, blocker.id, { durationWorkingDays: 5 })
      expect((await ok<Task>(alice, 'GET', `/tasks/${a.id}`)).plannedStart).toBe('2027-03-08')
      expect(await found(proposal)).toEqual([])
    })

    it('marks only the changes on the edited input, and names only those inputs', async () => {
      const a = await taskA({ title: 'Draft' })
      const b = await task({ title: 'B', plannedStart: '2027-03-01', durationWorkingDays: 1 })
      const proposal = await propose([
        [
          {
            kind: 'update-task',
            task: { taskId: a.id },
            fields: { title: 'Final', plannedStart: '2027-03-08', effort: 3 },
          },
        ],
        [move(b.id, '2027-03-08')],
      ])
      await edit(bob, a.id, { title: 'Draft v2', effort: 2 })
      expect(await found(proposal)).toEqual([
        { taskId: a.id, reason: 'edited', inputs: ['title', 'effort'] },
      ])
    })

    it('marks a change of the status when someone else sets the status or cancels the task', async () => {
      const a = await taskA()
      const b = await task({ title: 'B', plannedStart: '2027-03-01', durationWorkingDays: 1 })
      const proposal = await propose([
        [{ kind: 'set-status', task: { taskId: a.id }, status: 'done' }],
        [{ kind: 'cancel-task', task: { taskId: b.id } }],
      ])
      await ok(bob, 'PUT', `/tasks/${a.id}/status`, { status: 'in-progress' })
      await ok(bob, 'POST', `/tasks/${b.id}/cancel`)
      expect(await found(proposal)).toEqual([
        { taskId: a.id, reason: 'edited', inputs: ['status'] },
        { taskId: b.id, reason: 'edited', inputs: ['status'] },
      ])
    })

    it('marks a change of the parent when someone else sets the parent', async () => {
      const a = await taskA()
      const p = await task({ title: 'P' })
      const q = await task({ title: 'Q' })
      const proposal = await propose([
        [{ kind: 'set-parent', task: { taskId: a.id }, parent: { taskId: p.id } }],
      ])
      await ok(bob, 'PUT', `/tasks/${a.id}/parent`, { parentId: q.id })
      expect(await found(proposal)).toEqual([
        { taskId: a.id, reason: 'edited', inputs: ['parent'] },
      ])
    })

    it('marks a change of a blocker only when someone else changes that same relation', async () => {
      const a = await taskA()
      const b1 = await task({ title: 'B1' })
      const b2 = await task({ title: 'B2' })
      const proposal = await propose([
        [{ kind: 'add-blocker', task: { taskId: a.id }, blocker: { taskId: b1.id } }],
      ])
      await ok(bob, 'POST', `/tasks/${a.id}/blocked-by`, { blockerId: b2.id })
      expect(await found(proposal)).toEqual([])
      await ok(bob, 'POST', `/tasks/${a.id}/blocked-by`, { blockerId: b1.id })
      expect(await found(proposal)).toEqual([
        { taskId: a.id, reason: 'edited', inputs: ['blocker'] },
      ])
    })

    it('names a milestone date edit as the milestone input the change gives', async () => {
      const m = await task({ title: 'M', milestone: { variant: 'fixed-date', date: '2027-03-01' } })
      const proposal = await propose([
        [
          {
            kind: 'update-task',
            task: { taskId: m.id },
            fields: { milestone: { variant: 'fixed-date', date: '2027-03-10' } },
          },
        ],
      ])
      await edit(bob, m.id, { milestone: { variant: 'fixed-date', date: '2027-03-05' } })
      expect(await found(proposal)).toEqual([
        { taskId: m.id, reason: 'edited', inputs: ['milestone'] },
      ])
    })

    it('never marks a change that creates a task, or a change to a task the proposal creates', async () => {
      const a = await taskA()
      const proposal = await propose([
        [
          { kind: 'create-task', key: 'n', projectId: apollo, fields: { title: 'N' } },
          { kind: 'add-blocker', task: { newTask: 'n' }, blocker: { taskId: a.id } },
        ],
      ])
      await edit(bob, a.id, { title: 'A2', plannedStart: '2027-03-03' })
      expect(await found(proposal)).toEqual([])
    })

    it("resolves a group's conflicts when the group is edited, as its changes are given anew", async () => {
      const a = await taskA()
      const proposal = await propose([[move(a.id, '2027-03-08')]])
      await edit(bob, a.id, { plannedStart: '2027-03-03' })
      expect(await found(proposal)).toHaveLength(1)

      const [group] = proposal.groups
      await services.proposalEdits.editGroup(by(alice, 'ui'), proposal.id, group?.id ?? '', {
        changes: [move(a.id, '2027-03-10')],
      })
      expect(await found(proposal)).toEqual([])

      // A later edit by someone else conflicts again.
      await edit(bob, a.id, { plannedStart: '2027-03-04' })
      expect(await found(proposal)).toEqual([
        { taskId: a.id, reason: 'edited', inputs: ['plannedStart'] },
      ])
    })

    it('is read by anyone who may read the proposal, and refused to anyone else', async () => {
      const a = await taskA()
      const proposal = await propose([[move(a.id, '2027-03-08')]])
      const carol = await seedAccount(x.db, { username: 'carol' })
      await grantRole(x.db, carol, apollo, 'read-only')
      await edit(bob, a.id, { plannedStart: '2027-03-03' })
      expect((await conflicts(carol, proposal.id)).conflicts).toHaveLength(1)

      const dave = await seedAccount(x.db, { username: 'dave' })
      const refusal = await services.proposalConflicts
        .conflictsOf(by(dave, 'ui'), proposal.id)
        .then(
          () => undefined,
          (error: unknown) => error,
        )
      expect(refusal).toBeInstanceOf(ServiceError)
      expect(refusal).toMatchObject({ kind: 'not-visible' })
      expect(
        (await call(alice, 'GET', `/proposals/${crypto.randomUUID()}/conflicts`)).statusCode,
      ).toBe(404)
    })
  })
})
