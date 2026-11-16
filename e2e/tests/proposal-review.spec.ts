import type { Browser, BrowserContext, Page } from '@playwright/test'
import { connectMcp } from '../../backend/test/helpers/mcp.ts'
import { type Account, type Deployment, expect, test } from '../fixtures.ts'

// The proposal approve and reject controls (SC-072): the browser steps of the test cases they make
// pass. What an approval applies, and when it asks to confirm again, come from the REST API, whose
// part of each test case is tested in backend/test/integration/proposal-approval.test.ts. Each
// proposal is created as the test cases say, through the MCP server with alice's access token, by
// an MCP client as an AI agent would. The other inputs are put in place through the REST API, in
// each person's own browser session.

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
 * Calls the REST API from `page`, in its session, and gives its status and parsed answer. The call
 * is made by the page itself, as the session cookie is `Secure` and only the browser sends it to
 * the test deployment's plain-HTTP address.
 */
async function request(
  page: Page,
  method: string,
  path: string,
  data?: unknown,
): Promise<{ status: number; body: unknown }> {
  const answer = await page.evaluate(
    async (sent) => {
      const response = await fetch(`/api${sent.path}`, {
        method: sent.method,
        headers: sent.data === undefined ? {} : { 'content-type': 'application/json' },
        body: sent.data === undefined ? undefined : JSON.stringify(sent.data),
      })
      return { status: response.status, text: await response.text() }
    },
    { method, path, data },
  )
  const body: unknown = answer.text === '' ? null : JSON.parse(answer.text)
  return { status: answer.status, body }
}

/** As `request`, failing on an error status. */
async function call(page: Page, method: string, path: string, data?: unknown): Promise<unknown> {
  const answer = await request(page, method, path, data)
  expect(answer.status, `${method} ${path}: ${JSON.stringify(answer.body)}`).toBeLessThan(300)
  return answer.body
}

/** `value` as an object of the API's answer, failing if it is not one. */
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The answer is not an object')
  }
  return { ...value }
}

const idOf = (created: unknown) => String(record(created)['id'])

const read = async (page: Page, path: string) => record(await call(page, 'GET', path))

const startOf = async (page: Page, task: string) =>
  (await read(page, `/tasks/${task}`))['plannedStart']

/** The change that moves the task to `date`. */
const move = (task: string, date: string) => ({
  kind: 'update-task',
  task: { taskId: task },
  fields: { plannedStart: date },
})

/** The change that assigns the people to the task. */
const assign = (task: string, accountIds: string[]) => ({
  kind: 'update-task',
  task: { taskId: task },
  fields: { assignees: accountIds },
})

/**
 * The test cases' common inputs: accounts alice and bob, project Apollo created by alice, where bob
 * has `bobsRole` if given, and in it a task of one working day for each of `tasks`, by title and
 * planned start. Gives alice's browser, her token, and the tasks' ids by title.
 */
async function apollo(
  browser: Browser,
  deployment: Deployment,
  tasks: Record<string, string>,
  bobsRole?: 'read-write' | 'read-only',
) {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const project = idOf(await call(alicesPage, 'POST', '/projects', { name: 'Apollo' }))
  if (bobsRole) {
    await call(alicesPage, 'PUT', `/projects/${project}/members/${bob.id}`, { role: bobsRole })
  }
  const ids: Record<string, string> = {}
  for (const [title, plannedStart] of Object.entries(tasks)) {
    ids[title] = idOf(
      await call(alicesPage, 'POST', `/projects/${project}/tasks`, {
        title,
        plannedStart,
        durationWorkingDays: 1,
      }),
    )
  }
  const token = String(record(await call(alicesPage, 'POST', '/tokens', {}))['secret'])
  return { alice, bob, alicesPage, project, tasks: ids, token }
}

/** A proposal of the groups given, created through the MCP server with the access token. */
async function proposeThroughMcp(deployment: Deployment, token: string, groups: object[][]) {
  const agent = await connectMcp(deployment.url, token)
  try {
    const created = await agent.call('create_proposal', {
      groups: groups.map((changes) => ({ changes })),
    })
    expect(created.isError, JSON.stringify(created.json)).toBe(false)
    return idOf(created.json)
  } finally {
    await agent.close()
  }
}

/** Opens the proposal in the browser, once its preview and review controls are shown. */
async function openProposal(page: Page, proposal: string) {
  await page.goto(`/proposals/${proposal}`)
  await expect(page.getByRole('heading', { name: 'What would change' })).toBeVisible()
  return page.getByRole('region', { name: 'Review' })
}

test('TC-105: a read-write reviewer rejects a proposal', async ({ browser, deployment }) => {
  const { bob, project, tasks, token } = await apollo(
    browser,
    deployment,
    { A: '2027-03-01' },
    'read-write',
  )
  const proposal = await proposeThroughMcp(deployment, token, [[move(tasks.A!, '2027-03-08')]])

  // Step 1: as bob, reject the proposal in the browser.
  const bobsPage = await signedIn(browser, deployment.url, bob)
  const review = await openProposal(bobsPage, proposal)
  await review.getByRole('button', { name: 'Reject proposal' }).click()
  await review.getByRole('button', { name: 'Yes, reject' }).click()
  await expect(bobsPage.getByText('Rejected', { exact: true })).toBeVisible()
  await expect(review.getByRole('button')).toHaveCount(0)

  // Step 2: the proposal is rejected and no longer waits for review; A still starts 2027-03-01.
  const rejected = await read(bobsPage, `/proposals/${proposal}`)
  expect(rejected['status']).toBe('rejected')
  expect(rejected['rejectedBy']).toBe(bob.id)
  expect(await startOf(bobsPage, tasks.A!)).toBe('2027-03-01')
  // The proposal can no longer be approved.
  const approval = await request(bobsPage, 'POST', `/proposals/${proposal}/approval`, {
    projectId: project,
  })
  expect(approval.status).toBe(409)
})

test('TC-109: approving a proposal applies all of its changes', async ({ browser, deployment }) => {
  const { alicesPage, bob, project, tasks, token } = await apollo(
    browser,
    deployment,
    { A: '2027-03-01', B: '2027-03-02' },
    'read-only',
  )
  const proposal = await proposeThroughMcp(deployment, token, [
    [move(tasks.A!, '2027-03-08'), assign(tasks.B!, [bob.id])],
  ])
  const before = await call(alicesPage, 'GET', `/projects/${project}/tasks`)

  // Step 1: as alice, open and approve the proposal in the browser.
  const review = await openProposal(alicesPage, proposal)
  await review.getByRole('button', { name: 'Approve' }).click()
  await expect(review).toContainText('Approved by alice')
  await expect(alicesPage.getByText('Approved', { exact: true })).toBeVisible()

  // Step 2: A starts 2027-03-08 and B's assigned people are [bob]; no other task changed, and
  // nothing else of A and B.
  const a = await read(alicesPage, `/tasks/${tasks.A!}`)
  const b = await read(alicesPage, `/tasks/${tasks.B!}`)
  expect(a['plannedStart']).toBe('2027-03-08')
  expect(b['assignees']).toEqual([bob.id])
  const after = await call(alicesPage, 'GET', `/projects/${project}/tasks`)
  if (!Array.isArray(before) || !Array.isArray(after)) throw new Error('No task lists')
  const withoutChanges = (task: unknown) => {
    const { plannedStart: _s, plannedFinish: _f, assignees: _a, ...rest } = record(task)
    return rest
  }
  expect(after.map(withoutChanges)).toEqual(before.map(withoutChanges))
})

test('TC-111: a plan change after the preview requires the reviewer to confirm again', async ({
  browser,
  deployment,
}) => {
  const { alicesPage, bob, tasks, token } = await apollo(
    browser,
    deployment,
    { A: '2027-03-01', C: '2027-03-15' },
    'read-write',
  )
  const proposal = await proposeThroughMcp(deployment, token, [[move(tasks.A!, '2027-03-08')]])

  // Step 1: as alice, open the proposal in the browser (the preview).
  const review = await openProposal(alicesPage, proposal)

  // Step 2: as bob, move C to 2027-03-16.
  const bobsPage = await signedIn(browser, deployment.url, bob)
  await call(bobsPage, 'PATCH', `/tasks/${tasks.C!}`, { plannedStart: '2027-03-16' })

  // Step 3: as alice, approve the proposal from the preview opened at step 1. The preview is
  // refreshed, showing C on 2027-03-16, and confirmation is asked again.
  await review.getByRole('button', { name: 'Approve' }).click()
  const again = review.getByRole('alert')
  await expect(again).toContainText('The plan changed since you opened this preview')
  await expect(again.getByRole('list', { name: 'Changed in the plan' })).toHaveText(
    'C: start 15 Mar 2027 → 16 Mar 2027, finish 15 Mar 2027 → 16 Mar 2027',
  )
  await expect(
    alicesPage
      .getByRole('table', { name: 'What would change' })
      .getByRole('row', { name: 'A', exact: true }),
  ).toContainText('8 Mar 2027')

  // Step 4: A still starts 2027-03-01, and the proposal still waits for review.
  expect(await startOf(alicesPage, tasks.A!)).toBe('2027-03-01')
  expect((await read(alicesPage, `/proposals/${proposal}`))['status']).toBe('waiting')

  // Step 5: confirm the refreshed preview, and read A again: it starts 2027-03-08.
  await review.getByRole('button', { name: 'Confirm and approve' }).click()
  await expect(review).toContainText('Approved by alice')
  expect(await startOf(alicesPage, tasks.A!)).toBe('2027-03-08')
})

test('TC-098: dropping a group of proposed changes drops every change in it', async ({
  browser,
  deployment,
}) => {
  const { alicesPage, bob, tasks, token } = await apollo(
    browser,
    deployment,
    { A: '2027-03-01', B: '2027-03-02' },
    'read-only',
  )
  const proposal = await proposeThroughMcp(deployment, token, [
    [move(tasks.A!, '2027-03-08'), move(tasks.B!, '2027-03-09')],
    [assign(tasks.A!, [bob.id])],
  ])

  // Step 1: as alice, open the proposal and try to drop only the move of A: the page offers to
  // drop a group as a whole, and nothing that drops one of its changes on its own.
  const review = await openProposal(alicesPage, proposal)
  const g1 = alicesPage.getByRole('listitem', { name: 'Group 1' })
  await expect(g1).toContainText('Change A: planned start 8 Mar 2027')
  await expect(g1.getByRole('button', { name: /drop/i })).toHaveText(['Drop group'])

  // Step 2: drop group G1.
  await g1.getByRole('button', { name: 'Drop group' }).click()
  await expect(alicesPage.getByRole('listitem', { name: 'Group 2' })).toHaveCount(0)
  await expect(alicesPage.getByRole('listitem', { name: 'Group 1' })).toContainText(
    'Change A: assigned',
  )

  // Step 3: approve the proposal.
  await review.getByRole('button', { name: 'Approve' }).click()
  await expect(review).toContainText('Approved by alice')

  // Step 4: A and B are on their old dates, and bob is assigned to A.
  const a = await read(alicesPage, `/tasks/${tasks.A!}`)
  expect(a['plannedStart']).toBe('2027-03-01')
  expect(a['assignees']).toEqual([bob.id])
  expect(await startOf(alicesPage, tasks.B!)).toBe('2027-03-02')
})

test('TC-099: keeping a group of proposed changes keeps every change in it', async ({
  browser,
  deployment,
}) => {
  const { alicesPage, tasks, token } = await apollo(browser, deployment, {
    A: '2027-03-01',
    B: '2027-03-02',
  })
  const proposal = await proposeThroughMcp(deployment, token, [
    [move(tasks.A!, '2027-03-08'), move(tasks.B!, '2027-03-09')],
  ])

  // Step 1: as alice, approve the proposal with G1 kept.
  const review = await openProposal(alicesPage, proposal)
  await expect(alicesPage.getByRole('listitem', { name: 'Group 1' })).toBeVisible()
  await review.getByRole('button', { name: 'Approve' }).click()
  await expect(review).toContainText('Approved by alice')

  // Step 2: A starts 2027-03-08 and B 2027-03-09: neither move without the other.
  expect(await startOf(alicesPage, tasks.A!)).toBe('2027-03-08')
  expect(await startOf(alicesPage, tasks.B!)).toBe('2027-03-09')
})

test("TC-239: an approved proposal's change is logged with both the MCP and the UI channel", async ({
  browser,
  deployment,
}) => {
  const { alicesPage, bob, project, tasks, token } = await apollo(
    browser,
    deployment,
    { A: '2027-03-01' },
    'read-write',
  )
  const proposal = await proposeThroughMcp(deployment, token, [[move(tasks.A!, '2027-03-08')]])

  // Step 1: as bob, approve the proposal in the browser.
  const bobsPage = await signedIn(browser, deployment.url, bob)
  const review = await openProposal(bobsPage, proposal)
  await review.getByRole('button', { name: 'Approve' }).click()
  await expect(review).toContainText('Approved by bob')

  // Step 2: as alice, read the audit log of Apollo, on its page.
  await alicesPage.goto(`/projects/${project}`)
  await alicesPage
    .getByRole('navigation', { name: 'Views' })
    .getByRole('link', { name: 'Audit log' })
    .click()
  const moveOfA = alicesPage
    .getByRole('table', { name: 'Audit log' })
    .getByRole('row')
    .filter({ hasText: 'Task updated' })
    .filter({ hasText: 'planned start' })
  await expect(moveOfA).toHaveCount(1)
  // Both the MCP server and the UI are its channels, and neither the REST API nor GitHub.
  await expect(moveOfA.getByRole('cell').nth(2)).toHaveText('MCP server, approved through UI')
})
