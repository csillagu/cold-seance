import type { Browser, BrowserContext, Page } from '@playwright/test'
import { repositories, taskIssues } from '../../backend/src/db/schema.ts'
import { createServices } from '../../backend/src/service/services.ts'
import { type Account, type Deployment, expect, test } from '../fixtures.ts'

// The in-app notification list (SC-035) and the subscription controls (SC-093) in the browser:
// the browser steps of the test cases of FR-082, FR-087 and FR-133. Which notifications are sent,
// and the subscriptions' rules, are the notification module's (SC-012), tested through the REST
// API in backend/test/integration/notifications.test.ts. The test cases create each proposal
// through the MCP server, which comes with SC-027 (B19); until then it is created through the
// service layer with the channel the MCP server will give it, as the integration tests do. The
// other inputs are put in place through the REST API, in the browser's own session.

/** The browsers the test opened, closed after it, before its deployment is closed. */
const opened: BrowserContext[] = []

test.afterEach(async () => {
  await Promise.all(opened.splice(0).map((context) => context.close()))
})

/** A browser of its own for `account`, signed in on the sign-in page. */
async function signedIn(browser: Browser, baseURL: string, account: Account): Promise<Page> {
  const context = await browser.newContext({ baseURL })
  opened.push(context)
  const page = await context.newPage()
  await page.goto('/sign-in')
  await page.getByLabel('Username').fill(account.username)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/')
  return page
}

/**
 * Calls the REST API from `page`, in its session, and gives its parsed answer, failing on an error
 * status. The call is made by the page itself, as the session cookie is `Secure` and only the
 * browser sends it to the test deployment's plain-HTTP address.
 */
async function call(page: Page, method: string, path: string, data?: unknown): Promise<unknown> {
  const answer = await page.evaluate(
    async (request) => {
      const response = await fetch(`/api${request.path}`, {
        method: request.method,
        headers: request.data === undefined ? {} : { 'content-type': 'application/json' },
        body: request.data === undefined ? undefined : JSON.stringify(request.data),
      })
      return { ok: response.ok, text: await response.text() }
    },
    { method, path, data },
  )
  expect(answer.ok, `${method} ${path}: ${answer.text}`).toBe(true)
  const parsed: unknown = answer.text === '' ? null : JSON.parse(answer.text)
  return parsed
}

/** The field `key` of an object the REST API answered with. */
function fieldOf(answer: unknown, key: string): unknown {
  if (typeof answer !== 'object' || answer === null) throw new Error('The answer is no object')
  return Object.entries(answer).find(([name]) => name === key)?.[1]
}

const idOf = (answer: unknown) => String(fieldOf(answer, 'id'))

const createProject = async (page: Page, name: string) =>
  idOf(await call(page, 'POST', '/projects', { name }))

const createTask = async (page: Page, project: string, fields: Record<string, unknown>) =>
  idOf(await call(page, 'POST', `/projects/${project}/tasks`, fields))

const giveRole = (page: Page, project: string, account: Account, role: string) =>
  call(page, 'PUT', `/projects/${project}/members/${account.id}`, { role })

/** Opens the signed-in person's notifications from the navigation. */
async function openNotifications(page: Page) {
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Notifications' })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible()
}

const notificationList = (page: Page) => page.getByRole('list', { name: 'Notifications' })
const subscriptionList = (page: Page) => page.getByRole('list', { name: 'Subscriptions' })

/** Opens the project from the navigation. */
async function openProject(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name, exact: true })
    .click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

/**
 * The inputs of TC-122 and TC-123: alice's Apollo, where bob has the read-write role, with task
 * `A`, and a proposal moving `A`, created by alice through the MCP server's channel, so bob has a
 * notification that it is waiting for review. Gives bob's browser and the proposal's id.
 */
async function proposalWaitingForBob(browser: Browser, deployment: Deployment) {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(alicesPage, 'Apollo')
  await giveRole(alicesPage, apollo, bob, 'read-write')
  const a = await createTask(alicesPage, apollo, {
    title: 'A',
    plannedStart: '2027-03-01',
    durationWorkingDays: 1,
  })
  const proposal = await createServices(deployment.db).proposals.createProposal(
    { accountId: alice.id, channel: 'mcp' },
    {
      groups: [
        {
          changes: [
            { kind: 'update-task', task: { taskId: a }, fields: { plannedStart: '2027-03-08' } },
          ],
        },
      ],
    },
  )
  const bobsPage = await signedIn(browser, deployment.url, bob)
  return { bobsPage, proposal: proposal.id }
}

/** Step 1 of TC-122 and TC-123: bob reads the notification in the app, which leads to it. */
async function bobReadsItInTheApp(bobsPage: Page, proposal: string) {
  await openNotifications(bobsPage)
  const item = notificationList(bobsPage).getByRole('link', {
    name: 'A proposal changing Apollo is waiting for your review.',
  })
  await expect(item).toHaveAttribute('href', `/proposals/${proposal}`)
}

test('TC-117: a notification is delivered in the app and nowhere else (the browser)', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  const one = { assignees: [alice.id], aiShare: 0, durationWorkingDays: 1 }
  await createTask(page, apollo, { title: 'T1', ...one, plannedStart: '2027-03-01' })

  // The deployment's backend runs in this process: record every request it sends out.
  const outbound: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (input, init) => {
    outbound.push(input instanceof Request ? input.url : String(input))
    return realFetch(input, init)
  }
  try {
    // Step 1: alice creates T2, so she is overloaded on 1 March: a new red flag.
    await createTask(page, apollo, { title: 'T2', ...one, plannedStart: '2027-03-01' })

    // Step 2: alice opens her notifications in the app.
    await openNotifications(page)
    const flag = notificationList(page).getByRole('link', {
      name: 'You are overloaded on 1 Mar 2027 in Apollo.',
    })
    await expect(flag).toBeVisible()
    await expect(flag).toHaveAttribute('href', `/projects/${apollo}/load`)
  } finally {
    globalThis.fetch = realFetch
  }
  // Step 3, negative: the backend sent nothing out, by email, Slack or anything else.
  expect(outbound).toEqual([])
})

test('TC-196: a person subscribes to a project (the browser)', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const carol = await deployment.seedAccount('carol')
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(alicesPage, 'Apollo')
  await giveRole(alicesPage, apollo, carol, 'read-only')
  const page = await signedIn(browser, deployment.url, carol)

  // Step 1: carol subscribes to Apollo, on its page.
  await openProject(page, 'Apollo')
  await page.getByRole('button', { name: 'Subscribe to Apollo' }).click()
  await expect(page.getByRole('button', { name: 'Unsubscribe from Apollo' })).toBeVisible()

  // Step 2: her subscriptions list Apollo.
  await openNotifications(page)
  await expect(subscriptionList(page).getByRole('link', { name: 'Apollo' })).toBeVisible()
  await expect(
    subscriptionList(page).getByRole('button', { name: 'Unsubscribe from Apollo' }),
  ).toBeVisible()

  // Negative: her role in Apollo is unchanged.
  const members = await call(alicesPage, 'GET', `/projects/${apollo}/members`)
  if (!Array.isArray(members)) throw new Error('The members are not a list')
  const hers = members.find((member: unknown) => fieldOf(member, 'accountId') === carol.id)
  expect(fieldOf(hers, 'role')).toBe('read-only')
})

test('TC-197: a person subscribes to an issue (the browser)', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const carol = await deployment.seedAccount('carol')
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(alicesPage, 'Apollo')
  await giveRole(alicesPage, apollo, carol, 'read-only')
  const t = await createTask(alicesPage, apollo, { title: 'T' })
  // T's issue #1 in tc-repo, linked as the GitHub issue creator (SC-060) links it.
  const [repo] = await deployment.db
    .insert(repositories)
    .values({ githubId: 5_001, owner: 'csillagu', name: 'tc-repo', registeredBy: alice.id })
    .returning({ id: repositories.id })
  if (!repo) throw new Error('The repository was not stored')
  await deployment.db
    .insert(taskIssues)
    .values({ taskId: t, repositoryId: repo.id, number: 1, githubId: 6_001 })
  const page = await signedIn(browser, deployment.url, carol)

  // Step 1: carol subscribes to #1, on T's page.
  await page.goto(`/tasks/${t}`)
  await expect(page.getByText('Linked to GitHub issue #1.')).toBeVisible()
  await page.getByRole('button', { name: 'Subscribe to issue #1' }).click()
  await expect(page.getByRole('button', { name: 'Unsubscribe from issue #1' })).toBeVisible()

  // Step 2: her subscriptions list #1.
  await openNotifications(page)
  await expect(
    subscriptionList(page).getByRole('link', { name: 'csillagu/tc-repo#1' }),
  ).toHaveAttribute('href', `/tasks/${t}`)

  // Negative: she is not subscribed to Apollo as a whole.
  await expect(subscriptionList(page).getByRole('link', { name: 'Apollo' })).toHaveCount(0)
  await openProject(page, 'Apollo')
  await expect(page.getByRole('button', { name: 'Subscribe to Apollo' })).toBeVisible()
})

test('TC-122: notifications can be read through the REST API (the browser)', async ({
  browser,
  deployment,
}) => {
  const { bobsPage, proposal } = await proposalWaitingForBob(browser, deployment)
  const created = await call(bobsPage, 'POST', '/tokens', {})
  const secret = String(fieldOf(created, 'secret'))

  // Step 1: bob reads his notifications in the app.
  await bobReadsItInTheApp(bobsPage, proposal)

  // Step 2: the REST API, with bob's token alone, gives the same notification. It is read from
  // here, outside the browser, as a client of the REST API would.
  const response = await fetch(`${deployment.url}/api/notifications`, {
    headers: { authorization: `Bearer ${secret}` },
  })
  expect(response.status).toBe(200)
  const read: unknown = await response.json()
  if (!Array.isArray(read)) throw new Error('The notifications are not a list')
  expect(read).toHaveLength(1)
  expect(fieldOf(read[0], 'kind')).toBe('proposal-waiting')
  expect(fieldOf(fieldOf(read[0], 'detail'), 'proposalId')).toBe(proposal)

  // Negative: the REST read leaves the notification in the app, read afresh.
  await bobsPage
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Start' })
    .click()
  await bobReadsItInTheApp(bobsPage, proposal)
})

test('TC-123: notifications can be read through the MCP server (step 1: the in-app read)', async ({
  browser,
  deployment,
}) => {
  // Pending: step 2 and the negative assertion, reading bob's notifications through the MCP
  // server with his token, wait for the MCP server endpoint (SC-027, B19).
  const { bobsPage, proposal } = await proposalWaitingForBob(browser, deployment)

  // Step 1: bob reads his notifications in the app.
  await bobReadsItInTheApp(bobsPage, proposal)
})
