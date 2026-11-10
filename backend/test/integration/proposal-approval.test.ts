import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { auditLog, proposalApprovals, tasks } from '../../src/db/schema.ts'
import type { AuditEntry } from '../../src/service/audit.ts'
import { TaskAssignments } from '../../src/service/assignment.ts'
import type { Caller, Channel } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { planVersion } from '../../src/service/proposal-application.ts'
import type { Proposal } from '../../src/service/proposals.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { Task, TaskInput } from '../../src/service/tasks.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The proposal approval (SC-048: FR-077, FR-078, FR-080, FR-132) against a real PostgreSQL, each
// test in a fresh test deployment whose clock the test sets: a fresh database, first system admin
// `root`, and a global calendar with Saturday and Sunday as the weekend and no company holidays.
// First the test cases' service and REST parts, then the rules through the service layer. Each
// proposal is created through the service layer with the channel the MCP server will give it; the
// MCP server itself comes with SC-027 (B19). The browser steps come with the proposal screens
// (SC-034, SC-072; F23, F25).
//
// TC-113, TC-114 and TC-195 are pending on a question to the owner, on issue #130: their inputs
// have alice, read-only in Borealis, create a proposal that changes Borealis, which the proposal
// store refuses (FR-203, a reading that awaits the owner's confirmation), and have bob, with no
// role in Apollo, approve his part of a proposal that also changes Apollo, which he may not read
// (FR-106, FR-017). What they check is covered below under "a proposal over several projects",
// with roles the store allows.

type Account = Awaited<ReturnType<typeof seedAccount>>
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface Approved {
  outcome: 'confirm-again' | 'waiting-for-parts' | 'applied'
  proposal: Proposal
  preview: { planVersion: string; differences: { taskId: string }[] } | null
}

const HOUR = 60 * 60 * 1000
const T0 = new Date('2027-02-26T10:00:00.000Z')
const at = (hours: number, ms = 0) => new Date(T0.getTime() + hours * HOUR + ms)

const by = (account: Account, channel: Channel = 'ui'): Caller => ({
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

const move = (taskId: string, plannedStart: string) => ({
  kind: 'update-task',
  task: { taskId },
  fields: { plannedStart },
})

const assign = (taskId: string, accountIds: string[]) => ({
  kind: 'update-task',
  task: { taskId },
  fields: { assignees: accountIds },
})

describe('the proposal approval', () => {
  let x: TestDatabase
  let services: Services
  let app: ReturnType<typeof buildApp>
  let now: Date
  let mirrored: string[][]
  let alice: Account
  let bob: Account
  let apollo: string

  beforeEach(async () => {
    x = await createTestDatabase()
    now = T0
    mirrored = []
    services = createServices(x.db, {
      now: () => now,
      planningChanges: { changed: (taskIds) => mirrored.push([...taskIds]) },
    })
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
      headers: as(who, 'ui'),
      ...(payload === undefined ? {} : { payload }),
    })

  const ok = async <T>(who: Account, method: Method, url: string, payload?: object) => {
    const response = await call(who, method, url, payload)
    if (response.statusCode >= 300) throw new Error(`${method} ${url}: ${response.body}`)
    return response.json<T>()
  }

  const task = async (fields: TaskInput, projectId = apollo, who: Account = alice) =>
    ok<Task>(who, 'POST', `/projects/${projectId}/tasks`, fields)

  /** A task of one working day starting on `plannedStart`, as the test cases give them. */
  const oneDay = (title: string, plannedStart: string, projectId = apollo, who = alice) =>
    task({ title, plannedStart, durationWorkingDays: 1 }, projectId, who)

  /** A proposal made at the current time, as through the MCP server with the token of `who`. */
  const propose = (groups: object[][], who: Account = alice) =>
    services.proposals.createProposal(by(who, 'mcp'), {
      groups: groups.map((changes) => ({ changes })),
    })

  /** The plan version of the preview `who` opens. */
  const versionSeenBy = async (who: Account, proposalId: string) =>
    (await ok<{ planVersion: string }>(who, 'GET', `/proposals/${proposalId}/preview`)).planVersion

  const approve = (who: Account, proposalId: string, projectId: string, seen?: string) =>
    call(who, 'POST', `/proposals/${proposalId}/approval`, {
      projectId,
      ...(seen === undefined ? {} : { planVersion: seen }),
    })

  /** Opens the proposal's preview as `who`, and approves the part of `projectId` from it. */
  const openAndApprove = async (who: Account, proposalId: string, projectId = apollo) => {
    const response = await approve(who, proposalId, projectId, await versionSeenBy(who, proposalId))
    if (response.statusCode !== 200) throw new Error(`approval: ${response.body}`)
    return response.json<Approved>()
  }

  const read = (taskId: string, who: Account = alice) => ok<Task>(who, 'GET', `/tasks/${taskId}`)
  const startOf = async (taskId: string) => (await read(taskId)).plannedStart

  describe('the test cases', () => {
    it('TC-110: a proposal whose change cannot be applied applies nothing', async () => {
      const dave = await seedAccount(x.db, { username: 'dave' })
      await grantRole(x.db, dave, apollo, 'read-only')
      const a = await oneDay('A', '2027-03-01')
      const b = await oneDay('B', '2027-03-02')
      const proposal = await propose([[move(a.id, '2027-03-08')], [assign(b.id, [dave.id])]])
      expect(
        (await call(alice, 'DELETE', `/projects/${apollo}/members/${dave.id}`)).statusCode,
      ).toBe(204)

      // Step 1: alice opens the proposal, and approves it.
      const opened = await call(alice, 'GET', `/proposals/${proposal.id}/preview`)
      expect(opened.statusCode).toBe(409)
      const approval = await approve(alice, proposal.id, apollo)
      expect(approval.statusCode).toBe(409)
      expect(approval.json<{ message: string }>().message).toMatch(
        /^Change 1 of group 2 of the proposal cannot be made/,
      )

      // Step 2: neither change was applied, the move of A not on its own either.
      expect(await startOf(a.id)).toBe('2027-03-01')
      expect((await read(b.id)).assignees).toEqual([])
      expect((await ok<Proposal>(alice, 'GET', `/proposals/${proposal.id}`)).status).toBe('waiting')
    })

    it('TC-115: a proposal untouched for 24 hours expires', async () => {
      const a = await oneDay('A', '2027-03-01')
      const proposal = await propose([[move(a.id, '2027-03-08')]])
      const version = await versionSeenBy(alice, proposal.id)

      // Step 1: the clock is at t0 + 24 hours + 1 minute, with no edit in between.
      now = at(24, 60 * 1000)

      // Step 2: alice's approval is rejected, the proposal reported as expired.
      const approval = await approve(alice, proposal.id, apollo, version)
      expect(approval.statusCode).toBe(409)
      expect(approval.json<{ message: string }>().message).toMatch(/expired/)
      expect((await ok<Proposal>(alice, 'GET', `/proposals/${proposal.id}`)).status).toBe('expired')

      // Step 3: A still starts 2027-03-01.
      expect(await startOf(a.id)).toBe('2027-03-01')
    })

    it('TC-109: approving a proposal applies all of its changes', async () => {
      // The service and REST part: all or nothing, through the route the browser calls. Pending:
      // opening and approving it in the browser (SC-072, F25).
      await grantRole(x.db, bob, apollo, 'read-only')
      const a = await oneDay('A', '2027-03-01')
      const b = await oneDay('B', '2027-03-02')
      const c = await oneDay('C', '2027-03-15')
      const before = await read(c.id)
      const proposal = await propose([[move(a.id, '2027-03-08')], [assign(b.id, [bob.id])]])

      const result = await openAndApprove(alice, proposal.id)
      expect(result.outcome).toBe('applied')
      expect(result.proposal.status).toBe('approved')

      expect(await startOf(a.id)).toBe('2027-03-08')
      expect((await read(b.id)).assignees).toEqual([bob.id])
      // No other task changes.
      expect(await read(c.id)).toEqual(before)
    })

    it('TC-111: a plan change after the preview requires the reviewer to confirm again', async () => {
      // The service and REST part: a changed plan asks for a new confirmation. Pending: the
      // preview refreshed in the browser, showing C on 2027-03-16 (SC-072, F25).
      await grantRole(x.db, bob, apollo, 'read-write')
      const a = await oneDay('A', '2027-03-01')
      const c = await oneDay('C', '2027-03-15')
      const proposal = await propose([[move(a.id, '2027-03-08')]])

      // Step 1: alice opens the preview.
      const seen = await versionSeenBy(alice, proposal.id)
      // Step 2: bob moves C.
      await ok(bob, 'PATCH', `/tasks/${c.id}`, { plannedStart: '2027-03-16' })

      // Step 3: alice approves from the preview of step 1; the preview is refreshed, and
      // confirmation is asked again.
      const response = await approve(alice, proposal.id, apollo, seen)
      expect(response.statusCode).toBe(200)
      const asked = response.json<Approved>()
      expect(asked.outcome).toBe('confirm-again')
      expect(asked.preview?.planVersion).not.toBe(seen)
      expect(asked.preview?.differences.map((d) => d.taskId)).toEqual([a.id])
      expect(asked.proposal.status).toBe('waiting')
      expect(asked.proposal.approvals).toEqual([])
      expect((await read(c.id)).plannedStart).toBe('2027-03-16')

      // Step 4: nothing of the proposal was applied.
      expect(await startOf(a.id)).toBe('2027-03-01')

      // Step 5: alice confirms the refreshed preview.
      const confirmed = await approve(alice, proposal.id, apollo, asked.preview?.planVersion)
      expect(confirmed.json<Approved>().outcome).toBe('applied')
      expect(await startOf(a.id)).toBe('2027-03-08')
    })

    it('TC-098: dropping a group of proposed changes drops every change in it', async () => {
      // The approval with G1 dropped (service). Dropping G1 is in proposals.test.ts. Pending: doing
      // it in the browser (SC-071, SC-072; F24, F25).
      await grantRole(x.db, bob, apollo, 'read-only')
      const a = await oneDay('A', '2027-03-01')
      const b = await oneDay('B', '2027-03-02')
      const proposal = await propose([
        [move(a.id, '2027-03-08'), move(b.id, '2027-03-09')],
        [assign(a.id, [bob.id])],
      ])
      const g1 = proposal.groups[0]?.id ?? ''
      await services.proposalEdits.dropGroup(by(alice), proposal.id, g1)

      const seen = await services.proposalPreview.previewProposal(by(alice), proposal.id)
      const result = await services.proposalApproval.approve(by(alice), proposal.id, {
        projectId: apollo,
        planVersion: seen.planVersion,
      })
      expect(result.outcome).toBe('applied')

      const [readA, readB] = [await read(a.id), await read(b.id)]
      expect(readA.plannedStart).toBe('2027-03-01')
      expect(readB.plannedStart).toBe('2027-03-02')
      expect(readA.assignees).toEqual([bob.id])
    })

    it('TC-099: keeping a group of proposed changes keeps every change in it', async () => {
      // The approval with G1 kept (service). Pending: doing it in the browser (SC-072, F25).
      const a = await oneDay('A', '2027-03-01')
      const b = await oneDay('B', '2027-03-02')
      const proposal = await propose([[move(a.id, '2027-03-08'), move(b.id, '2027-03-09')]])

      const seen = await services.proposalPreview.previewProposal(by(alice), proposal.id)
      const result = await services.proposalApproval.approve(by(alice), proposal.id, {
        projectId: apollo,
        planVersion: seen.planVersion,
      })
      expect(result.outcome).toBe('applied')
      expect(await startOf(a.id)).toBe('2027-03-08')
      expect(await startOf(b.id)).toBe('2027-03-09')
    })

    it("TC-206: an approved proposal's changes are logged as the approver's", async () => {
      // The service part: the approver is logged. Pending: the proposal created through the MCP
      // server (SC-027, B19).
      await grantRole(x.db, bob, apollo, 'read-write')
      const a = await oneDay('A', '2027-03-01')
      const b = await oneDay('B', '2027-03-01')
      const proposal = await propose([[move(a.id, '2027-03-08'), move(b.id, '2027-03-08')]])

      // Step 1: bob approves the proposal.
      expect((await openAndApprove(bob, proposal.id)).outcome).toBe('applied')

      // Step 2: alice reads the audit log of Apollo.
      const log = await ok<AuditEntry[]>(alice, 'GET', `/audit-log?projectId=${apollo}`)
      const movesOf = (taskId: string) =>
        log.filter(
          (entry) =>
            entry.action === 'task.updated' &&
            entry.subject.id === taskId &&
            JSON.stringify(entry.details.changes).includes('plannedStart'),
        )
      for (const taskId of [a.id, b.id]) {
        const moves = movesOf(taskId)
        expect(moves).toHaveLength(1)
        expect(moves[0]?.by.username).toBe('bob')
        expect(moves[0]?.channels).toEqual(['mcp', 'ui'])
      }
    })

    it('TC-159: a read-write member approves an AI proposal', async () => {
      // The service part: bob approves. Pending: the proposal created through the MCP server
      // (SC-027, B19).
      await grantRole(x.db, bob, apollo, 'read-write')
      const t = await oneDay('T', '2027-03-01')
      const proposal = await propose([[move(t.id, '2027-03-08')]])

      // Step 1: bob opens the proposal and approves it.
      const result = await openAndApprove(bob, proposal.id)
      expect(result.outcome).toBe('applied')

      // Step 2: T starts 2027-03-08, and the proposal is no longer waiting for review.
      expect(await startOf(t.id)).toBe('2027-03-08')
      expect((await ok<Proposal>(alice, 'GET', `/proposals/${proposal.id}`)).status).toBe(
        'approved',
      )
    })

    it('TC-019: a move onto a weekend never reaches the plan through the MCP server', async () => {
      // The approval of a weekend move is rejected (service). Pending: the proposal created through
      // the MCP server (SC-027, B19).
      await grantRole(x.db, bob, apollo, 'read-write')
      const t = await task({ title: 'T', plannedStart: '2027-03-01', durationWorkingDays: 1 })

      // Step 1: bob proposes to move T onto Saturday 2027-03-06; the store takes it.
      const proposal = await propose([[move(t.id, '2027-03-06')]], bob)

      // Step 2: alice approves it, and the approval is refused.
      await refused(
        services.proposalApproval.approve(by(alice), proposal.id, { projectId: apollo }),
        'conflict',
      )

      // Step 3: T still starts on 2027-03-01, and was never stored on 2027-03-06.
      expect(await startOf(t.id)).toBe('2027-03-01')
      const entries = await x.db.select().from(auditLog).where(eq(auditLog.subjectId, t.id))
      expect(JSON.stringify(entries)).not.toContain('2027-03-06')
    })
  })

  describe('a proposal over several projects', () => {
    // Apollo created by alice, Borealis by bob. alice is read-write in Borealis, so that the store
    // takes her proposal; bob is read-only in Apollo, so that he may read it.
    let borealis: string
    let a: Task
    let b: Task
    let proposal: Proposal

    beforeEach(async () => {
      borealis = await seedProject(x.db, bob, 'Borealis')
      await grantRole(x.db, alice, borealis, 'read-write')
      await grantRole(x.db, bob, apollo, 'read-only')
      a = await oneDay('A', '2027-03-01')
      b = await oneDay('B', '2027-03-01', borealis, bob)
      proposal = await propose([[move(a.id, '2027-03-08')], [move(b.id, '2027-03-08')]])
    })

    it("lets a read-write member approve their project's part, and applies nothing yet", async () => {
      const result = await openAndApprove(bob, proposal.id, borealis)
      expect(result.outcome).toBe('waiting-for-parts')
      expect(result.proposal.status).toBe('waiting')
      expect(result.proposal.approvals).toEqual([
        expect.objectContaining({ projectId: borealis, approvedBy: bob.id, channel: 'ui' }),
      ])
      // The Apollo part is not approved by it, and neither move is applied.
      expect(result.proposal.approvals.map((approval) => approval.projectId)).not.toContain(apollo)
      expect(await startOf(a.id)).toBe('2027-03-01')
      expect(await startOf(b.id)).toBe('2027-03-01')
    })

    it("refuses a part's approval to someone without the read-write role in its project", async () => {
      const seen = await versionSeenBy(bob, proposal.id)
      const response = await approve(bob, proposal.id, apollo, seen)
      expect(response.statusCode).toBe(403)
      const stored = await ok<Proposal>(bob, 'GET', `/proposals/${proposal.id}`)
      expect(stored.approvals).toEqual([])
      expect(await startOf(a.id)).toBe('2027-03-01')
    })

    it("applies every change, each as its part's approver's, once every part is approved", async () => {
      expect((await openAndApprove(alice, proposal.id, apollo)).outcome).toBe('waiting-for-parts')
      expect(await startOf(a.id)).toBe('2027-03-01')
      expect(await startOf(b.id)).toBe('2027-03-01')
      expect(mirrored).toEqual([])

      const result = await openAndApprove(bob, proposal.id, borealis)
      expect(result.outcome).toBe('applied')
      expect(await startOf(a.id)).toBe('2027-03-08')
      expect(await startOf(b.id)).toBe('2027-03-08')

      const moved = await x.db.select().from(auditLog).where(eq(auditLog.action, 'task.updated'))
      const actorOf = (taskId: string) =>
        moved.filter((entry) => entry.subjectId === taskId).map((entry) => entry.actorAccountId)
      expect(actorOf(a.id)).toEqual([alice.id])
      expect(actorOf(b.id)).toEqual([bob.id])
    })

    it('counts a part approved before the proposal was edited no more', async () => {
      await openAndApprove(bob, proposal.id, borealis)
      now = at(1)
      const g1 = proposal.groups[0]?.id ?? ''
      await services.proposalEdits.editGroup(by(alice), proposal.id, g1, {
        changes: [move(a.id, '2027-03-09')],
      })
      const result = await openAndApprove(alice, proposal.id, apollo)
      expect(result.outcome).toBe('waiting-for-parts')
      expect(result.proposal.approvals.map((approval) => approval.projectId)).toEqual([apollo])
      expect(await startOf(b.id)).toBe('2027-03-01')
    })
  })

  describe('the rules', () => {
    it('gives the same plan version for the same plan, and another once it changed', async () => {
      const a = await oneDay('A', '2027-03-01')
      const c = await oneDay('C', '2027-03-15')
      const proposal = await propose([[move(a.id, '2027-03-08')]])
      const first = await versionSeenBy(alice, proposal.id)
      expect(await versionSeenBy(alice, proposal.id)).toBe(first)
      await ok(alice, 'PATCH', `/tasks/${c.id}`, { plannedStart: '2027-03-16' })
      expect(await versionSeenBy(alice, proposal.id)).not.toBe(first)
    })

    it('asks a reviewer who saw no preview to confirm, and records nothing', async () => {
      const a = await oneDay('A', '2027-03-01')
      const proposal = await propose([[move(a.id, '2027-03-08')]])
      const result = await services.proposalApproval.approve(by(alice), proposal.id, {
        projectId: apollo,
      })
      expect(result.outcome).toBe('confirm-again')
      expect(await x.db.select().from(proposalApprovals)).toEqual([])
      expect(await startOf(a.id)).toBe('2027-03-01')
    })

    it('keeps nothing, the approval included, if a change cannot be made on the plan it saw', async () => {
      // The removal of a member changes no task, so the plan version stays; the change that
      // assigns dave can no longer be made.
      const dave = await seedAccount(x.db, { username: 'dave' })
      await grantRole(x.db, dave, apollo, 'read-only')
      const a = await oneDay('A', '2027-03-01')
      const b = await oneDay('B', '2027-03-02')
      const proposal = await propose([[move(a.id, '2027-03-08')], [assign(b.id, [dave.id])]])
      const seen = await versionSeenBy(alice, proposal.id)
      expect(
        (await call(alice, 'DELETE', `/projects/${apollo}/members/${dave.id}`)).statusCode,
      ).toBe(204)
      const entries = (await x.db.select().from(auditLog)).length
      const current = await services.proposals.getProposal(by(alice), proposal.id)
      const assignments = new TaskAssignments(services.projectRoles)
      expect(await planVersion(x.db, assignments, current)).toBe(seen)

      const response = await approve(alice, proposal.id, apollo, seen)
      expect(response.statusCode).toBe(409)
      expect(await startOf(a.id)).toBe('2027-03-01')
      expect(await x.db.select().from(proposalApprovals)).toEqual([])
      expect((await x.db.select().from(auditLog)).length).toBe(entries)
      expect(mirrored).toEqual([])
    })

    it('tells the GitHub planning mirror of the changed tasks once they are applied', async () => {
      await grantRole(x.db, bob, apollo, 'read-only')
      const b = await oneDay('B', '2027-03-02')
      const proposal = await propose([[assign(b.id, [bob.id])]])
      await openAndApprove(alice, proposal.id)
      expect(mirrored.flat()).toEqual([b.id])
    })

    it('records the approval and the application in the audit log', async () => {
      const a = await oneDay('A', '2027-03-01')
      const proposal = await propose([[move(a.id, '2027-03-08')]])
      await openAndApprove(alice, proposal.id)
      const entries = await x.db.select().from(auditLog).where(eq(auditLog.subjectId, proposal.id))
      expect(entries.map((entry) => [entry.action, entry.projectId, entry.channels])).toEqual([
        ['proposal.created', apollo, ['mcp']],
        ['proposal.part-approved', apollo, ['ui']],
        ['proposal.applied', apollo, ['ui']],
      ])
    })

    it('can no longer approve, edit or reject an approved proposal', async () => {
      const a = await oneDay('A', '2027-03-01')
      const proposal = await propose([[move(a.id, '2027-03-08')]])
      await openAndApprove(alice, proposal.id)
      const before = await x.db.select().from(tasks)
      await refused(
        services.proposalApproval.approve(by(alice), proposal.id, { projectId: apollo }),
        'conflict',
      )
      await refused(services.proposalEdits.rejectProposal(by(alice), proposal.id), 'conflict')
      await refused(
        services.proposalEdits.editGroup(by(alice), proposal.id, proposal.groups[0]?.id ?? '', {
          changes: [move(a.id, '2027-03-09')],
        }),
        'conflict',
      )
      expect(await x.db.select().from(tasks)).toEqual(before)
    })

    it('cannot approve a rejected proposal', async () => {
      const a = await oneDay('A', '2027-03-01')
      const proposal = await propose([[move(a.id, '2027-03-08')]])
      const seen = await versionSeenBy(alice, proposal.id)
      await services.proposalEdits.rejectProposal(by(alice), proposal.id)
      const response = await approve(alice, proposal.id, apollo, seen)
      expect(response.statusCode).toBe(409)
      expect(await startOf(a.id)).toBe('2027-03-01')
    })

    it('refuses an approval without a project the proposal changes', async () => {
      const borealis = await seedProject(x.db, alice, 'Borealis')
      const a = await oneDay('A', '2027-03-01')
      const proposal = await propose([[move(a.id, '2027-03-08')]])
      await refused(services.proposalApproval.approve(by(alice), proposal.id, {}), 'invalid')
      await refused(
        services.proposalApproval.approve(by(alice), proposal.id, { projectId: borealis }),
        'invalid',
      )
      await refused(
        services.proposalApproval.approve(by(alice), proposal.id, {
          projectId: apollo,
          planVersion: 7,
        }),
        'invalid',
      )
      expect(await x.db.select().from(proposalApprovals)).toEqual([])
    })

    it('hides a proposal from someone with no role in a project it changes', async () => {
      const a = await oneDay('A', '2027-03-01')
      const proposal = await propose([[move(a.id, '2027-03-08')]])
      const response = await approve(bob, proposal.id, apollo)
      expect(response.statusCode).toBe(403)
      const unknown = await approve(alice, '6f1c2a5e-0000-4000-8000-0000000000e9', apollo)
      expect(unknown.statusCode).toBe(404)
    })

    it('lets only one of two approvals at once apply the proposal', async () => {
      await grantRole(x.db, bob, apollo, 'read-write')
      const a = await task({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 1 })
      const proposal = await propose([
        [{ kind: 'update-task', task: { taskId: a.id }, fields: { durationWorkingDays: 2 } }],
      ])
      const seen = await versionSeenBy(alice, proposal.id)
      const results = await Promise.all([
        approve(alice, proposal.id, apollo, seen),
        approve(bob, proposal.id, apollo, seen),
      ])
      expect(results.map((r) => r.statusCode).sort((p, q) => p - q)).toEqual([200, 409])
      expect((await read(a.id)).durationWorkingDays).toBe(2)
      const updates = await x.db.select().from(auditLog).where(eq(auditLog.action, 'task.updated'))
      expect(updates.filter((entry) => entry.subjectId === a.id)).toHaveLength(1)
    })
  })
})
