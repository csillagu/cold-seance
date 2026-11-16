import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tokenAuthenticator } from '../../src/api/token-auth.ts'
import { buildApp } from '../../src/app.ts'
import { auditLog, proposals, tasks } from '../../src/db/schema.ts'
import type { AuditEntry } from '../../src/service/audit.ts'
import type { Proposal } from '../../src/service/proposals.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { Task, TaskInput } from '../../src/service/tasks.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { connectMcp, type McpClient } from '../helpers/mcp.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The MCP server (SC-027: FR-067, FR-068, FR-087, FR-113, FR-115) against a real PostgreSQL, each
// test in a fresh test deployment: a fresh database, first system admin `root`, and a global
// calendar with Saturday and Sunday as the weekend and no company holidays. The backend listens on
// a free port; an MCP client connects to it as an AI agent would, over the Streamable HTTP
// transport, with the access token of the account the test case names. What a test case does "as"
// someone, or reads "in the app", is done through the REST API in the UI's channel; what it does
// "through the REST API" is done with that person's access token.

type Account = Awaited<ReturnType<typeof seedAccount>>
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface Approved {
  outcome: 'confirm-again' | 'waiting-for-parts' | 'applied'
  proposal: Proposal
}

interface ErrorBody {
  statusCode: number
  error: string
  message: string
}

const move = (taskId: string, plannedStart: string) => ({
  kind: 'update-task',
  task: { taskId },
  fields: { plannedStart },
})

describe('the MCP server', () => {
  let x: TestDatabase
  let services: Services
  let app: ReturnType<typeof buildApp>
  let url: string
  let clients: McpClient[]
  let alice: Account
  let bob: Account
  let apollo: string

  beforeEach(async () => {
    x = await createTestDatabase()
    services = createServices(x.db)
    app = buildApp(
      {},
      { authenticators: [tokenAuthenticator(services.apiTokens), testAuthenticator], services },
    )
    url = await app.listen({ host: '127.0.0.1', port: 0 })
    clients = []
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
    apollo = await seedProject(x.db, alice, 'Apollo')
  })

  afterEach(async () => {
    for (const client of clients) await client.close()
    await app?.close()
    await x?.drop()
  })

  /** A personal access token `who` creates in the tool. */
  const tokenOf = async (who: Account) =>
    (await services.apiTokens.createToken({ accountId: who.id, channel: 'ui' }, {})).secret

  /** An MCP client connected with an access token of `who`. */
  const mcpAs = async (who: Account) => {
    const client = await connectMcp(url, await tokenOf(who))
    clients.push(client)
    return client
  }

  /** A request in the app, as `who`, through the UI's channel. */
  const call = (who: Account, method: Method, path: string, payload?: object) =>
    app.inject({
      method,
      url: `/api${path}`,
      headers: as(who, 'ui'),
      ...(payload === undefined ? {} : { payload }),
    })

  const ok = async <T>(who: Account, method: Method, path: string, payload?: object) => {
    const response = await call(who, method, path, payload)
    if (response.statusCode >= 300) throw new Error(`${method} ${path}: ${response.body}`)
    return response.json<T>()
  }

  /** A request through the REST API with the access token `secret`. */
  const rest = (secret: string, method: Method, path: string, payload?: object) =>
    app.inject({
      method,
      url: `/api${path}`,
      headers: { authorization: `Bearer ${secret}` },
      ...(payload === undefined ? {} : { payload }),
    })

  const task = (fields: TaskInput, projectId = apollo, who: Account = alice) =>
    ok<Task>(who, 'POST', `/projects/${projectId}/tasks`, fields)

  const startOf = async (taskId: string) =>
    (await ok<Task>(alice, 'GET', `/tasks/${taskId}`)).plannedStart

  /** The proposal `client` creates through the MCP server, with the changes given as one group. */
  const proposeThrough = (client: McpClient, changes: object[]) =>
    client.call<Proposal>('create_proposal', { groups: [{ changes }] })

  const created = (answer: { isError: boolean; json: Proposal }): Proposal => {
    if (answer.isError) throw new Error(`refused: ${JSON.stringify(answer.json)}`)
    return answer.json
  }

  /** Opens the proposal's preview as `who`, and approves Apollo's part from it, in the app. */
  const openAndApprove = async (who: Account, proposalId: string) => {
    const { planVersion } = await ok<{ planVersion: string }>(
      who,
      'GET',
      `/proposals/${proposalId}/preview`,
    )
    return call(who, 'POST', `/proposals/${proposalId}/approval`, {
      projectId: apollo,
      planVersion,
    })
  }

  const auditOf = (who: Account) => ok<AuditEntry[]>(who, 'GET', `/audit-log?projectId=${apollo}`)

  describe('its endpoint', () => {
    it('refuses a request without an access token, or with one that does not work', async () => {
      for (const authorization of [undefined, 'Bearer cst_never-created']) {
        const response = await app.inject({
          method: 'POST',
          url: '/mcp',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...(authorization === undefined ? {} : { authorization }),
          },
          payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        })
        expect(response.statusCode).toBe(401)
        expect(response.headers['www-authenticate']).toBe('Bearer')
      }
      await expect(connectMcp(url, 'cst_never-created')).rejects.toThrow(/401/)
    })

    it('offers tools that read the plan and notifications and create proposals, and no other', async () => {
      const client = await mcpAs(alice)
      expect((await client.toolNames()).sort()).toEqual([
        'create_proposal',
        'list_projects',
        'read_notifications',
        'read_plan',
      ])
    })

    it('lists the projects its caller can read, as the REST API does', async () => {
      await seedProject(x.db, bob, 'Borealis')
      const client = await mcpAs(alice)
      const listed = await client.call('list_projects')
      expect(listed).toEqual({ isError: false, json: [{ id: apollo, name: 'Apollo' }] })
      expect(listed.json).toEqual(await ok(alice, 'GET', '/projects'))
    })

    it('refuses a plan read of something that is not an id, as the REST API does', async () => {
      const client = await mcpAs(alice)
      const answer = await client.call<ErrorBody>('read_plan', { projectId: 'Apollo' })
      expect(answer.isError).toBe(true)
      expect(answer.json.statusCode).toBe(400)
    })

    it("records a proposal made through it as made by the token's owner through the MCP channel", async () => {
      const t = await task({ title: 'T', plannedStart: '2027-03-01', durationWorkingDays: 1 })
      const proposal = created(await proposeThrough(await mcpAs(alice), [move(t.id, '2027-03-02')]))
      expect(proposal).toMatchObject({ createdBy: alice.id, channel: 'mcp', status: 'waiting' })
    })
  })

  it('TC-094: the MCP server returns the plan', async () => {
    const a = await task({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 3 })
    const b = await task({ title: 'B', durationWorkingDays: 2 })
    await ok(alice, 'POST', `/tasks/${b.id}/blocked-by`, { blockerId: a.id })
    const secret = await tokenOf(alice)
    const client = await mcpAs(alice)
    const before = await x.db.select().from(tasks)
    const auditBefore = await x.db.select().from(auditLog)

    // Step 1: through the MCP server, read the plan of Apollo.
    const read = await client.call<{
      tasks: Task[]
      relations: { taskId: string; blockedBy: { id: string }[] }[]
    }>('read_plan', { projectId: apollo })
    expect(read.isError).toBe(false)
    const plan = read.json
    expect(plan.tasks.map((t) => [t.title, t.plannedStart, t.plannedFinish])).toEqual([
      ['A', '2027-03-01', '2027-03-03'],
      ['B', '2027-03-04', '2027-03-05'],
    ])
    expect(plan.relations.find((r) => r.taskId === b.id)?.blockedBy).toEqual([
      { id: a.id, projectId: apollo },
    ])
    expect(plan.relations.find((r) => r.taskId === a.id)?.blockedBy).toEqual([])

    // Step 2: the same plan, read through the REST API as alice.
    const restTasks = await rest(secret, 'GET', `/projects/${apollo}/tasks`)
    expect(plan.tasks).toEqual(restTasks.json())
    for (const t of plan.tasks) {
      const relations = await rest(secret, 'GET', `/tasks/${t.id}/relations`)
      expect(plan.relations.find((r) => r.taskId === t.id)).toEqual(relations.json())
    }

    // The read changes nothing in Apollo.
    expect(await x.db.select().from(tasks)).toEqual(before)
    expect(await x.db.select().from(auditLog)).toEqual(auditBefore)
  })

  it('TC-095: a direct plan edit through the MCP server is rejected', async () => {
    const t = await task({ title: 'T', plannedStart: '2027-03-01', durationWorkingDays: 1 })
    const client = await mcpAs(alice)
    const auditBefore = await x.db.select().from(auditLog)

    // Step 1: try to set T's planned start to 2027-03-02 directly, by any means the server
    // offers. Its only tool that changes anything creates a proposal; a tool by any other name
    // is refused, and no reading tool takes the change.
    expect(await client.toolNames()).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/update|edit|set|move|task$/)]),
    )
    for (const name of ['update_task', 'edit_task', 'set_planned_start', 'move_task']) {
      const answer = await client.call(name, { taskId: t.id, plannedStart: '2027-03-02' })
      expect(answer.isError).toBe(true)
    }
    for (const name of ['read_plan', 'list_projects', 'read_notifications']) {
      await client.call(name, { projectId: apollo, taskId: t.id, plannedStart: '2027-03-02' })
    }

    // Step 2: T still starts on 2027-03-01.
    expect(await startOf(t.id)).toBe('2027-03-01')
    // No proposal is created by the attempt, and the audit log records no change to T.
    expect(await x.db.select().from(proposals)).toEqual([])
    expect(await x.db.select().from(auditLog)).toEqual(auditBefore)
  })

  it('TC-096: approving a proposal through the MCP server is rejected', async () => {
    const t = await task({ title: 'T', plannedStart: '2027-03-01', durationWorkingDays: 1 })
    const client = await mcpAs(alice)
    const proposal = created(await proposeThrough(client, [move(t.id, '2027-03-02')]))

    // Step 1: try to approve the proposal through the MCP server: no tool approves one, and a
    // tool by any such name is refused.
    expect(await client.toolNames()).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/approv/)]),
    )
    for (const name of ['approve_proposal', 'approve']) {
      const answer = await client.call(name, { proposalId: proposal.id, projectId: apollo })
      expect(answer.isError).toBe(true)
    }

    // Step 2: T still starts on 2027-03-01, and the proposal is still waiting for review.
    expect(await startOf(t.id)).toBe('2027-03-01')
    const read = await ok<Proposal>(alice, 'GET', `/proposals/${proposal.id}`)
    expect(read.status).toBe('waiting')
    expect(read.approvals).toEqual([])
  })

  it("TC-166: MCP server access gets its owner's lack of a role", async () => {
    const dave = await seedAccount(x.db, { username: 'dave' })
    const t = await task({ title: 'T', plannedStart: '2027-03-01', durationWorkingDays: 1 })
    const client = await mcpAs(dave)

    // Step 1: with dave's token, try to read Apollo's plan.
    const read = await client.call('read_plan', { projectId: apollo })
    // Step 2: with dave's token, try to create a proposal moving T.
    const proposed = await proposeThrough(client, [move(t.id, '2027-03-02')])

    // Both are refused, as Apollo is not visible to him, and no data of Apollo is returned.
    for (const answer of [read, proposed]) {
      expect(answer.isError).toBe(true)
      expect(answer.json).toMatchObject({ statusCode: 403, error: 'Not Visible' })
      expect(JSON.stringify(answer.json)).not.toContain(t.id)
      expect(JSON.stringify(answer.json)).not.toContain('Apollo')
    }
    expect((await client.call('list_projects')).json).toEqual([])
    // No proposal is created.
    expect(await x.db.select().from(proposals)).toEqual([])
  })

  it('TC-019: a move onto a weekend never reaches the plan through the MCP server', async () => {
    await grantRole(x.db, bob, apollo, 'read-write')
    const t = await task({ title: 'T', plannedStart: '2027-03-01', durationWorkingDays: 1 })

    // Step 1: through the MCP server with bob's token, propose moving T to Saturday 2027-03-06.
    const answer = await proposeThrough(await mcpAs(bob), [move(t.id, '2027-03-06')])

    // The test case lets the rejection come at either step; the proposal store takes the proposal,
    // and the move is refused when it would reach the plan.
    const proposal = created(answer)

    // Step 2: alice opens it and approves it; both are refused, as the move cannot be made.
    expect((await call(alice, 'GET', `/proposals/${proposal.id}/preview`)).statusCode).toBe(409)
    const approval = await call(alice, 'POST', `/proposals/${proposal.id}/approval`, {
      projectId: apollo,
    })
    expect(approval.statusCode).toBe(409)

    // Step 3: T still starts on 2027-03-01, and was never stored on 2027-03-06.
    expect(await startOf(t.id)).toBe('2027-03-01')
    const entries = await x.db.select().from(auditLog).where(eq(auditLog.subjectId, t.id))
    expect(JSON.stringify(entries)).not.toContain('2027-03-06')
  })

  it('TC-159: a read-write member approves an AI proposal', async () => {
    await grantRole(x.db, bob, apollo, 'read-write')
    const t = await task({ title: 'T', plannedStart: '2027-03-01', durationWorkingDays: 1 })
    const proposal = created(await proposeThrough(await mcpAs(alice), [move(t.id, '2027-03-08')]))

    // Step 1: as bob, open the proposal and approve it.
    const approval = await openAndApprove(bob, proposal.id)
    expect(approval.statusCode).toBe(200)
    expect(approval.json<Approved>().outcome).toBe('applied')

    // Step 2: T starts 2027-03-08, and the proposal is no longer waiting for review.
    expect(await startOf(t.id)).toBe('2027-03-08')
    expect((await ok<Proposal>(alice, 'GET', `/proposals/${proposal.id}`)).status).toBe('approved')
  })

  it('TC-172: creating a proposal through the MCP server is logged with the MCP channel', async () => {
    const t = await task({ title: 'T', plannedStart: '2027-03-01', durationWorkingDays: 1 })
    const before = await auditOf(alice)

    // Step 1: through the MCP server with alice's token, create a proposal moving T, at time t.
    const startedAt = new Date()
    const proposal = created(await proposeThrough(await mcpAs(alice), [move(t.id, '2027-03-02')]))
    const finishedAt = new Date()

    // Step 2: as alice, read the audit log of Apollo.
    const added = (await auditOf(alice)).filter((e) => !before.some((b) => b.id === e.id))
    const creation = added.filter((e) => e.action === 'proposal.created')
    expect(creation).toHaveLength(1)
    expect(creation[0]).toMatchObject({
      by: { accountId: alice.id, username: 'alice' },
      channels: ['mcp'],
      subject: { type: 'proposal', id: proposal.id },
    })
    // At t, to the minute.
    const at = new Date(creation[0]!.at).getTime()
    expect(at).toBeGreaterThanOrEqual(startedAt.getTime() - 60_000)
    expect(at).toBeLessThanOrEqual(finishedAt.getTime() + 60_000)

    // No entry records a change to T itself.
    expect(added.some((e) => e.subject.id === t.id)).toBe(false)
  })

  it("TC-206: an approved proposal's changes are logged as the approver's", async () => {
    await grantRole(x.db, bob, apollo, 'read-write')
    const a = await task({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 1 })
    const b = await task({ title: 'B', plannedStart: '2027-03-01', durationWorkingDays: 1 })
    const proposal = created(
      await proposeThrough(await mcpAs(alice), [
        move(a.id, '2027-03-08'),
        move(b.id, '2027-03-08'),
      ]),
    )

    // Step 1: as bob, approve the proposal.
    const approval = await openAndApprove(bob, proposal.id)
    expect(approval.json<Approved>().outcome).toBe('applied')

    // Step 2: as alice, read the audit log of Apollo. The moves of A and B each name bob as the
    // one who made the change, and neither names alice.
    const log = await auditOf(alice)
    for (const taskId of [a.id, b.id]) {
      const moves = log.filter(
        (entry) =>
          entry.action === 'task.updated' &&
          entry.subject.id === taskId &&
          JSON.stringify(entry.details.changes).includes('plannedStart'),
      )
      expect(moves).toHaveLength(1)
      expect(moves[0]?.by).toEqual({ accountId: bob.id, username: 'bob' })
      expect(moves[0]?.by).not.toMatchObject({ accountId: alice.id })
    }
  })

  it('TC-123: notifications can be read through the MCP server (the MCP read)', async () => {
    // The in-app read of step 1 is also tested in the browser (e2e/tests/notifications.spec.ts).
    await grantRole(x.db, bob, apollo, 'read-write')
    const a = await task({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 1 })
    const proposal = created(await proposeThrough(await mcpAs(alice), [move(a.id, '2027-03-08')]))
    const planBefore = await x.db.select().from(tasks)

    // Step 1: as bob, read his notifications in the app.
    const inApp = await ok<{ kind: string; detail: { proposalId?: string } }[]>(
      bob,
      'GET',
      '/notifications',
    )
    expect(inApp.map((n) => [n.kind, n.detail.proposalId])).toEqual([
      ['proposal-waiting', proposal.id],
    ])

    // Step 2: bob's notifications through the MCP server, with bob's token: the same ones.
    const read = await (await mcpAs(bob)).call('read_notifications')
    expect(read).toEqual({ isError: false, json: inApp })

    // The read through the MCP server changes nothing in the plan.
    expect(await x.db.select().from(tasks)).toEqual(planBefore)
  })

  it('TC-169: a cycle is rejected alike through the UI, the REST API and the MCP server (step 3, through the MCP server)', async () => {
    // Steps 1 and 2 are tested in e2e/tests/task-relations.spec.ts and
    // backend/test/integration/task-relations.test.ts.
    const a = await task({ title: 'A' })
    const b = await task({ title: 'B' })
    await ok(alice, 'POST', `/tasks/${a.id}/blocked-by`, { blockerId: b.id })

    // Step 3: through the MCP server, propose making B blocked by A; if the proposal is
    // accepted, try to approve it in the UI.
    const answer = await proposeThrough(await mcpAs(alice), [
      { kind: 'add-blocker', task: { taskId: b.id }, blocker: { taskId: a.id } },
    ])
    // The test case lets the rejection come at either point; the proposal store takes the proposal,
    // and the change is refused when it would reach the plan.
    const proposal = created(answer)
    expect((await call(alice, 'GET', `/proposals/${proposal.id}/preview`)).statusCode).toBe(409)
    const approval = await call(alice, 'POST', `/proposals/${proposal.id}/approval`, {
      projectId: apollo,
    })
    expect(approval.statusCode).toBe(409)

    // Step 4: B is not blocked by A.
    const relations = await ok<{ blockedBy: { id: string }[] }>(
      alice,
      'GET',
      `/tasks/${b.id}/relations`,
    )
    expect(relations.blockedBy).toEqual([])
  })

  it('TC-280: a proposal is created through the REST API and through the MCP server', async () => {
    const a = await task({ title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 1 })
    const changes = [move(a.id, '2027-03-08')]
    const secret = await tokenOf(alice)

    // Step 1: through the REST API with alice's token, create the proposal.
    const first = await rest(secret, 'POST', '/proposals', { groups: [{ changes }] })
    expect(first.statusCode).toBe(201)
    // Step 2: through the MCP server with alice's token, create the proposal.
    const second = await connectMcp(url, secret)
    clients.push(second)
    const made = created(await proposeThrough(second, changes))
    expect(made.channel).toBe('mcp')

    // Step 3: Apollo has exactly two proposals, the first made through the REST API and the
    // second through the MCP server, each holding the one move of A.
    const listed = await ok<Proposal[]>(alice, 'GET', `/projects/${apollo}/proposals`)
    expect(listed.map((p) => p.channel)).toEqual(['rest-api', 'mcp'])
    for (const proposal of listed) {
      expect(proposal.groups).toHaveLength(1)
      expect(proposal.groups[0]?.changes).toMatchObject([
        { kind: 'update-task', task: { taskId: a.id }, fields: { plannedStart: '2027-03-08' } },
      ])
    }
    // A still starts on 2027-03-01: creating a proposal moves nothing.
    expect(await startOf(a.id)).toBe('2027-03-01')
  })
})
