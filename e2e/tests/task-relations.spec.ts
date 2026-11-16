import type { Browser, Page } from '@playwright/test'
import { type Account, type Deployment, expect, test } from '../fixtures.ts'

// The task relation editor (SC-101), on a task's page: the browser parts of the test cases it
// takes part in. The inputs are put in place through the REST API, in each browser's own session;
// the change each test case makes is tried in the editor, and the relations are read back through
// the REST API, as the test cases say. The REST sides of TC-022, TC-023 and TC-024 are in
// backend/test/integration/task-relations.test.ts.

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
  return JSON.parse(answer.text === '' ? 'null' : answer.text)
}

function idOf(created: unknown): string {
  if (typeof created !== 'object' || created === null || !('id' in created)) {
    throw new Error('The answer holds no id')
  }
  return String(created.id)
}

/** A task's blockers, as `{ id, projectId }`, read through the REST API. */
async function blockersOf(page: Page, task: string): Promise<unknown> {
  const relations = await call(page, 'GET', `/tasks/${task}/relations`)
  if (typeof relations !== 'object' || relations === null || !('blockedBy' in relations)) {
    throw new Error('The answer holds no relations')
  }
  return relations.blockedBy
}

/** alice, signed in, and project `Apollo` she creates; `createTask` creates a task in it. */
async function apolloOf(browser: Browser, deployment: Deployment) {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = idOf(await call(page, 'POST', '/projects', { name: 'Apollo' }))
  const createTask = async (title: string) =>
    idOf(await call(page, 'POST', `/projects/${apollo}/tasks`, { title }))
  return { alice, page, apollo, createTask }
}

/** Opens the page of the task `task`, and waits for its relation editor. */
async function openTask(page: Page, task: string, title: string) {
  await page.goto(`/tasks/${task}`)
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Blocked by' })).toBeVisible()
}

const blockedBy = (page: Page) => page.getByRole('group', { name: 'Blocked by' })

test('TC-022: a blocked-by relation that closes a cycle is rejected (browser)', async ({
  browser,
  deployment,
}) => {
  const { page, apollo, createTask } = await apolloOf(browser, deployment)
  const a = await createTask('A')
  const b = await createTask('B')
  const c = await createTask('C')
  await call(page, 'POST', `/tasks/${a}/blocked-by`, { blockerId: b })
  await call(page, 'POST', `/tasks/${b}/blocked-by`, { blockerId: c })

  // Step 1: make C blocked by A, in the editor. It is rejected, and the reason is shown.
  await openTask(page, c, 'C')
  await page.getByLabel('Add a blocker').selectOption({ label: 'A' })
  await page.getByRole('button', { name: 'Add blocker' }).click()
  await expect(page.getByRole('alert')).toContainText('would create a cycle')
  await expect(blockedBy(page)).toContainText('Not blocked by anything.')

  // Step 2: the relations are exactly A blocked by B and B blocked by C; C is not blocked by A.
  expect(await blockersOf(page, a)).toEqual([{ id: b, projectId: apollo }])
  expect(await blockersOf(page, b)).toEqual([{ id: c, projectId: apollo }])
  expect(await blockersOf(page, c)).toEqual([])

  await page.context().close()
})

test("TC-023: a task can be blocked by another project's milestone (browser)", async ({
  browser,
  deployment,
}) => {
  const { alice, page, apollo, createTask } = await apolloOf(browser, deployment)
  const bob = await deployment.seedAccount('bob')
  const bobs = await signedIn(browser, deployment.url, bob)
  const borealis = idOf(await call(bobs, 'POST', '/projects', { name: 'Borealis' }))
  await call(bobs, 'PUT', `/projects/${borealis}/members/${alice.id}`, { role: 'read-only' })
  const m = idOf(
    await call(bobs, 'POST', `/projects/${borealis}/tasks`, {
      title: 'M',
      milestone: { variant: 'fixed-date', date: '2027-03-12' },
    }),
  )
  const mBefore = await call(bobs, 'GET', `/tasks/${m}`)
  const t = await createTask('T')

  // Step 1: as alice, make T blocked by M, picked from Borealis's milestones in the editor.
  await openTask(page, t, 'T')
  await page.getByLabel("Blocker's project").selectOption({ label: 'Borealis' })
  const milestones = page.getByLabel('Add a milestone as blocker')
  await expect(milestones.getByRole('option', { name: 'M', exact: true })).toBeAttached()
  await milestones.selectOption({ label: 'M' })
  await page.getByRole('button', { name: 'Add blocker' }).click()
  await expect(blockedBy(page).getByRole('listitem', { name: 'M (Borealis)' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)

  // Step 2: T is blocked by M, and the relation is T's, held in Apollo.
  expect(await blockersOf(page, t)).toEqual([{ id: m, projectId: borealis }])
  expect(await call(page, 'GET', `/tasks/${t}`)).toMatchObject({ projectId: apollo })

  // Negative: M is unchanged, and Borealis's plan records no new relation on it.
  expect(await call(bobs, 'GET', `/tasks/${m}`)).toEqual(mBefore)
  expect(await blockersOf(bobs, m)).toEqual([])

  await bobs.context().close()
  await page.context().close()
})

test("TC-024: depending on an unreadable project's milestone is rejected (browser)", async ({
  browser,
  deployment,
}) => {
  const { page, createTask } = await apolloOf(browser, deployment)
  const bob = await deployment.seedAccount('bob')
  const bobs = await signedIn(browser, deployment.url, bob)
  // alice has no role in Borealis, directly or through a group.
  const borealis = idOf(await call(bobs, 'POST', '/projects', { name: 'Borealis' }))
  // M's identifier, taken from bob's view of it.
  const m = idOf(
    await call(bobs, 'POST', `/projects/${borealis}/tasks`, {
      title: 'M',
      milestone: { variant: 'fixed-date', date: '2027-03-12' },
    }),
  )
  const t = await createTask('T')

  // Step 1: as alice, try to make T blocked by M, giving M's identifier. Borealis is not offered
  // to pick from; the identifier is refused, and she is told only that the project is not visible.
  await openTask(page, t, 'T')
  await expect(
    page.getByLabel("Blocker's project").getByRole('option', { name: 'Borealis' }),
  ).toHaveCount(0)
  await page.getByLabel("Or a milestone's identifier").fill(m)
  await page.getByRole('button', { name: 'Add by identifier' }).click()
  await expect(page.getByRole('alert')).toHaveText('This project is not visible to you')
  await expect(page.getByText('M', { exact: true })).toHaveCount(0)
  await expect(blockedBy(page)).toContainText('Not blocked by anything.')

  // Step 2: T has no blocked-by relations.
  expect(await blockersOf(page, t)).toEqual([])

  await bobs.context().close()
  await page.context().close()
})

test('TC-169: a cycle is rejected alike through the UI, the REST API and the MCP server (step 1, in the UI)', async ({
  browser,
  deployment,
}) => {
  const { page, createTask } = await apolloOf(browser, deployment)
  const a = await createTask('A')
  const b = await createTask('B')
  await call(page, 'POST', `/tasks/${a}/blocked-by`, { blockerId: b })

  // Step 1: as alice, try to make B blocked by A in the UI. It is rejected.
  await openTask(page, b, 'B')
  await page.getByLabel('Add a blocker').selectOption({ label: 'A' })
  await page.getByRole('button', { name: 'Add blocker' }).click()
  await expect(page.getByRole('alert')).toContainText('would create a cycle')

  // Steps 2 and 3, through the REST API and the MCP server, are in rest-api.spec.ts, which takes
  // the test case in full.

  // Step 4: B is not blocked by A.
  expect(await blockersOf(page, b)).toEqual([])

  await page.context().close()
})
