import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { createGitHubClient } from '../../src/github/client.ts'
import { auditLog, notifications, repositories, taskIssues } from '../../src/db/schema.ts'
import type { Caller, Channel } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { TaskInput } from '../../src/service/tasks.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { fakeGitHub, type FakeGitHub } from '../helpers/github.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The notification module (SC-012) against a real PostgreSQL, each test in a fresh test
// deployment: a fresh database, first system admin `root`, and the default global calendar of
// Saturday and Sunday as the weekend and no company holidays. The test cases of FR-082 to FR-085,
// FR-087, FR-133, FR-134, FR-155, FR-173 and FR-186 through the REST API, then the module's rules.
// The subscription controls and the notification list in the browser are the frontend's (SC-093,
// SC-035, node F28), and reading the notifications through the MCP server is SC-027's (node B19).

type Account = Awaited<ReturnType<typeof seedAccount>>
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

interface Notice {
  id: string
  kind: string
  createdAt: string
  detail: Record<string, unknown>
}

interface Subscriptions {
  projects: { projectId: string; name: string; automatic: boolean }[]
  issues: { taskId: string; projectId: string; number: number }[]
}

const by = (account: Account, channel: Channel = 'ui'): Caller => ({
  accountId: account.id,
  channel,
})

const fixed = (date: string) => ({ variant: 'fixed-date', date }) as const

async function refused(promise: Promise<unknown>, kind: ServiceError['kind']) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  if (!(error instanceof ServiceError))
    throw new Error(`expected a ServiceError, got ${String(error)}`)
  expect(error.kind).toBe(kind)
}

describe('the notification module', () => {
  let x: TestDatabase
  let github: FakeGitHub
  let services: Services
  let app: ReturnType<typeof buildApp>
  let root: Account
  let alice: Account
  let bob: Account
  let carol: Account
  let dave: Account

  beforeEach(async () => {
    x = await createTestDatabase()
    github = fakeGitHub()
    services = createServices(x.db, { github: github.reach })
    app = buildApp({}, { authenticators: [testAuthenticator], services })
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
    carol = await seedAccount(x.db, { username: 'carol' })
    dave = await seedAccount(x.db, { username: 'dave' })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
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

  const ok = async <T = { id: string }>(
    who: Account,
    method: Method,
    url: string,
    payload?: object,
  ): Promise<T> => {
    const response = await call(who, method, url, payload)
    if (response.statusCode >= 300) throw new Error(`${method} ${url}: ${response.body}`)
    return response.json<T>()
  }

  /** A change answered with 204 No Content. */
  const done = async (who: Account, method: Method, url: string) => {
    const response = await call(who, method, url)
    if (response.statusCode !== 204) throw new Error(`${method} ${url}: ${response.body}`)
  }

  const task = async (who: Account, projectId: string, fields: TaskInput) =>
    (await ok(who, 'POST', `/projects/${projectId}/tasks`, fields)).id

  /** The person's in-app notifications, as the REST API gives them, newest first. */
  const notificationsOf = (who: Account) => ok<Notice[]>(who, 'GET', '/notifications')
  const ofKind = async (who: Account, kind: string) =>
    (await notificationsOf(who)).filter((notice) => notice.kind === kind)
  const subscriptionsOf = (who: Account) => ok<Subscriptions>(who, 'GET', '/subscriptions')
  const subscribedProjects = async (who: Account) =>
    (await subscriptionsOf(who)).projects.map((p) => p.projectId)

  /** A repository registered by `registrant`, under a name no other test uses. */
  let n = 0
  const registered = (registrant: Account) => {
    const repo = github.createRepository(`tc-${++n}/tc-repo`)
    return services.repositories.registerRepository(by(registrant), repo)
  }

  /** Task `taskId` with issue `#number` in a registered repository, as the issue creator links them. */
  const linkIssue = async (taskId: string, number: number) => {
    const [repo] = await x.db
      .insert(repositories)
      .values({ githubId: 5_000 + ++n, owner: 'tc', name: `repo-${n}`, registeredBy: alice.id })
      .returning({ id: repositories.id })
    if (!repo) throw new Error('no repository')
    await x.db
      .insert(taskIssues)
      .values({ taskId, repositoryId: repo.id, number, githubId: 6_000 + n })
  }

  describe('its test cases through the REST API', () => {
    it('TC-117: a notification is delivered in the app and nowhere else', async () => {
      // The service and REST part: the notification is in the app, and the tool sends nothing
      // out while delivering it. Pending: the browser's notification list (SC-035, F28).
      const outbound = vi.spyOn(globalThis, 'fetch')
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const one = { assignees: [alice.id], aiShare: 0, durationWorkingDays: 1 }
      await task(alice, apollo, { title: 'T1', ...one, plannedStart: '2027-03-01' })

      // Step 1: alice creates T2, so she is overloaded: a new red flag.
      await task(alice, apollo, { title: 'T2', ...one, plannedStart: '2027-03-01' })

      // Step 2: alice reads her notifications in the app.
      const flags = await ofKind(alice, 'red-flag')
      expect(flags.map((f) => f.detail.flagKind)).toContain('overload')
      expect(flags.find((f) => f.detail.flagKind === 'overload')?.detail).toEqual({
        flagKind: 'overload',
        projectIds: [apollo],
        accountId: alice.id,
        date: '2027-03-01',
      })
      // Step 3, negative: nothing went out, by email, Slack or anything else.
      expect(outbound).not.toHaveBeenCalled()
    })

    it('TC-118: a new red flag notifies subscribers of its project and no one else', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      await grantRole(x.db, bob, apollo, 'read-only')
      await grantRole(x.db, carol, apollo, 'read-only')
      await done(bob, 'PUT', `/subscriptions/projects/${apollo}`)
      const one = { assignees: [alice.id], aiShare: 0, durationWorkingDays: 1 }
      await task(alice, apollo, { title: 'T1', ...one, plannedStart: '2027-03-01' })
      expect(await ofKind(bob, 'red-flag')).toEqual([])

      // Step 1: alice creates T2, so she is overloaded.
      await task(alice, apollo, { title: 'T2', ...one, plannedStart: '2027-03-01' })

      // Step 2: bob has a notification of the new red flag.
      const kinds = (await ofKind(bob, 'red-flag')).map((f) => f.detail.flagKind)
      expect(kinds).toContain('overload')
      // Negative: carol has none.
      expect(await notificationsOf(carol)).toEqual([])
    })

    it("TC-119: a shared milestone moving past a dependent task's start notifies both projects' admins", async () => {
      const borealis = await seedProject(x.db, bob, 'Borealis')
      await grantRole(x.db, alice, borealis, 'read-only')
      const m = await task(bob, borealis, { title: 'M', milestone: fixed('2027-03-10') })
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const t = await task(alice, apollo, {
        title: 'T',
        plannedStart: '2027-03-11',
        durationWorkingDays: 1,
      })
      await ok(alice, 'POST', `/tasks/${t}/blocked-by`, { blockerId: m })
      const aboutM = async (who: Account) =>
        (await ofKind(who, 'red-flag')).filter(
          (f) => f.detail.flagKind === 'cross-project-dependency',
        )

      // Step 1, negative: neither has such a notification yet.
      expect(await aboutM(alice)).toEqual([])
      expect(await aboutM(bob)).toEqual([])

      // Step 2: bob moves M to 2027-03-17.
      await ok(bob, 'PATCH', `/tasks/${m}`, { milestone: fixed('2027-03-17') })

      // Step 3: both have a new notification of M moving past the start of T.
      const both = { flagKind: 'cross-project-dependency', crossProject: true }
      expect((await aboutM(alice)).map((f) => f.detail)).toEqual([
        {
          ...both,
          projectIds: expect.arrayContaining([apollo, borealis]),
          task: { id: t, projectId: apollo },
          blocker: { id: m, projectId: borealis },
          start: '2027-03-11',
          blockerFinish: '2027-03-17',
        },
      ])
      // Bob cannot read Apollo: his notification names M and the dates, and leaves T out.
      expect((await aboutM(bob)).map((f) => f.detail)).toEqual([
        {
          ...both,
          projectIds: [borealis],
          task: null,
          blocker: { id: m, projectId: borealis },
          start: '2027-03-11',
          blockerFinish: '2027-03-17',
        },
      ])
    })

    it('TC-120: a proposal waiting for review notifies the read-write members of its project', async () => {
      // Created through the service layer with the channel the MCP server will give it; the MCP
      // server itself comes with SC-027 (B19).
      const apollo = await seedProject(x.db, alice, 'Apollo')
      await grantRole(x.db, bob, apollo, 'read-write')
      await grantRole(x.db, carol, apollo, 'read-only')
      const a = await task(alice, apollo, {
        title: 'A',
        plannedStart: '2027-03-01',
        durationWorkingDays: 1,
      })

      // Step 1: the proposal moving A to 2027-03-08.
      const proposal = await services.proposals.createProposal(by(alice, 'mcp'), {
        groups: [
          {
            changes: [
              { kind: 'update-task', task: { taskId: a }, fields: { plannedStart: '2027-03-08' } },
            ],
          },
        ],
      })

      // Step 2: bob has a notification that it waits for review.
      expect((await ofKind(bob, 'proposal-waiting')).map((f) => f.detail)).toEqual([
        { proposalId: proposal.id, projectIds: [apollo] },
      ])
      // Negative: carol has none asking her to review it.
      expect(await ofKind(carol, 'proposal-waiting')).toEqual([])
    })

    it('TC-122: notifications can be read through the REST API', async () => {
      // The REST read. Pending: the same notification in the browser (SC-035, F28).
      const apollo = await seedProject(x.db, alice, 'Apollo')
      await grantRole(x.db, bob, apollo, 'read-write')
      const a = await task(alice, apollo, { title: 'A' })
      await services.proposals.createProposal(by(alice, 'mcp'), {
        groups: [
          { changes: [{ kind: 'update-task', task: { taskId: a }, fields: { title: 'B' } }] },
        ],
      })

      // Step 2: bob reads his notifications through the REST API with his token.
      const first = await ofKind(bob, 'proposal-waiting')
      expect(first).toHaveLength(1)
      expect(first[0]?.createdAt).toEqual(expect.any(String))
      // Negative: reading them leaves them in place.
      expect(await ofKind(bob, 'proposal-waiting')).toEqual(first)
    })

    it('TC-196: a person subscribes to a project', async () => {
      // The service and REST part. Pending: the subscription controls (SC-093, F28).
      const apollo = await seedProject(x.db, alice, 'Apollo')
      await grantRole(x.db, carol, apollo, 'read-only')
      expect(await subscribedProjects(carol)).toEqual([])

      // Step 1: carol subscribes to Apollo.
      await done(carol, 'PUT', `/subscriptions/projects/${apollo}`)

      // Step 2: she is subscribed to it.
      expect((await subscriptionsOf(carol)).projects).toEqual([
        { projectId: apollo, name: 'Apollo', automatic: false },
      ])
      // Negative: her role is unchanged.
      expect(await services.projectRoles.roleOf(carol.id, apollo)).toBe('read-only')
    })

    it('TC-197: a person subscribes to an issue', async () => {
      // The service and REST part, with T's issue #1 linked as the issue creator (SC-060) links
      // it. Pending: the subscription controls (SC-093, F28).
      const apollo = await seedProject(x.db, alice, 'Apollo')
      await grantRole(x.db, carol, apollo, 'read-only')
      const t = await task(alice, apollo, { title: 'T' })
      await linkIssue(t, 1)

      // Step 1: carol subscribes to #1.
      await done(carol, 'PUT', `/subscriptions/issues/${t}`)

      // Step 2: she is subscribed to #1.
      const subscriptions = await subscriptionsOf(carol)
      expect(subscriptions.issues).toMatchObject([{ taskId: t, projectId: apollo, number: 1 }])
      // Negative: not to Apollo as a whole.
      expect(subscriptions.projects).toEqual([])
    })

    it('TC-198: read-write and admin members are subscribed to their project automatically', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      await ok(alice, 'PUT', `/projects/${apollo}/members/${bob.id}`, { role: 'read-write' })
      await ok(alice, 'PUT', `/projects/${apollo}/members/${carol.id}`, { role: 'read-only' })
      await ok(alice, 'PUT', `/projects/${apollo}/members/${dave.id}`, { role: 'contributor' })

      // Step 1: alice and bob are subscribed to Apollo.
      const auto = [{ projectId: apollo, name: 'Apollo', automatic: true }]
      expect((await subscriptionsOf(alice)).projects).toEqual(auto)
      expect((await subscriptionsOf(bob)).projects).toEqual(auto)
      // Negative: carol and dave are not.
      expect(await subscribedProjects(carol)).toEqual([])
      expect(await subscribedProjects(dave)).toEqual([])
    })

    it("TC-227: there is no way to request a change in another project (step 2: bob's notifications)", async () => {
      // Step 2. Pending: step 1, looking in the views for an action to ask Borealis for a change
      // (the frontend's Gantt, SC-031, and milestone screens).
      const borealis = await seedProject(x.db, bob, 'Borealis')
      await grantRole(x.db, alice, borealis, 'read-only')
      const m = await task(bob, borealis, { title: 'M', milestone: fixed('2027-03-17') })
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const t = await task(alice, apollo, {
        title: 'T',
        plannedStart: '2027-03-11',
        durationWorkingDays: 1,
      })
      await ok(alice, 'POST', `/tasks/${t}/blocked-by`, { blockerId: m })

      // Bob has the notification of the red dependency only: no change request from alice.
      expect((await notificationsOf(bob)).map((f) => [f.kind, f.detail.flagKind])).toEqual([
        ['red-flag', 'cross-project-dependency'],
      ])
    })

    it("TC-253: a project's request notifies every repository admin in the app", async () => {
      const repo = await registered(bob)
      await services.repositories.addAdmin(by(bob), repo.id, carol.id)
      const apollo = await seedProject(x.db, alice, 'Apollo')

      // Step 1: alice asks to add tc-repo to Apollo.
      const request = await ok(alice, 'POST', `/projects/${apollo}/repository-requests`, {
        repositoryId: repo.id,
      })

      // Step 2: bob and carol each have a notification of it.
      const expected = [
        {
          requestId: request.id,
          project: { id: apollo, name: 'Apollo' },
          repository: { id: repo.id, owner: repo.owner, name: repo.name },
          requestedBy: { accountId: alice.id, username: 'alice' },
        },
      ]
      expect((await ofKind(bob, 'repository-request')).map((f) => f.detail)).toEqual(expected)
      expect((await ofKind(carol, 'repository-request')).map((f) => f.detail)).toEqual(expected)
      // Negative: alice gets none.
      expect(await ofKind(alice, 'repository-request')).toEqual([])
    })

    it('TC-261: a revoked token notifies every system admin (the notification)', async () => {
      // The notification part: the GitHub client, given tc-bot's revoked token for writing to
      // issues, reports GitHub's refusal as the backend's start wires it. That assigning T makes
      // the write is the issue creator's (SC-060); the client's own test covers the refusal.
      const sam = await seedAccount(x.db, { username: 'sam', systemAdmin: true })
      const client = createGitHubClient(
        {
          apps: {},
          tokens: { readIssues: 'ghp_r', writeIssues: 'ghp_tc_bot', projectsStatus: 'ghp_p' },
        },
        {
          fetch: async () => new Response('{"message":"Bad credentials"}', { status: 401 }),
          onTokenRefused: (refusal) => services.notifications.notifyTokenRefused(refusal.function),
        },
      )
      const repo = { owner: 'tc', name: 'tc-repo' }
      const write = () =>
        client.rest('writeIssues', repo, { method: 'POST', path: ['issues'], body: { title: 'T' } })
      await expect(write()).rejects.toThrow('expired or revoked')
      // A later call is refused without asking GitHub; the admins are not told again.
      await expect(write()).rejects.toThrow('expired or revoked')

      // Step 3: root and sam each have one notification naming writing to issues.
      const refusal = [{ function: 'writeIssues' }]
      expect((await ofKind(root, 'token-refused')).map((f) => f.detail)).toEqual(refusal)
      expect((await ofKind(sam, 'token-refused')).map((f) => f.detail)).toEqual(refusal)
      // Negative: alice has none.
      expect(await notificationsOf(alice)).toEqual([])
    })
  })

  describe('its rules', () => {
    it('subscribes by a read-write or admin role held through a group', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const group = await services.groups.createGroup(by(bob), { name: 'Crew' })
      await services.groups.addProject(by(alice), group.id, apollo)
      expect((await subscriptionsOf(bob)).projects).toEqual([
        { projectId: apollo, name: 'Apollo', automatic: true },
      ])
    })

    it('refuses a project or issue its caller cannot see, and a task with no issue', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const t = await task(alice, apollo, { title: 'T' })
      await refused(services.notifications.subscribeToProject(by(carol), apollo), 'not-visible')
      await refused(services.notifications.subscribeToIssue(by(alice), t), 'not-found')
      await linkIssue(t, 1)
      await refused(services.notifications.subscribeToIssue(by(carol), t), 'not-visible')
      const missing = '00000000-0000-4000-8000-000000000000'
      await refused(services.notifications.subscribeToIssue(by(alice), missing), 'not-found')
      expect((await call(carol, 'PUT', `/subscriptions/projects/${apollo}`)).statusCode).toBe(403)
    })

    it('unsubscribes from a project or issue subscribed to by hand, not from one a role gives', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      await grantRole(x.db, carol, apollo, 'read-only')
      const t = await task(alice, apollo, { title: 'T' })
      await linkIssue(t, 1)
      await done(carol, 'PUT', `/subscriptions/projects/${apollo}`)
      await done(carol, 'PUT', `/subscriptions/projects/${apollo}`)
      await done(carol, 'PUT', `/subscriptions/issues/${t}`)
      await done(carol, 'DELETE', `/subscriptions/projects/${apollo}`)
      await done(carol, 'DELETE', `/subscriptions/issues/${t}`)
      expect(await subscriptionsOf(carol)).toEqual({ projects: [], issues: [] })
      expect((await call(carol, 'DELETE', `/subscriptions/projects/${apollo}`)).statusCode).toBe(
        404,
      )
      expect((await call(carol, 'DELETE', `/subscriptions/issues/${t}`)).statusCode).toBe(404)
      // Alice's admin role subscribes her: that cannot be ended by hand (FR-134).
      expect((await call(alice, 'DELETE', `/subscriptions/projects/${apollo}`)).statusCode).toBe(
        409,
      )
      // Each change of carol's is in the log.
      const actions = (await x.db.select({ action: auditLog.action }).from(auditLog))
        .map((row) => row.action)
        .filter((action) => action.startsWith('subscription.'))
      expect(actions).toEqual([
        'subscription.project-added',
        'subscription.issue-added',
        'subscription.project-removed',
        'subscription.issue-removed',
      ])
    })

    it('notifies the subscribers of an issue of a red flag about its task', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      await grantRole(x.db, carol, apollo, 'read-only')
      const one = { assignees: [alice.id], aiShare: 0, durationWorkingDays: 1 }
      const t1 = await task(alice, apollo, { title: 'T1', ...one, plannedStart: '2027-03-01' })
      await linkIssue(t1, 1)
      await done(carol, 'PUT', `/subscriptions/issues/${t1}`)
      await task(alice, apollo, { title: 'T2', ...one, plannedStart: '2027-03-01' })
      // Of T1 shown in red; not of the overload, which names no task, nor of T2.
      expect((await notificationsOf(carol)).map((f) => f.detail)).toEqual([
        expect.objectContaining({
          flagKind: 'assignee-unavailable',
          task: { id: t1, projectId: apollo },
        }),
      ])
    })

    it('notifies a subscriber once of a flag raised in two projects, and only if they can read both', async () => {
      // Alice is overloaded by a task of Apollo and one of Borealis: one overload, red in both.
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const borealis = await seedProject(x.db, alice, 'Borealis')
      await grantRole(x.db, bob, apollo, 'read-write')
      await grantRole(x.db, bob, borealis, 'read-write')
      const one = { assignees: [alice.id], aiShare: 0, durationWorkingDays: 1 }
      await task(alice, apollo, { title: 'A', ...one, plannedStart: '2027-03-01' })
      await task(alice, borealis, { title: 'B', ...one, plannedStart: '2027-03-01' })
      const overloads = (await ofKind(bob, 'red-flag')).filter(
        (f) => f.detail.flagKind === 'overload',
      )
      expect(overloads.map((f) => f.detail.projectIds)).toEqual([
        expect.arrayContaining([apollo, borealis]),
      ])

      // A violation across Apollo and Cassini goes to a subscriber of Cassini only if they can
      // read Apollo too.
      const cassini = await seedProject(x.db, carol, 'Cassini')
      await grantRole(x.db, dave, cassini, 'read-only')
      await done(dave, 'PUT', `/subscriptions/projects/${cassini}`)
      await grantRole(x.db, alice, cassini, 'read-only')
      const m = await task(carol, cassini, { title: 'M', milestone: fixed('2027-03-17') })
      const t = await task(alice, apollo, {
        title: 'T',
        plannedStart: '2027-03-11',
        durationWorkingDays: 1,
      })
      await ok(alice, 'POST', `/tasks/${t}/blocked-by`, { blockerId: m })
      expect(await ofKind(dave, 'red-flag')).toEqual([])
      // Carol, Cassini's admin, is told whatever she can read (FR-084).
      expect((await ofKind(carol, 'red-flag')).map((f) => f.detail.task)).toEqual([null])
    })

    it('notifies no one of a change that is refused or rolled back', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      await grantRole(x.db, carol, apollo, 'read-only')
      const one = { assignees: [alice.id], aiShare: 0, durationWorkingDays: 1 }
      await task(alice, apollo, { title: 'T1', ...one, plannedStart: '2027-03-01' })
      const before = await x.db.select().from(notifications)
      // Carol may not create a task: nothing is raised, so nothing is sent.
      const response = await call(carol, 'POST', `/projects/${apollo}/tasks`, {
        title: 'T2',
        ...one,
        plannedStart: '2027-03-01',
      })
      expect(response.statusCode).toBe(403)
      expect(await x.db.select().from(notifications)).toEqual(before)
    })

    it('gives a proposal-waiting notification to the reviewers of every project it changes', async () => {
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const borealis = await seedProject(x.db, alice, 'Borealis')
      await grantRole(x.db, bob, borealis, 'read-write')
      const a = await task(alice, apollo, { title: 'A' })
      const b = await task(alice, borealis, { title: 'B' })
      const proposal = await services.proposals.createProposal(by(alice, 'mcp'), {
        groups: [
          { changes: [{ kind: 'update-task', task: { taskId: a }, fields: { title: 'A2' } }] },
          { changes: [{ kind: 'update-task', task: { taskId: b }, fields: { title: 'B2' } }] },
        ],
      })
      // Bob reviews Borealis's part; Apollo, which he cannot read, is left out of what he is told.
      expect((await ofKind(bob, 'proposal-waiting')).map((f) => f.detail)).toEqual([
        { proposalId: proposal.id, projectIds: [borealis] },
      ])
      expect((await ofKind(alice, 'proposal-waiting')).map((f) => f.detail)).toEqual([
        { proposalId: proposal.id, projectIds: [apollo, borealis].sort() },
      ])
    })

    it('sends no request notification when the requester is admin of the repository too', async () => {
      const repo = await registered(alice)
      const apollo = await seedProject(x.db, alice, 'Apollo')
      await ok(alice, 'POST', `/projects/${apollo}/repository-requests`, { repositoryId: repo.id })
      expect(await x.db.select().from(notifications)).toEqual([])
    })
  })
})
