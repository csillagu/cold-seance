import type { Browser, Page } from '@playwright/test'
import { type Account, type Deployment, expect, test } from '../fixtures.ts'

// The test cases that open every view kind of a project one after the other (FR-047, FR-106): the
// Kanban (SC-030), the Gantt (SC-031), the person load view (SC-032) and the baseline variance
// view (SC-033), and a saved view (SC-020). Each view's own test cases are in its spec file; these
// check that all of them open for the same project, in one go. The inputs are put in place through
// the REST API, in alice's browser session; the reads of TC-154's step 2 are made through the REST
// API with bob's personal access token, as an outside client would.

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

/** `value` as an object of the API's answer, failing if it is not one. */
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`The answer is not an object: ${JSON.stringify(value)}`)
  }
  return { ...value }
}

const idOf = (created: unknown) => String(record(created)['id'])

/**
 * Account `alice`, signed in, and project `Apollo` she creates, holding task `T` as `task` gives
 * it, and baseline `v1` saved after it.
 */
async function apolloWithT(browser: Browser, deployment: Deployment, task: object) {
  const alice = await deployment.seedAccount('alice')
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const apollo = idOf(await call(alicesPage, 'POST', '/projects', { name: 'Apollo' }))
  const t = idOf(
    await call(alicesPage, 'POST', `/projects/${apollo}/tasks`, {
      title: 'T',
      plannedStart: '2027-03-01',
      ...task,
    }),
  )
  const v1 = idOf(await call(alicesPage, 'POST', `/projects/${apollo}/baselines`, { name: 'v1' }))
  return { alice, alicesPage, apollo, t, v1 }
}

/** Opens project `name` from the navigation, then its view `view` from the project's views. */
async function openView(page: Page, name: string, view: string) {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Navigation' }).getByRole('link', { name }).click()
  await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: view }).click()
}

/**
 * Opens the Kanban, the Gantt, the person load view and the baseline variance view of `Apollo`,
 * one after the other, and checks that each opens, refuses nothing and shows T.
 */
async function openTheFourViews(page: Page, plannedText: string) {
  await openView(page, 'Apollo', 'Kanban')
  const kanban = page.getByRole('group', { name: 'Kanban of Apollo' })
  await expect(kanban.getByRole('article', { name: 'T', exact: true })).toContainText(plannedText)
  await expect(page.getByRole('alert')).toHaveCount(0)

  await openView(page, 'Apollo', 'Gantt')
  const gantt = page.getByRole('table', { name: 'Gantt of Apollo' })
  await expect(
    gantt.getByRole('row', { name: 'T', exact: true }).getByRole('img', { name: /^T: / }),
  ).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)

  await openView(page, 'Apollo', 'Person load')
  await page.getByLabel('From').fill('2027-03-01')
  await page.getByLabel('To').fill('2027-03-05')
  await page.getByRole('button', { name: 'Show' }).click()
  await expect(page.getByRole('table', { name: 'Person load of Apollo' })).toBeVisible()
  await expect(page.getByRole('main').getByRole('link', { name: 'T', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)

  await openView(page, 'Apollo', 'Baseline variance')
  const variance = page.getByRole('table', { name: 'Baseline variance of Apollo against v1' })
  await expect(variance.getByRole('row', { name: 'T', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
}

test('TC-064: the four view kinds are available for a project', async ({ browser, deployment }) => {
  const { alicesPage, apollo } = await apolloWithT(browser, deployment, { durationWorkingDays: 2 })
  const before = await call(alicesPage, 'GET', `/projects/${apollo}/tasks`)

  // Step 1: as alice, open the Kanban, the Gantt, the person load view and the baseline variance
  // view of Apollo, one after the other. Each opens and shows T.
  await openTheFourViews(alicesPage, '1–2 Mar · 2d')

  // Negative: opening a view changes no task.
  expect(await call(alicesPage, 'GET', `/projects/${apollo}/tasks`)).toEqual(before)

  await alicesPage.context().close()
})

test("TC-154: a read-only member sees every view and the project's data", async ({
  browser,
  deployment,
}) => {
  const bob = await deployment.seedAccount('bob')
  const { alice, alicesPage, apollo, t, v1 } = await apolloWithT(browser, deployment, {
    durationWorkingDays: 1,
  })
  await call(alicesPage, 'PATCH', `/tasks/${t}`, { assignees: [alice.id] })
  await call(alicesPage, 'PUT', `/projects/${apollo}/members/${bob.id}`, { role: 'read-only' })
  await call(alicesPage, 'POST', '/saved-views', {
    name: 'Board',
    kind: 'kanban',
    keptIn: 'project',
    projectId: apollo,
  })

  // Step 1: as bob, open the Kanban, the Gantt, the person load view, the baseline variance view
  // and Board for Apollo. Every view opens and shows T; none refuses bob access.
  const bobsPage = await signedIn(browser, deployment.url, bob)
  await openTheFourViews(bobsPage, '1 Mar · 1d')
  await openView(bobsPage, 'Apollo', 'Saved views')
  await bobsPage.getByRole('main').getByRole('link', { name: 'Board', exact: true }).click()
  await expect(
    bobsPage.getByRole('group', { name: 'Board' }).getByRole('article', { name: 'T', exact: true }),
  ).toContainText('1 Mar · 1d')
  await expect(bobsPage.getByRole('alert')).toHaveCount(0)

  // Step 2: read T and v1 through the REST API, with bob's token. Both reads succeed.
  const token = String(record(await call(bobsPage, 'POST', '/tokens', {}))['secret'])
  const read = async (path: string) => {
    const response = await fetch(`${deployment.url}/api${path}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.status, `GET ${path}`).toBe(200)
    return record(await response.json())
  }
  expect(await read(`/tasks/${t}`)).toMatchObject({ id: t, title: 'T' })
  expect(await read(`/baselines/${v1}`)).toMatchObject({ id: v1, name: 'v1' })

  await alicesPage.context().close()
  await bobsPage.context().close()
})
