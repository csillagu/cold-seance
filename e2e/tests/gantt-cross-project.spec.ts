import type { Browser, Page } from '@playwright/test'
import { type Account, expect, test } from '../fixtures.ts'

// The cross-project dependency lines (SC-066): the browser steps of the test cases it takes part
// in. The inputs are put in place through the REST API, in the browser's own session.
//
// Pending: TC-088's step, which opens "a personal Gantt view of alice's covering Apollo and
// Borealis": saved views (SC-020, B06) and their editor (SC-091, F22) are not built, so no Gantt
// covers several projects yet. The Gantt draws a dependency on another project's milestone, red
// or not, when given both projects' tasks (frontend/src/gantt/cross-project.test.tsx), and the
// view that gives them is those nodes'. TC-227's step 1 looks at the red dependency on such a view
// for the same reason only once they are built; here it looks at M, T's red bar on Apollo's Gantt
// and each of Borealis's views.

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
  const parsed: unknown = JSON.parse(answer.text)
  return parsed
}

/** The id of what the REST API created, from its answer. */
function idOf(created: unknown): string {
  if (typeof created !== 'object' || created === null || !('id' in created)) {
    throw new Error('The answer holds no id')
  }
  return String(created.id)
}

/** Creates a task in `project` and gives its id. */
async function createTask(page: Page, project: string, fields: Record<string, unknown>) {
  return idOf(await call(page, 'POST', `/projects/${project}/tasks`, fields))
}

/** Makes `task` blocked by `blocker`. */
async function block(page: Page, task: string, blocker: string) {
  await call(page, 'POST', `/tasks/${task}/blocked-by`, { blockerId: blocker })
}

/** The project `name`, created by the person signed in on `page`; gives its id. */
async function createProject(page: Page, name: string): Promise<string> {
  return idOf(await call(page, 'POST', '/projects', { name }))
}

/** What would name an action to ask another project for a change. */
const ASK_FOR_CHANGE = /(request|ask|propose|suggest).*change|change request/i

/** Any button, link or menu item on `page` that offers to ask for a change. */
const changeRequest = (page: Page) =>
  page
    .getByRole('button', { name: ASK_FOR_CHANGE })
    .or(page.getByRole('link', { name: ASK_FOR_CHANGE }))
    .or(page.getByRole('menuitem', { name: ASK_FOR_CHANGE }))

test('TC-227: there is no way to request a change in another project (step 1)', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const bobsPage = await signedIn(browser, deployment.url, bob)
  const borealis = await createProject(bobsPage, 'Borealis')
  await call(bobsPage, 'PUT', `/projects/${borealis}/members/${alice.id}`, { role: 'read-only' })
  const m = await createTask(bobsPage, borealis, {
    title: 'M',
    milestone: { variant: 'fixed-date', date: '2027-03-17' },
  })
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(alicesPage, 'Apollo')
  const t = await createTask(alicesPage, apollo, {
    title: 'T',
    plannedStart: '2027-03-11',
    durationWorkingDays: 1,
  })
  await block(alicesPage, t, m)

  // Step 1, as alice: M itself offers no action to ask Borealis to change it.
  await alicesPage.goto(`/tasks/${m}`)
  await expect(alicesPage.getByRole('heading', { name: 'M', exact: true })).toBeVisible()
  await expect(changeRequest(alicesPage)).toHaveCount(0)

  // T is red on Apollo's Gantt, for the dependency on M, and nothing there offers to ask for a
  // change either.
  await alicesPage.goto('/')
  await alicesPage
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Apollo' })
    .click()
  const views = alicesPage.getByRole('navigation', { name: 'Views' })
  await views.getByRole('link', { name: 'Gantt', exact: true }).click()
  const gantt = alicesPage.getByRole('table', { name: 'Gantt of Apollo' })
  await expect(gantt.getByRole('row', { name: 'T', exact: true })).toHaveAttribute(
    'data-red',
    'true',
  )
  await expect(changeRequest(alicesPage)).toHaveCount(0)

  // Each of Borealis's views offers none.
  await alicesPage.goto('/')
  await alicesPage
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Borealis' })
    .click()
  for (const view of ['Kanban', 'Gantt', 'Person load', 'Baseline variance', 'Proposals']) {
    const link = views.getByRole('link', { name: view, exact: true })
    await link.click()
    await expect(link).toHaveAttribute('aria-current', 'page')
    await alicesPage.waitForLoadState('networkidle')
    await expect(changeRequest(alicesPage), `on Borealis's ${view}`).toHaveCount(0)
  }

  await alicesPage.context().close()
  await bobsPage.context().close()
})
