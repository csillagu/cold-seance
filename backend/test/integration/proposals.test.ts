import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import {
  auditLog,
  proposalChanges,
  proposalGroups,
  proposals,
  projectMembers,
  tasks,
} from '../../src/db/schema.ts'
import type { Caller, Channel } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import type { Proposal, ProposedChange } from '../../src/service/proposals.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { Task, TaskInput } from '../../src/service/tasks.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, insertProject, seedProject } from '../helpers/projects.ts'

// The proposal store (SC-010: FR-069, FR-070, FR-154, FR-203 to FR-207) against a real
// PostgreSQL, each test in a fresh test deployment: a fresh database, first system admin `root`,
// and a global calendar with Saturday and Sunday as the weekend and no company holidays. First the
// test cases, then the rules through the service layer.

type Account = Awaited<ReturnType<typeof seedAccount>>
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

const by = (account: Account, channel: Channel = 'rest-api'): Caller => ({
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

/** A proposal's changes as they were given, without the ids and projects the store adds. */
const given = (proposal: Proposal): ProposedChange[][] =>
  proposal.groups.map((group) =>
    group.changes.map(({ id: _id, projectId, ...change }) =>
      change.kind === 'create-task' ? { ...change, projectId } : change,
    ),
  )

describe('the proposal store', () => {
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

  const call = (
    who: Account,
    method: Method,
    url: string,
    payload?: object,
    channel: Channel = 'rest-api',
  ) =>
    app.inject({
      method,
      url: `/api${url}`,
      headers: as(who, channel),
      ...(payload === undefined ? {} : { payload }),
    })

  const ok = async <T>(who: Account, method: Method, url: string, payload?: object) => {
    const response = await call(who, method, url, payload)
    if (response.statusCode >= 300) throw new Error(`${method} ${url}: ${response.body}`)
    return response.json<T>()
  }

  const task = async (projectId: string, fields: TaskInput) =>
    ok<Task>(alice, 'POST', `/projects/${projectId}/tasks`, fields)

  const propose = (who: Account, groups: object[], channel: Channel = 'rest-api') =>
    call(who, 'POST', '/proposals', { groups }, channel)

  const list = (who: Account, projectId: string) =>
    ok<Proposal[]>(who, 'GET', `/projects/${projectId}/proposals`)

  const stored = async () => (await x.db.select({ id: proposals.id }).from(proposals)).length

  const move = (taskId: string, plannedStart: string) => ({
    kind: 'update-task',
    task: { taskId },
    fields: { plannedStart },
  })

  describe('the test cases', () => {
    it('TC-097: a proposal is recorded as its set of changes to the plan', async () => {
      await grantRole(x.db, bob, apollo, 'read-only')
      const a = await task(apollo, {
        title: 'A',
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      const b = await task(apollo, {
        title: 'B',
        plannedStart: '2027-03-08',
        durationWorkingDays: 1,
      })
      const before = await x.db.select().from(tasks)
      // Created through the service layer with the channel the MCP server will give it; the MCP
      // server itself comes with SC-027 (B19).
      const changes = [
        {
          kind: 'create-task',
          key: 'C',
          projectId: apollo,
          fields: { title: 'C' },
        },
        move(a.id, '2027-03-02'),
        { kind: 'update-task', task: { taskId: b.id }, fields: { assignees: [bob.id] } },
        { kind: 'add-blocker', task: { taskId: b.id }, blocker: { taskId: a.id } },
      ]
      const created = await services.proposals.createProposal(by(alice, 'mcp'), {
        groups: [{ changes }],
      })

      const read = await ok<Proposal>(alice, 'GET', `/proposals/${created.id}`)
      expect(given(read)).toEqual([changes])
      // It holds no copy of tasks or fields it does not change: only the inputs given.
      const rows = await x.db.select({ change: proposalChanges.change }).from(proposalChanges)
      expect(rows.map((row) => row.change)).toEqual(changes)
      // And creating it changed nothing in the plan (FR-071).
      expect(await x.db.select().from(tasks)).toEqual(before)
    })

    it('TC-098: dropping a group of proposed changes drops every change in it', async () => {
      // The service and REST part: the groups are stored as given, and G1 is dropped as one,
      // through the route the browser calls; the service has no way to drop one change on its
      // own (SC-045). Pending: doing it in the browser (SC-071, F24), and that the approval
      // applies only G2 (SC-048, B14).
      await grantRole(x.db, bob, apollo, 'read-only')
      const a = await task(apollo, {
        title: 'A',
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      const b = await task(apollo, {
        title: 'B',
        plannedStart: '2027-03-02',
        durationWorkingDays: 1,
      })
      const g1 = [move(a.id, '2027-03-08'), move(b.id, '2027-03-09')]
      const g2 = [{ kind: 'update-task', task: { taskId: a.id }, fields: { assignees: [bob.id] } }]
      const created = await services.proposals.createProposal(by(alice, 'mcp'), {
        groups: [{ changes: g1 }, { changes: g2 }],
      })

      const read = await ok<Proposal>(alice, 'GET', `/proposals/${created.id}`)
      expect(given(read)).toEqual([g1, g2])
      expect(new Set(read.groups.map((group) => group.id)).size).toBe(2)
      const groups = await x.db.select().from(proposalGroups)
      expect(groups).toHaveLength(2)

      const g1Id = read.groups[0]?.id
      const dropped = await call(alice, 'DELETE', `/proposals/${created.id}/groups/${g1Id}`)
      expect(dropped.statusCode).toBe(200)
      expect(given(dropped.json<Proposal>())).toEqual([g2])
      expect(await x.db.select().from(proposalChanges)).toHaveLength(1)
      expect((await ok<Task>(alice, 'GET', `/tasks/${a.id}`)).plannedStart).toBe('2027-03-01')
      expect((await ok<Task>(alice, 'GET', `/tasks/${b.id}`)).plannedStart).toBe('2027-03-02')
    })

    it('TC-099: keeping a group of proposed changes keeps every change in it', async () => {
      // The part B10 holds: the two moves are stored as one group. Pending: approving it with G1
      // kept moves both (SC-048, B14).
      const a = await task(apollo, {
        title: 'A',
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      const b = await task(apollo, {
        title: 'B',
        plannedStart: '2027-03-02',
        durationWorkingDays: 1,
      })
      const g1 = [move(a.id, '2027-03-08'), move(b.id, '2027-03-09')]
      const created = await services.proposals.createProposal(by(alice, 'mcp'), {
        groups: [{ changes: g1 }],
      })

      const read = await ok<Proposal>(alice, 'GET', `/proposals/${created.id}`)
      expect(read.groups).toHaveLength(1)
      expect(given(read)).toEqual([g1])
    })

    it('TC-226: a proposal holds the changed input and no derived dates', async () => {
      // Step 1, through the REST API. The preview showing B on 2027-03-08 to 2027-03-09 is in
      // proposal-preview.test.ts, and opening it in the browser in e2e/tests/proposal-preview.spec.ts.
      const a = await task(apollo, {
        title: 'A',
        plannedStart: '2027-03-01',
        durationWorkingDays: 3,
      })
      const b = await task(apollo, { title: 'B', durationWorkingDays: 2 })
      await ok(alice, 'POST', `/tasks/${b.id}/blocked-by`, { blockerId: a.id })
      expect((await ok<Task>(alice, 'GET', `/tasks/${b.id}`)).plannedStart).toBe('2027-03-04')
      const change = {
        kind: 'update-task',
        task: { taskId: a.id },
        fields: { durationWorkingDays: 5 },
      }
      const created = await services.proposals.createProposal(by(alice, 'mcp'), {
        groups: [{ changes: [change] }],
      })

      const read = await ok<Proposal>(alice, 'GET', `/proposals/${created.id}`)
      expect(given(read)).toEqual([[change]])
      const held = JSON.stringify(read)
      expect(held).not.toContain('plannedFinish')
      expect(held).not.toContain(b.id)
      expect(held).not.toContain('2027-03')
    })

    it("TC-239: an approved proposal's change is logged with both the MCP and the UI channel", async () => {
      // The part B10 holds: the channel the proposal was made through is kept with it. Pending:
      // approving it in the browser logs the move with both the MCP server and the UI (SC-048,
      // B14).
      const a = await task(apollo, {
        title: 'A',
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      const created = await services.proposals.createProposal(by(alice, 'mcp'), {
        groups: [{ changes: [move(a.id, '2027-03-08')] }],
      })

      expect(created.channel).toBe('mcp')
      expect((await ok<Proposal>(alice, 'GET', `/proposals/${created.id}`)).channel).toBe('mcp')
      const [entry] = await x.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'proposal.created'))
      expect(entry?.channels).toEqual(['mcp'])
    })

    it('TC-279: only read-write members and admins can create a proposal', async () => {
      const carol = await seedAccount(x.db, { username: 'carol' })
      const dave = await seedAccount(x.db, { username: 'dave' })
      await grantRole(x.db, bob, apollo, 'read-only')
      await grantRole(x.db, carol, apollo, 'contributor')
      await grantRole(x.db, dave, apollo, 'read-write')
      const zeus = await seedProject(x.db, dave, 'Zeus')
      const a = await task(apollo, {
        title: 'A',
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      const z = await ok<Task>(dave, 'POST', `/projects/${zeus}/tasks`, {
        title: 'Z',
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      const p1 = [{ changes: [move(a.id, '2027-03-08')] }]
      const p2 = [{ changes: [move(a.id, '2027-03-08'), move(z.id, '2027-03-09')] }]

      for (const who of [bob, carol]) {
        const response = await propose(who, p1)
        expect(response.statusCode).toBe(403)
        expect(response.json<{ message: string }>().message).toContain(
          'read-write members and admins',
        )
      }
      expect((await propose(dave, p1)).statusCode).toBe(201)
      expect((await propose(alice, p1)).statusCode).toBe(201)
      expect((await propose(alice, p2)).statusCode).toBe(403)

      const listed = await list(alice, apollo)
      expect(listed.map((proposal) => proposal.createdBy)).toEqual([dave.id, alice.id])
      for (const proposal of listed) expect(given(proposal)).toEqual([p1[0]?.changes])
      expect(await list(dave, zeus)).toEqual([])
      expect(await stored()).toBe(2)
      expect((await ok<Task>(alice, 'GET', `/tasks/${a.id}`)).plannedStart).toBe('2027-03-01')
      expect((await ok<Task>(dave, 'GET', `/tasks/${z.id}`)).plannedStart).toBe('2027-03-01')
    })

    it('TC-280: a proposal is created through the REST API and through the MCP server', async () => {
      // Steps 1 and 3 for what step 1 made. Pending: step 2, creating it through the MCP server
      // (SC-027, B19).
      const a = await task(apollo, {
        title: 'A',
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      const groups = [{ changes: [move(a.id, '2027-03-08')] }]

      expect((await propose(alice, groups, 'rest-api')).statusCode).toBe(201)

      const listed = await list(alice, apollo)
      expect(listed.map((proposal) => proposal.channel)).toEqual(['rest-api'])
      expect(listed.map(given)).toEqual([[groups[0]?.changes]])
      expect((await ok<Task>(alice, 'GET', `/tasks/${a.id}`)).plannedStart).toBe('2027-03-01')
    })

    it('TC-282: a proposal made through the UI is refused', async () => {
      const a = await task(apollo, {
        title: 'A',
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })
      const response = await propose(alice, [{ changes: [move(a.id, '2027-03-08')] }], 'ui')
      expect(response.statusCode).toBe(403)
      expect(response.json<{ message: string }>().message).toContain(
        'through the REST API or the MCP server',
      )

      expect(await list(alice, apollo)).toEqual([])
      expect((await ok<Task>(alice, 'GET', `/tasks/${a.id}`)).plannedStart).toBe('2027-03-01')
      const logged = await x.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'proposal.created'))
      expect(logged).toEqual([])
    })

    it("TC-281: a proposal holds any change to a project's tasks", async () => {
      const [a, b, c, d] = await Promise.all(
        ['A', 'B', 'C', 'D'].map((title) => task(apollo, { title, durationWorkingDays: 1 })),
      )
      if (!a || !b || !c || !d) throw new Error('the tasks were not created')
      const before = await x.db.select().from(tasks)
      const changes = [
        { kind: 'update-task', task: { taskId: a.id }, fields: { title: 'A2' } },
        { kind: 'update-task', task: { taskId: a.id }, fields: { description: 'Now A2' } },
        { kind: 'set-status', task: { taskId: b.id }, status: 'in-progress' },
        { kind: 'cancel-task', task: { taskId: c.id } },
        { kind: 'set-parent', task: { taskId: d.id }, parent: { taskId: a.id } },
      ]
      const created = await propose(alice, [{ changes }])
      expect(created.statusCode).toBe(201)

      const read = await ok<Proposal>(alice, 'GET', `/proposals/${created.json<Proposal>().id}`)
      expect(given(read)).toEqual([changes])
      expect(await x.db.select().from(tasks)).toEqual(before)
    })

    it("TC-283: a proposal changing a project's members is refused", async () => {
      await grantRole(x.db, bob, apollo, 'read-only')
      const membership = {
        kind: 'set-role',
        projectId: apollo,
        accountId: bob.id,
        role: 'read-write',
      }
      const response = await propose(alice, [{ changes: [membership] }])
      expect(response.statusCode).toBe(400)
      expect(response.json<{ message: string }>().message).toContain(
        "A change's kind must be one of",
      )

      expect(await list(alice, apollo)).toEqual([])
      const [role] = await x.db
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(eq(projectMembers.accountId, bob.id))
      expect(role?.role).toBe('read-only')
    })
  })

  describe('the rules', () => {
    it('creates a task and changes it in the same group, naming it by its key', async () => {
      const a = await task(apollo, { title: 'A', durationWorkingDays: 1 })
      const changes = [
        { kind: 'create-task', key: 'new', projectId: apollo, fields: { title: 'New' } },
        { kind: 'add-blocker', task: { newTask: 'new' }, blocker: { taskId: a.id } },
        { kind: 'set-status', task: { newTask: 'new' }, status: 'in-progress' },
      ]
      const created = await services.proposals.createProposal(by(alice), {
        groups: [{ changes }],
      })
      expect(given(created)).toEqual([changes])
      expect(created.groups[0]?.changes.map((change) => change.projectId)).toEqual([
        apollo,
        apollo,
        apollo,
      ])
      const rows = await x.db
        .select({ taskId: proposalChanges.taskId, key: proposalChanges.newTaskKey })
        .from(proposalChanges)
      expect(rows).toEqual(
        expect.arrayContaining([
          { taskId: null, key: 'new' },
          { taskId: null, key: 'new' },
          { taskId: null, key: 'new' },
        ]),
      )
    })

    it('refuses a new task named outside the group that creates it, or keyed twice', async () => {
      const create = { kind: 'create-task', key: 'n', projectId: apollo, fields: { title: 'N' } }
      const cancel = { kind: 'cancel-task', task: { newTask: 'n' } }
      await refused(
        services.proposals.createProposal(by(alice), {
          groups: [{ changes: [create] }, { changes: [cancel] }],
        }),
        'invalid',
      )
      await refused(
        services.proposals.createProposal(by(alice), {
          groups: [{ changes: [create] }, { changes: [create] }],
        }),
        'invalid',
      )
      expect(await stored()).toBe(0)
    })

    it.each([
      ['no groups', []],
      ['an empty group', [{ changes: [] }]],
      ['an unknown kind', [{ changes: [{ kind: 'delete-task', task: { taskId: apollo } }] }]],
      [
        'a derived date',
        [
          {
            changes: [
              {
                kind: 'update-task',
                task: { taskId: apollo },
                fields: { floatingDate: '2027-03-01' },
              },
            ],
          },
        ],
      ],
      [
        'a new task without a title',
        [{ changes: [{ kind: 'create-task', key: 'x', projectId: apollo, fields: {} }] }],
      ],
      [
        'an update of no field',
        [{ changes: [{ kind: 'update-task', task: { taskId: apollo }, fields: {} }] }],
      ],
      [
        'a status of cancelled',
        [{ changes: [{ kind: 'set-status', task: { taskId: apollo }, status: 'cancelled' }] }],
      ],
      [
        'a task named both ways',
        [{ changes: [{ kind: 'cancel-task', task: { taskId: apollo, newTask: 'x' } }] }],
      ],
    ])('refuses a proposal with %s as invalid', async (_what, groups) => {
      await refused(services.proposals.createProposal(by(alice), { groups }), 'invalid')
      expect(await stored()).toBe(0)
    })

    it('refuses a task that does not exist, and a project not visible to the caller', async () => {
      const missing = '6f1c2a5e-0000-4000-8000-000000000999'
      await refused(
        services.proposals.createProposal(by(alice), {
          groups: [{ changes: [move(missing, '2027-03-08')] }],
        }),
        'not-found',
      )
      const hidden = await insertProject(x.db, bob, 'Hidden')
      await refused(
        services.proposals.createProposal(by(alice), {
          groups: [
            {
              changes: [
                { kind: 'create-task', key: 'h', projectId: hidden, fields: { title: 'H' } },
              ],
            },
          ],
        }),
        'not-visible',
      )
      expect(await stored()).toBe(0)
    })

    it('needs only read access to a task it names but does not change', async () => {
      const zeus = await seedProject(x.db, bob, 'Zeus')
      const milestone = await ok<Task>(bob, 'POST', `/projects/${zeus}/tasks`, {
        title: 'M',
        milestone: { variant: 'floating' },
      })
      const a = await task(apollo, { title: 'A', durationWorkingDays: 1 })
      const groups = [
        {
          changes: [
            { kind: 'add-blocker', task: { taskId: a.id }, blocker: { taskId: milestone.id } },
          ],
        },
      ]
      await refused(services.proposals.createProposal(by(alice), { groups }), 'not-visible')
      await grantRole(x.db, alice, zeus, 'read-only')
      const created = await services.proposals.createProposal(by(alice), { groups })
      expect(created.projectIds).toEqual([apollo])
    })

    it('records the creation in the audit log of each project it changes', async () => {
      const zeus = await seedProject(x.db, alice, 'Zeus')
      const a = await task(apollo, { title: 'A', durationWorkingDays: 1 })
      const z = await task(zeus, { title: 'Z', durationWorkingDays: 1 })
      const created = await services.proposals.createProposal(by(alice), {
        groups: [{ changes: [move(a.id, '2027-03-08'), move(z.id, '2027-03-09')] }],
      })
      expect(created.projectIds).toEqual([apollo, zeus].sort())
      const entries = await x.db
        .select({ projectId: auditLog.projectId, subject: auditLog.subjectId })
        .from(auditLog)
        .where(eq(auditLog.action, 'proposal.created'))
      expect(entries).toHaveLength(2)
      expect(new Set(entries.map((entry) => entry.projectId))).toEqual(new Set([apollo, zeus]))
      expect(entries.every((entry) => entry.subject === created.id)).toBe(true)
    })

    it('shows a proposal only to someone with a role in every project it changes', async () => {
      const zeus = await seedProject(x.db, alice, 'Zeus')
      await grantRole(x.db, bob, apollo, 'read-only')
      const a = await task(apollo, { title: 'A', durationWorkingDays: 1 })
      const z = await task(zeus, { title: 'Z', durationWorkingDays: 1 })
      const onlyApollo = await services.proposals.createProposal(by(alice), {
        groups: [{ changes: [move(a.id, '2027-03-08')] }],
      })
      const both = await services.proposals.createProposal(by(alice), {
        groups: [{ changes: [move(a.id, '2027-03-08'), move(z.id, '2027-03-09')] }],
      })

      expect((await list(bob, apollo)).map((proposal) => proposal.id)).toEqual([onlyApollo.id])
      expect((await call(bob, 'GET', `/proposals/${both.id}`)).statusCode).toBe(403)
      expect((await call(bob, 'GET', `/proposals/${onlyApollo.id}`)).statusCode).toBe(200)
      expect((await list(alice, apollo)).map((proposal) => proposal.id)).toEqual([
        onlyApollo.id,
        both.id,
      ])
      const unknown = '6f1c2a5e-0000-4000-8000-000000000998'
      expect((await call(alice, 'GET', `/proposals/${unknown}`)).statusCode).toBe(404)
    })
  })
})
