import type { Browser, Locator, Page } from '@playwright/test'
import { type Account, expect, test } from '../fixtures.ts'

// The baseline variance view (SC-033) and the baseline save dialog (SC-097): the browser steps of
// the test cases they make pass, in full or in part. What the view shows comes from the REST API,
// whose part of each test case (the baselines, SC-009; the variance, SC-044) is tested in
// backend/test/integration/. The other inputs are put in place through the REST API, in the
// browser's own session; the baselines the test cases save in the browser are saved in the dialog.

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

/** Creates a project named `name` and gives its id. */
async function createProject(page: Page, name: string): Promise<string> {
  return idOf(await call(page, 'POST', '/projects', { name }))
}

/** Creates a task in `project` and gives its id. */
async function createTask(page: Page, project: string, fields: Record<string, unknown>) {
  return idOf(await call(page, 'POST', `/projects/${project}/tasks`, fields))
}

/** Opens the baseline variance view of the project `name` from the navigation. */
async function openVariance(page: Page, name: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Navigation' }).getByRole('link', { name }).click()
  await page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('link', { name: 'Baseline variance' })
    .click()
}

/** The table of the view, comparing project `name` against baseline `baseline`. */
function table(page: Page, name: string, baseline: string): Locator {
  return page.getByRole('table', { name: `Baseline variance of ${name} against ${baseline}` })
}

/** The row of the task titled `title`. */
const row = (view: Locator, title: string) => view.getByRole('row', { name: title, exact: true })

/** A row's cells: task, planned, baseline, actual, start variance, finish variance, timeline. */
const cell = (view: Locator, title: string, column: number) =>
  row(view, title).getByRole('cell').nth(column)
const PLANNED = 1
const BASELINE = 2
const ACTUAL = 3

/** Selects the baseline named `name` in the view's baseline picker. */
async function selectBaseline(page: Page, name: string): Promise<void> {
  const picker = page.getByRole('combobox', { name: 'Baseline' })
  const option = picker.getByRole('option', { name: new RegExp(`^${name} · saved `) })
  await picker.selectOption((await option.getAttribute('value')) ?? '')
}

/** Saves a baseline named `name` in the baseline save dialog, and gives the dialog. */
async function saveInDialog(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Save baseline' }).click()
  const dialog = page.getByRole('dialog', { name: 'Save baseline' })
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByRole('button', { name: 'Save' }).click()
  return dialog
}

/** `date` as the view writes a day: `13 Nov`. */
function shortDay(date: Date): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  return `${date.getDate()} ${months[date.getMonth()]}`
}

test('TC-007: an unscheduled task appears in the baseline variance view', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  await createTask(page, apollo, {
    title: 'Write guide',
    plannedStart: '2027-03-01',
    durationWorkingDays: 2,
  })
  await call(page, 'POST', `/projects/${apollo}/baselines`, { name: 'v1' })
  const backlog = await createTask(page, apollo, { title: 'Triage backlog' })

  // Step 1: as alice, open the view of Apollo with v1 selected, the only baseline.
  await openVariance(page, 'Apollo')
  const view = table(page, 'Apollo', 'v1')
  await expect(page.getByRole('combobox', { name: 'Baseline' })).toHaveValue(/^[0-9a-f-]{36}$/)

  // Triage backlog is shown, among the unscheduled tasks, and so is Write guide.
  await expect(row(view, 'Triage backlog')).toBeVisible()
  await expect(view.getByRole('rowheader', { name: /^Unscheduled/ })).toBeVisible()
  await expect(row(view, 'Write guide')).toBeVisible()
  await expect(cell(view, 'Write guide', PLANNED)).toHaveText('1–2 Mar')

  // Negative: showing it gives Triage backlog no dates.
  for (const column of [PLANNED, BASELINE, ACTUAL]) {
    await expect(cell(view, 'Triage backlog', column)).toHaveText('—')
  }
  expect(await call(page, 'GET', `/tasks/${backlog}`)).toMatchObject({
    plannedStart: null,
    plannedFinish: null,
  })

  await page.context().close()
})

test('TC-070: the baseline variance view allows no edits', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  const t = await createTask(page, apollo, {
    title: 'T',
    plannedStart: '2027-03-01',
    durationWorkingDays: 3,
  })
  const v1 = idOf(await call(page, 'POST', `/projects/${apollo}/baselines`, { name: 'v1' }))
  const taskBefore = await call(page, 'GET', `/tasks/${t}`)
  const baselineBefore = await call(page, 'GET', `/baselines/${v1}`)

  // Step 1: as alice, open the view of Apollo with v1 selected.
  await openVariance(page, 'Apollo')
  const view = table(page, 'Apollo', 'v1')
  await expect(row(view, 'T')).toBeVisible()

  // Step 2: try to change T's title, its planned dates and v1's dates, by clicking,
  // double-clicking and dragging each shown value.
  for (const column of [0, PLANNED, BASELINE]) {
    const value = cell(view, 'T', column)
    await value.click()
    await value.dblclick()
    const box = await value.boundingBox()
    if (!box) throw new Error('The value is not shown')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 5 })
    await page.mouse.up()

    // No value in the view can be edited: nothing opens to edit it, and it stays as it was.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(view.locator('input, textarea, select, [contenteditable="true"]')).toHaveCount(0)
  }
  await expect(view.getByRole('button')).toHaveCount(0)
  await expect(cell(view, 'T', PLANNED)).toHaveText('1–3 Mar')
  await expect(cell(view, 'T', BASELINE)).toHaveText('1–3 Mar')

  // Negative: T and v1 read back through the REST API exactly as before.
  expect(await call(page, 'GET', `/tasks/${t}`)).toEqual(taskBefore)
  expect(await call(page, 'GET', `/baselines/${v1}`)).toEqual(baselineBefore)

  await page.context().close()
})

test('TC-224: the baseline variance view shows planned, baseline and actual dates side by side', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  const t = await createTask(page, apollo, {
    title: 'T',
    plannedStart: '2027-03-01',
    durationWorkingDays: 3,
  })
  await call(page, 'POST', `/projects/${apollo}/baselines`, { name: 'v1' })
  await call(page, 'PATCH', `/tasks/${t}`, { plannedStart: '2027-03-08' })
  await call(page, 'PUT', `/tasks/${t}/status`, { status: 'in-progress' })
  // D, the day the test runs, in the local time zone the backend records it in.
  const d = new Date()

  // Step 1: as alice, open the view of Apollo with v1 selected.
  await openVariance(page, 'Apollo')
  const view = table(page, 'Apollo', 'v1')

  // T's row shows its planned dates, its baseline dates and its actual start D, side by side.
  await expect(cell(view, 'T', PLANNED)).toHaveText('8–10 Mar')
  await expect(cell(view, 'T', PLANNED)).toHaveAttribute('title', '8 Mar 2027 to 10 Mar 2027')
  await expect(cell(view, 'T', BASELINE)).toHaveText('1–3 Mar')
  await expect(cell(view, 'T', BASELINE)).toHaveAttribute('title', '1 Mar 2027 to 3 Mar 2027')
  await expect(cell(view, 'T', ACTUAL)).toHaveText(`${shortDay(d)} –`)

  // Negative: no actual finish is shown for T.
  await expect(cell(view, 'T', ACTUAL)).toHaveAttribute('title', /, not finished$/)

  await page.context().close()
})

test("TC-090: a named baseline keeps a snapshot of every task's planned dates (the browser)", async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  const a = await createTask(page, apollo, {
    title: 'A',
    plannedStart: '2027-03-01',
    durationWorkingDays: 3,
  })
  await createTask(page, apollo, { title: 'B', plannedStart: '2027-03-08', durationWorkingDays: 2 })

  // Step 1: as alice, save a baseline of Apollo named "v1 approved", in the save dialog.
  await openVariance(page, 'Apollo')
  const dialog = await saveInDialog(page, 'v1 approved')
  await expect(dialog).toHaveCount(0)
  await expect(table(page, 'Apollo', 'v1 approved')).toBeVisible()

  // Step 2: move A to start on 2027-03-15.
  await call(page, 'PATCH', `/tasks/${a}`, { plannedStart: '2027-03-15' })

  // Step 3: read baseline "v1 approved", in the view. Its reading through the REST API is in
  // backend/test/integration/baselines.test.ts.
  await page.reload()
  const view = table(page, 'Apollo', 'v1 approved')
  await expect(cell(view, 'A', BASELINE)).toHaveAttribute('title', '1 Mar 2027 to 3 Mar 2027')
  await expect(cell(view, 'B', BASELINE)).toHaveAttribute('title', '8 Mar 2027 to 9 Mar 2027')

  // Negative: the baseline does not follow the move of A.
  await expect(cell(view, 'A', PLANNED)).toHaveAttribute('title', '15 Mar 2027 to 17 Mar 2027')
  await expect(cell(view, 'A', BASELINE)).toHaveText('1–3 Mar')

  await page.context().close()
})

test('TC-091: saving a baseline without the read-write role is rejected (the browser)', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const carol = await deployment.seedAccount('carol')
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(alicesPage, 'Apollo')
  await call(alicesPage, 'PUT', `/projects/${apollo}/members/${carol.id}`, {
    role: 'contributor',
  })
  await createTask(alicesPage, apollo, {
    title: 'T',
    plannedStart: '2027-03-01',
    durationWorkingDays: 1,
  })

  // Step 1, bob's attempt through the REST API, is in backend/test/integration/baselines.test.ts.
  // Step 2: as carol, a contributor, try to save a baseline named "carol's" in the save dialog.
  const carolsPage = await signedIn(browser, deployment.url, carol)
  await openVariance(carolsPage, 'Apollo')
  const dialog = await saveInDialog(carolsPage, "carol's")

  // The attempt is rejected.
  await expect(dialog.getByRole('alert')).toHaveText(
    "Only the project's read-write members and admins can save a baseline",
  )
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // Step 3 and the negative: Apollo has no baselines.
  await expect(carolsPage.getByText(/No baseline of Apollo has been saved yet/)).toBeVisible()
  expect(await call(alicesPage, 'GET', `/projects/${apollo}/baselines`)).toEqual([])

  await alicesPage.context().close()
  await carolsPage.context().close()
})

test('TC-225: a project keeps several named baselines (the browser)', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  const t = await createTask(page, apollo, {
    title: 'T',
    plannedStart: '2027-03-01',
    durationWorkingDays: 1,
  })

  // Step 1: as alice, save baseline "v1 approved".
  await openVariance(page, 'Apollo')
  await saveInDialog(page, 'v1 approved')
  await expect(table(page, 'Apollo', 'v1 approved')).toBeVisible()

  // Step 2: move T to 2027-03-08 and save baseline "v2 after re-plan".
  await call(page, 'PATCH', `/tasks/${t}`, { plannedStart: '2027-03-08' })
  await page.reload()
  await saveInDialog(page, 'v2 after re-plan')
  await expect(table(page, 'Apollo', 'v2 after re-plan')).toBeVisible()

  // Step 3: list the baselines of Apollo and read each. Both are listed under their names.
  const picker = page.getByRole('combobox', { name: 'Baseline' })
  await expect(picker.getByRole('option')).toHaveText([
    /^v1 approved · saved /,
    /^v2 after re-plan · saved /,
  ])
  // v2 after re-plan holds T on 2027-03-08.
  await expect(cell(table(page, 'Apollo', 'v2 after re-plan'), 'T', BASELINE)).toHaveAttribute(
    'title',
    '8 Mar 2027',
  )
  // v1 approved holds T on 2027-03-01: saving v2 did not replace or change it.
  await selectBaseline(page, 'v1 approved')
  await expect(cell(table(page, 'Apollo', 'v1 approved'), 'T', BASELINE)).toHaveAttribute(
    'title',
    '1 Mar 2027',
  )

  await page.context().close()
})

test('TC-064: the four view kinds are available for a project (the baseline variance view)', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  await createTask(page, apollo, { title: 'T', plannedStart: '2027-03-01', durationWorkingDays: 2 })
  await call(page, 'POST', `/projects/${apollo}/baselines`, { name: 'v1' })
  const before = await call(page, 'GET', `/projects/${apollo}/tasks`)

  // Step 1, the baseline variance view: it opens and shows T. The Kanban is in kanban.spec.ts, the
  // Gantt in gantt.spec.ts, the person load view in person-load.spec.ts.
  await openVariance(page, 'Apollo')
  await expect(cell(table(page, 'Apollo', 'v1'), 'T', PLANNED)).toHaveText('1–2 Mar')

  // Negative: opening it changes no task.
  expect(await call(page, 'GET', `/projects/${apollo}/tasks`)).toEqual(before)

  await page.context().close()
})

test("TC-154: a read-only member sees every view and the project's data (the baseline variance view)", async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(alicesPage, 'Apollo')
  await call(alicesPage, 'PUT', `/projects/${apollo}/members/${bob.id}`, { role: 'read-only' })
  await createTask(alicesPage, apollo, {
    title: 'T',
    plannedStart: '2027-03-01',
    durationWorkingDays: 1,
    assignees: [alice.id],
  })
  await call(alicesPage, 'POST', `/projects/${apollo}/baselines`, { name: 'v1' })

  // Step 1, the baseline variance view: as bob, it opens and shows T. The Kanban, the Gantt and the
  // person load view are in their own spec files, the saved view Board in saved-views.spec.ts.
  // views.spec.ts takes the test case in full, step 2's reads through the REST API included.
  const bobsPage = await signedIn(browser, deployment.url, bob)
  await openVariance(bobsPage, 'Apollo')
  await expect(cell(table(bobsPage, 'Apollo', 'v1'), 'T', PLANNED)).toHaveText('1 Mar')

  // Negative: the view does not refuse bob access.
  await expect(bobsPage.getByRole('alert')).toHaveCount(0)

  await alicesPage.context().close()
  await bobsPage.context().close()
})
