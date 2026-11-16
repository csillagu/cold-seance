import type { Browser, Locator, Page } from '@playwright/test'
import { type Account, expect, test } from '../fixtures.ts'

// The task dialog (#209): one editor of a task, the same in every view, opened by clicking the
// task's title, and offering only what the viewer's role in the task's project allows (FR-106,
// FR-107, FR-108). Each role opens task T from the project's Kanban and Gantt, from a saved
// Kanban and a saved Gantt, and from the person load view, and finds the same dialog with the
// same controls in each. The inputs are put in place through the REST API, in alice's session.

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

/** Calls the REST API from `page`, in its session, failing on an error status. */
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

/** The id of what the API created. */
function idOf(created: unknown): string {
  if (typeof created !== 'object' || created === null || !('id' in created)) {
    throw new Error(`Not a created item: ${JSON.stringify(created)}`)
  }
  return String(created.id)
}

type Role = 'admin' | 'read-write' | 'contributor' | 'read-only'

/** What the dialog must offer each role on T, which is assigned to the contributor. */
async function expectControlsOf(dialog: Locator, role: Role) {
  await expect(dialog.getByRole('heading', { name: 'T', exact: true })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Blocked by' })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Parent' })).toBeVisible()
  const status = dialog.getByRole('combobox', { name: 'Status' })
  switch (role) {
    case 'admin':
    case 'read-write':
      await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue('T')
      await expect(status.getByRole('option', { name: 'Cancelled' })).toHaveCount(1)
      await expect(dialog.getByRole('combobox', { name: 'Add a blocker' })).toBeVisible()
      await expect(dialog.getByRole('combobox', { name: 'Subtask of' })).toBeVisible()
      break
    case 'contributor':
      await expect(status).toBeVisible()
      await expect(status.getByRole('option')).toHaveText([
        'Not started',
        'In progress',
        'On hold',
        'Done',
      ])
      await expect(dialog.getByRole('textbox')).toHaveCount(0)
      await expect(dialog.getByRole('combobox')).toHaveCount(1)
      await expect(dialog.getByLabel('Details')).toContainText('carol')
      break
    case 'read-only':
      await expect(dialog.getByText('Not started')).toBeVisible()
      await expect(dialog.getByRole('textbox')).toHaveCount(0)
      await expect(dialog.getByRole('combobox')).toHaveCount(0)
      await expect(dialog.getByRole('button')).toHaveText(['Close'])
      await expect(dialog.getByLabel('Details')).toContainText('carol')
      break
  }
}

/** Clicks T's title in `within`, checks the dialog it opens for `role`, and closes it. */
async function openT(page: Page, within: Locator, role: Role) {
  await within.getByRole('button', { name: 'Open T', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await expectControlsOf(dialog, role)
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
}

for (const role of ['admin', 'read-write', 'contributor', 'read-only'] as const) {
  test(`the same task dialog opens from every view's task title, for the ${role} role (#209)`, async ({
    browser,
    deployment,
  }) => {
    const alice = await deployment.seedAccount('alice')
    const carol = await deployment.seedAccount('carol')
    // The admin is alice, who creates Apollo; the contributor is carol, whom T is assigned to.
    const viewer =
      role === 'admin'
        ? alice
        : role === 'contributor'
          ? carol
          : await deployment.seedAccount('viewer')
    const alicesPage = await signedIn(browser, deployment.url, alice)
    const apollo = idOf(await call(alicesPage, 'POST', '/projects', { name: 'Apollo' }))
    await call(alicesPage, 'PUT', `/projects/${apollo}/members/${carol.id}`, {
      role: 'contributor',
    })
    if (role === 'read-write' || role === 'read-only') {
      await call(alicesPage, 'PUT', `/projects/${apollo}/members/${viewer.id}`, { role })
    }
    await call(alicesPage, 'POST', `/projects/${apollo}/tasks`, {
      title: 'T',
      plannedStart: '2027-03-01',
      durationWorkingDays: 2,
      assignees: [carol.id],
    })
    const views: Record<string, string> = {}
    for (const kind of ['kanban', 'gantt']) {
      views[kind] = idOf(
        await call(alicesPage, 'POST', '/saved-views', {
          name: `Apollo ${kind}`,
          kind,
          keptIn: 'project',
          projectId: apollo,
        }),
      )
    }
    const page = role === 'admin' ? alicesPage : await signedIn(browser, deployment.url, viewer)

    await page.goto(`/projects/${apollo}/kanban`)
    await openT(page, page.getByRole('group', { name: 'Kanban of Apollo' }), role)

    await page.goto(`/projects/${apollo}/gantt`)
    await openT(page, page.getByRole('table', { name: 'Gantt of Apollo' }), role)

    await page.goto(`/views/${views['kanban']}`)
    await openT(page, page.getByRole('group', { name: 'Apollo kanban' }), role)

    await page.goto(`/views/${views['gantt']}`)
    await openT(page, page.getByRole('table', { name: 'Apollo gantt' }), role)

    await page.goto(`/projects/${apollo}/load?from=2027-03-01&to=2027-03-05`)
    await openT(page, page.getByRole('list', { name: 'Tasks of carol' }), role)

    await page.context().close()
    if (page !== alicesPage) await alicesPage.context().close()
  })
}
