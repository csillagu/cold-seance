import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { auditLog, proposalChanges, proposalGroups } from '../../src/db/schema.ts'
import type { Caller, Channel } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import type { Proposal } from '../../src/service/proposals.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { Task, TaskInput } from '../../src/service/tasks.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// Editing a proposal one group at a time and rejecting it (SC-045: FR-074, FR-075), and the
// expiry rule (SC-046: FR-081), against a real PostgreSQL, each test in a fresh test deployment
// whose clock the test sets: a fresh database, first system admin `root`, and a global calendar
// with Saturday and Sunday as the weekend and no company holidays. First the test cases, then the
// rules through the service layer.

type Account = Awaited<ReturnType<typeof seedAccount>>
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

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

/** The changes of each group of the proposal as they were given. */
const given = (proposal: Proposal) =>
  proposal.groups.map((group) =>
    group.changes.map(({ id: _id, projectId, ...change }) =>
      change.kind === 'create-task' ? { ...change, projectId } : change,
    ),
  )

const move = (taskId: string, plannedStart: string) => ({
  kind: 'update-task',
  task: { taskId },
  fields: { plannedStart },
})

describe('proposal edits, rejection and expiry', () => {
  let x: TestDatabase
  let services: Services
  let app: ReturnType<typeof buildApp>
  let now: Date
  let alice: Account
  let bob: Account
  let apollo: string

  beforeEach(async () => {
    x = await createTestDatabase()
    now = T0
    services = createServices(x.db, { now: () => now })
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

  const task = async (fields: TaskInput) =>
    ok<Task>(alice, 'POST', `/projects/${apollo}/tasks`, fields)

  /** Task A in Apollo, 2027-03-01, 1 working day, as the test cases give it. */
  const taskA = () => task({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 1 })

  /** A proposal made at the current time, as through the MCP server with alice's token. */
  const propose = (groups: object[][]) =>
    services.proposals.createProposal(by(alice, 'mcp'), {
      groups: groups.map((changes) => ({ changes })),
    })

  const startOf = async (taskId: string) =>
    (await ok<Task>(alice, 'GET', `/tasks/${taskId}`)).plannedStart

  describe('the test cases', () => {
    it('TC-104: a read-write reviewer edits a proposal in the browser', async () => {
      // The service and REST part: bob's edit, through the route the browser calls, saved
      // without approval. Pending: making the edit in the browser (SC-071, F24).
      await grantRole(x.db, bob, apollo, 'read-write')
      const a = await taskA()
      const created = await propose([[move(a.id, '2027-03-08')]])
      const [group] = created.groups

      const edited = await call(bob, 'PUT', `/proposals/${created.id}/groups/${group?.id}`, {
        changes: [move(a.id, '2027-03-10')],
      })
      expect(edited.statusCode).toBe(200)

      const read = await ok<Proposal>(bob, 'GET', `/proposals/${created.id}`)
      expect(given(read)).toEqual([[move(a.id, '2027-03-10')]])
      expect(read.status).toBe('waiting')
      expect(await startOf(a.id)).toBe('2027-03-01')
    })

    it('TC-105: a read-write reviewer rejects a proposal', async () => {
      // The service and REST part: the rejection, through the route the browser calls. Pending:
      // rejecting it in the browser (SC-072, F25), and that approving it is refused (SC-048, B14).
      await grantRole(x.db, bob, apollo, 'read-write')
      const a = await taskA()
      const created = await propose([[move(a.id, '2027-03-08')]])

      const rejected = await call(bob, 'POST', `/proposals/${created.id}/rejection`)
      expect(rejected.statusCode).toBe(200)

      const read = await ok<Proposal>(bob, 'GET', `/proposals/${created.id}`)
      expect(read.status).toBe('rejected')
      expect(read.rejectedBy).toBe(bob.id)
      expect(await startOf(a.id)).toBe('2027-03-01')
      // No longer waiting for review: it cannot be edited or rejected again.
      expect((await call(bob, 'POST', `/proposals/${created.id}/rejection`)).statusCode).toBe(409)
      const [group] = created.groups
      const edit = await call(bob, 'PUT', `/proposals/${created.id}/groups/${group?.id}`, {
        changes: [move(a.id, '2027-03-09')],
      })
      expect(edit.statusCode).toBe(409)
    })

    it('TC-115: a proposal untouched for 24 hours expires', async () => {
      // The service part: the proposal reads as expired. That alice's approval is rejected is in
      // proposal-approval.test.ts.
      const a = await taskA()
      const created = await propose([[move(a.id, '2027-03-08')]])
      expect(created.status).toBe('waiting')

      now = at(24, 60 * 1000)

      const read = await ok<Proposal>(alice, 'GET', `/proposals/${created.id}`)
      expect(read.status).toBe('expired')
      expect((await ok<Proposal[]>(alice, 'GET', `/projects/${apollo}/proposals`))[0]?.status).toBe(
        'expired',
      )
      expect(await startOf(a.id)).toBe('2027-03-01')
    })

    it('TC-116: an edit within 24 hours keeps a proposal from expiring', async () => {
      // The service part: an edit at t0 + 23 hours keeps the proposal alive at t0 + 25 hours.
      // Pending: making the edit in the browser (SC-071, F24), and approving it there (SC-072,
      // F25).
      const a = await taskA()
      const created = await propose([[move(a.id, '2027-03-08')]])
      const [group] = created.groups

      now = at(23)
      await ok(alice, 'PUT', `/proposals/${created.id}/groups/${group?.id}`, {
        changes: [move(a.id, '2027-03-09')],
      })
      now = at(25)

      const read = await ok<Proposal>(alice, 'GET', `/proposals/${created.id}`)
      expect(read.status).toBe('waiting')
      expect(new Date(read.lastEditedAt)).toEqual(at(23))
      expect(given(read)).toEqual([[move(a.id, '2027-03-09')]])
    })
  })

  describe('the rules', () => {
    it('expires a proposal only once its last edit is more than 24 hours old', async () => {
      const a = await taskA()
      const created = await propose([[move(a.id, '2027-03-08')]])
      now = at(24)
      expect((await services.proposals.getProposal(by(alice), created.id)).status).toBe('waiting')
      now = at(24, 1)
      expect((await services.proposals.getProposal(by(alice), created.id)).status).toBe('expired')
    })

    it('refuses to edit, drop a group of or reject an expired proposal', async () => {
      const a = await taskA()
      const created = await propose([[move(a.id, '2027-03-08')], [move(a.id, '2027-03-09')]])
      const [g1, g2] = created.groups
      now = at(25)
      const caller = by(alice)
      const edits = services.proposalEdits
      await refused(
        edits.editGroup(caller, created.id, g1?.id ?? '', { changes: [move(a.id, '2027-03-10')] }),
        'conflict',
      )
      await refused(edits.dropGroup(caller, created.id, g2?.id ?? ''), 'conflict')
      const error = await refused(edits.rejectProposal(caller, created.id), 'conflict')
      expect(error.message).toContain('expired')
      const read = await services.proposals.getProposal(caller, created.id)
      expect(read.status).toBe('expired')
      expect(given(read)).toEqual([[move(a.id, '2027-03-08')], [move(a.id, '2027-03-09')]])
    })

    it('lets only read-write members and admins edit or reject', async () => {
      const carol = await seedAccount(x.db, { username: 'carol' })
      const dave = await seedAccount(x.db, { username: 'dave' })
      await grantRole(x.db, bob, apollo, 'read-only')
      await grantRole(x.db, carol, apollo, 'contributor')
      const a = await taskA()
      const created = await propose([[move(a.id, '2027-03-08')], [move(a.id, '2027-03-09')]])
      const [g1, g2] = created.groups
      const edits = services.proposalEdits

      for (const who of [bob, carol]) {
        const changes = [move(a.id, '2027-03-10')]
        await refused(edits.editGroup(by(who), created.id, g1?.id ?? '', { changes }), 'forbidden')
        await refused(edits.dropGroup(by(who), created.id, g2?.id ?? ''), 'forbidden')
        await refused(edits.rejectProposal(by(who), created.id), 'forbidden')
      }
      await refused(edits.rejectProposal(by(dave), created.id), 'not-visible')
      const read = await services.proposals.getProposal(by(alice), created.id)
      expect(read.status).toBe('waiting')
      expect(read.lastEditedAt).toEqual(T0)
      expect(given(read)).toEqual(given(created))
    })

    it('drops a group as one, keeping the others, and never the last group', async () => {
      const b = await task({ title: 'B', plannedStart: '2027-03-02', durationWorkingDays: 1 })
      const a = await taskA()
      const created = await propose([
        [move(a.id, '2027-03-08'), move(b.id, '2027-03-09')],
        [{ kind: 'update-task', task: { taskId: a.id }, fields: { assignees: [alice.id] } }],
      ])
      const [g1, g2] = created.groups
      now = at(1)

      const dropped = await call(alice, 'DELETE', `/proposals/${created.id}/groups/${g1?.id}`)
      expect(dropped.statusCode).toBe(200)
      const read = dropped.json<Proposal>()
      expect(read.groups.map((group) => group.id)).toEqual([g2?.id])
      expect(new Date(read.lastEditedAt)).toEqual(at(1))
      const rows = await x.db.select().from(proposalChanges)
      expect(rows).toHaveLength(1)

      const last = await call(alice, 'DELETE', `/proposals/${created.id}/groups/${g2?.id}`)
      expect(last.statusCode).toBe(400)
      expect(await x.db.select().from(proposalGroups)).toHaveLength(1)
      expect(await startOf(a.id)).toBe('2027-03-01')
      expect(await startOf(b.id)).toBe('2027-03-02')
    })

    it('checks an edited group as a new proposal is checked', async () => {
      const a = await taskA()
      const created = await propose([
        [{ kind: 'create-task', key: 'N', projectId: apollo, fields: { title: 'N' } }],
        [move(a.id, '2027-03-08')],
      ])
      const [, g2] = created.groups
      const edit = (changes: unknown) =>
        services.proposalEdits.editGroup(by(alice), created.id, g2?.id ?? '', { changes })

      await refused(edit([]), 'invalid')
      await refused(edit([{ kind: 'delete-task', task: { taskId: a.id } }]), 'invalid')
      await refused(
        edit([{ kind: 'add-blocker', task: { newTask: 'N' }, blocker: { taskId: a.id } }]),
        'invalid',
      )
      const clash = await refused(
        edit([{ kind: 'create-task', key: 'N', projectId: apollo, fields: { title: 'M' } }]),
        'invalid',
      )
      expect(clash.message).toContain('N')
      await refused(edit([move('6f1c2a5e-0000-4000-8000-0000000000b9', '2027-03-08')]), 'not-found')
      expect(given(await services.proposals.getProposal(by(alice), created.id))[1]).toEqual([
        move(a.id, '2027-03-08'),
      ])
    })

    it('refuses a group the proposal does not have', async () => {
      const a = await taskA()
      const one = await propose([[move(a.id, '2027-03-08')]])
      const other = await propose([[move(a.id, '2027-03-09')]])
      const changes = [move(a.id, '2027-03-10')]
      const otherGroup = other.groups[0]?.id ?? ''
      await refused(
        services.proposalEdits.editGroup(by(alice), one.id, otherGroup, { changes }),
        'not-found',
      )
      await refused(services.proposalEdits.dropGroup(by(alice), one.id, 'nope'), 'not-found')
      const error = await refused(
        services.proposalEdits.rejectProposal(by(alice), 'nope'),
        'not-found',
      )
      expect(error.message).toBe('There is no such proposal')
    })

    it('updates the projects a proposal changes, with a role needed in each', async () => {
      const zeus = await seedProject(x.db, bob, 'Zeus')
      const a = await taskA()
      const z = await ok<Task>(bob, 'POST', `/projects/${zeus}/tasks`, {
        title: 'Z',
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      const created = await propose([[move(a.id, '2027-03-08')]])
      const [group] = created.groups
      const changes = [move(a.id, '2027-03-08'), move(z.id, '2027-03-09')]

      // Alice has no role in Zeus: the edit is refused, and nothing changes.
      await refused(
        services.proposalEdits.editGroup(by(alice), created.id, group?.id ?? '', { changes }),
        'not-visible',
      )
      await grantRole(x.db, alice, zeus, 'read-write')
      const edited = await services.proposalEdits.editGroup(
        by(alice),
        created.id,
        group?.id ?? '',
        {
          changes,
        },
      )
      expect(edited.projectIds).toEqual([apollo, zeus].sort())
      expect((await services.proposals.listProposals(by(alice), zeus)).map((p) => p.id)).toEqual([
        created.id,
      ])
    })

    it('records each edit and the rejection in the audit log', async () => {
      const a = await taskA()
      const created = await propose([[move(a.id, '2027-03-08')], [move(a.id, '2027-03-09')]])
      const [g1, g2] = created.groups
      const edits = services.proposalEdits
      await edits.editGroup(by(alice), created.id, g1?.id ?? '', {
        changes: [move(a.id, '2027-03-10')],
      })
      await edits.dropGroup(by(alice, 'rest-api'), created.id, g2?.id ?? '')
      await edits.rejectProposal(by(alice), created.id)

      const entries = await x.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.subjectId, created.id))
        .orderBy(auditLog.id)
      expect(entries.map((entry) => [entry.action, entry.channels, entry.projectId])).toEqual([
        ['proposal.created', ['mcp'], apollo],
        ['proposal.edited', ['ui'], apollo],
        ['proposal.group-dropped', ['rest-api'], apollo],
        ['proposal.rejected', ['ui'], apollo],
      ])
    })
  })
})
