import type { Browser, Locator, Page } from '@playwright/test'
import { connectMcp } from '../../backend/test/helpers/mcp.ts'
import { type Account, type Deployment, expect, ROOT, test } from '../fixtures.ts'

// The audit log viewer (SC-094): the browser steps of the test cases that read the audit log
// (FR-116, FR-138). What a test case's inputs give, projects, roles and renamed tasks, is put in
// place through the REST API, in each person's own session; the log is read on its page. The REST
// sides of these test cases are in backend/test/integration/audit-log.test.ts, and TC-170's
// browser steps in task-details.spec.ts.
//
// TC-172's proposal is created by an MCP client, as an AI agent would, with alice's token. Pending:
// TC-173's browser part, reading T finished through GitHub, is not
// written yet: the webhook endpoint and re-check (SC-105, SC-024) that bring the change to the
// GitHub change handler (SC-023) are in place since #131, and backend/test/integration/
// github-sync.test.ts sends such changes by webhook.

/** A browser of its own for `account`, signed in on the sign-in page. */
async function signedIn(browser: Browser, baseURL: string, account: Account): Promise<Page> {
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  await page.goto('/sign-in')
  await page.getByLabel('Username').fill(account.username)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/')
  return page
}

/**
 * Calls the REST API from `page`, in its session, with `token` in place of the session if given,
 * and gives its parsed answer, failing on an error status.
 */
async function call(
  page: Page,
  method: string,
  path: string,
  data?: unknown,
  token?: string,
): Promise<unknown> {
  const answer = await page.evaluate(
    async (request) => {
      const headers: Record<string, string> = {}
      if (request.data !== undefined) headers['content-type'] = 'application/json'
      if (request.token !== undefined) headers['authorization'] = `Bearer ${request.token}`
      const response = await fetch(`/api${request.path}`, {
        method: request.method,
        headers,
        body: request.data === undefined ? undefined : JSON.stringify(request.data),
        credentials: request.token === undefined ? 'same-origin' : 'omit',
      })
      return { ok: response.ok, text: await response.text() }
    },
    { method, path, data, token },
  )
  expect(answer.ok, `${method} ${path}: ${answer.text}`).toBe(true)
  return JSON.parse(answer.text === '' ? 'null' : answer.text)
}

function field(answer: unknown, name: string): string {
  if (typeof answer !== 'object' || answer === null) throw new Error('The answer is no object')
  const value: unknown = Object.entries(answer).find(([key]) => key === name)?.[1]
  if (typeof value !== 'string') throw new Error(`The answer holds no ${name}`)
  return value
}

/** Creates project `name` as the person of `page`. Gives its id. */
async function createProject(page: Page, name: string): Promise<string> {
  return field(await call(page, 'POST', '/projects', { name }), 'id')
}

/** Creates task `title` in `project` and renames it to `<title> renamed`. Gives its id. */
async function renamedTask(page: Page, project: string, title: string): Promise<string> {
  const task = field(await call(page, 'POST', `/projects/${project}/tasks`, { title }), 'id')
  await call(page, 'PATCH', `/tasks/${task}`, { title: `${title} renamed` })
  return task
}

async function giveRole(page: Page, project: string, account: Account, role: string) {
  await call(page, 'PUT', `/projects/${project}/members/${account.id}`, { role })
}

/** Opens `project`'s audit log, from the project's page. */
async function openProjectLog(page: Page, project: string, name: string) {
  await page.goto(`/projects/${project}`)
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('link', { name: 'Audit log' })
    .click()
}

/** The row of the log that records the renaming of task `title`. */
function renaming(log: Locator, title: string): Locator {
  return log.getByRole('row').filter({ hasText: `title: ${title} → ${title} renamed` })
}

/** Accounts alice, bob and carol, each signed in in a browser of their own. */
async function people(browser: Browser, deployment: Deployment) {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const carol = await deployment.seedAccount('carol')
  return {
    alice,
    bob,
    carol,
    alicePage: await signedIn(browser, deployment.url, alice),
    bobPage: await signedIn(browser, deployment.url, bob),
    carolPage: await signedIn(browser, deployment.url, carol),
  }
}

test('TC-203: a system admin reads the whole audit log', async ({ browser, deployment }) => {
  const { alicePage, bobPage } = await people(browser, deployment)
  const apollo = await createProject(alicePage, 'Apollo')
  await renamedTask(alicePage, apollo, 'A')
  const borealis = await createProject(bobPage, 'Borealis')
  await renamedTask(bobPage, borealis, 'B')

  // Step 1: as root, with no role in either project, read the audit log, from the navigation.
  const root = await signedIn(browser, deployment.url, { id: '', ...ROOT })
  await root
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Audit log' })
    .click()
  await expect(root.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible()
  const log = root.getByRole('table', { name: 'Audit log' })

  // The log shows the renaming of A and of B; no entry is withheld for lack of a project role.
  await expect(renaming(log, 'A')).toHaveCount(1)
  await expect(renaming(log, 'A').getByRole('cell').nth(1)).toHaveText('alice')
  await expect(renaming(log, 'B')).toHaveCount(1)
  await expect(renaming(log, 'B').getByRole('cell').nth(1)).toHaveText('bob')
})

test("TC-204: project admins and read-write members read only their projects' audit log", async ({
  browser,
  deployment,
}) => {
  const { alicePage, bobPage, carolPage, alice, carol } = await people(browser, deployment)
  const apollo = await createProject(alicePage, 'Apollo')
  await giveRole(alicePage, apollo, carol, 'read-write')
  await renamedTask(alicePage, apollo, 'A')
  const borealis = await createProject(bobPage, 'Borealis')
  await giveRole(bobPage, borealis, alice, 'read-only')
  await giveRole(bobPage, borealis, carol, 'read-only')
  await renamedTask(bobPage, borealis, 'B')

  // Steps 1 and 2: alice, then carol, reads Apollo's log, then tries Borealis's.
  for (const page of [alicePage, carolPage]) {
    await openProjectLog(page, apollo, 'Apollo')
    const log = page.getByRole('table', { name: 'Audit log' })
    await expect(renaming(log, 'A')).toHaveCount(1)
    // Negative: the read shows no renaming of B.
    await expect(page.locator('main')).not.toContainText('B renamed')

    await openProjectLog(page, borealis, 'Borealis')
    await expect(page.getByRole('alert')).toContainText(
      "Only system admins and the project's admins and read-write members can read its audit log",
    )
    await expect(page.getByRole('table', { name: 'Audit log' })).toHaveCount(0)
    await expect(page.locator('main')).not.toContainText('B renamed')

    // Nor is the whole log open to them.
    await page.goto('/audit-log')
    await expect(page.getByRole('alert')).toContainText(
      'Only system admins can read the whole audit log',
    )
    await expect(page.locator('main')).not.toContainText('B renamed')
  }
})

test('TC-205: read-only members and contributors are refused the audit log', async ({
  browser,
  deployment,
}) => {
  const { alicePage, bobPage, carolPage, bob, carol } = await people(browser, deployment)
  const apollo = await createProject(alicePage, 'Apollo')
  await giveRole(alicePage, apollo, bob, 'read-only')
  await giveRole(alicePage, apollo, carol, 'contributor')
  await renamedTask(alicePage, apollo, 'A')

  // Steps 1 and 2: bob, then carol, tries to read Apollo's log.
  for (const page of [bobPage, carolPage]) {
    await openProjectLog(page, apollo, 'Apollo')
    await expect(page.getByRole('alert')).toContainText(
      "Only system admins and the project's admins and read-write members can read its audit log",
    )
    // Negative: neither sees the renaming of A.
    await expect(page.getByRole('table', { name: 'Audit log' })).toHaveCount(0)
    await expect(page.locator('main')).not.toContainText('A renamed')
  }
})

test('TC-171: a change through the REST API is logged with the REST API channel', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  const task = field(
    await call(page, 'POST', `/projects/${apollo}/tasks`, { title: 'Draft' }),
    'id',
  )
  const token = field(await call(page, 'POST', '/tokens', {}), 'secret')

  // Step 1: with alice's token, change T's title to Final through the REST API, at t.
  const t = Date.now()
  await call(page, 'PATCH', `/tasks/${task}`, { title: 'Final' }, token)

  // Step 2: as alice, read Apollo's audit log, on its page.
  await openProjectLog(page, apollo, 'Apollo')
  const entry = page
    .getByRole('table', { name: 'Audit log' })
    .getByRole('row')
    .filter({ hasText: 'title: Draft → Final' })
  await expect(entry).toHaveCount(1)
  const cells = entry.getByRole('cell')
  await expect(cells.nth(1)).toHaveText('alice')
  // Negative: the entry does not give the UI as its channel.
  await expect(cells.nth(2)).toHaveText('REST API')
  const at = new Date((await entry.locator('time').getAttribute('datetime')) ?? '').getTime()
  expect(Math.abs(at - t)).toBeLessThan(60_000)
})

test('TC-172: creating a proposal through the MCP server is logged with the MCP channel', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  const task = field(
    await call(page, 'POST', `/projects/${apollo}/tasks`, {
      title: 'T',
      plannedStart: '2027-03-01',
      durationWorkingDays: 1,
    }),
    'id',
  )
  const token = field(await call(page, 'POST', '/tokens', {}), 'secret')

  // Step 1: through the MCP server with alice's token, create a proposal moving T, at t.
  const agent = await connectMcp(deployment.url, token)
  const t = Date.now()
  const created = await agent.call('create_proposal', {
    groups: [
      {
        changes: [
          { kind: 'update-task', task: { taskId: task }, fields: { plannedStart: '2027-03-02' } },
        ],
      },
    ],
  })
  await agent.close()
  expect(created.isError, JSON.stringify(created.json)).toBe(false)

  // Step 2: as alice, read Apollo's audit log, on its page.
  await openProjectLog(page, apollo, 'Apollo')
  const log = page.getByRole('table', { name: 'Audit log' })
  const entry = log.getByRole('row').filter({ hasText: 'Proposal created' })
  await expect(entry).toHaveCount(1)
  const cells = entry.getByRole('cell')
  await expect(cells.nth(1)).toHaveText('alice')
  await expect(cells.nth(2)).toHaveText('MCP server')
  const at = new Date((await entry.locator('time').getAttribute('datetime')) ?? '').getTime()
  expect(Math.abs(at - t)).toBeLessThan(60_000)
  // Negative: no entry records a change to T itself.
  await expect(log.getByRole('row').filter({ hasText: 'Task updated' })).toHaveCount(0)
})
