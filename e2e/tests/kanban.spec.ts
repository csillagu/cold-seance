import type { Browser, Locator, Page } from '@playwright/test'
import { type Account, expect, test } from '../fixtures.ts'

// The Kanban view (SC-030): the browser steps of the test cases it makes pass, in full or in
// part. The inputs are put in place through the REST API, in the browser's own session, until the
// screens that make them are built (task creation, F12); the changes the test cases make on the
// Kanban are made on it.
//
// Pending: the parts on the Kanban of TC-084, TC-085, TC-086 and TC-087, which open "a personal
// Kanban view of alice's covering Apollo and Borealis": saved views (SC-020, B06) and their editor
// (SC-091, F22) are not built, so no view covers several projects yet. The Kanban lays out tasks of
// several projects and names each card's project (kanban-model.test.ts); the moves of TC-084 and
// TC-085 go to the REST API, which allows them by the viewer's role in the card's project
// (backend/test/integration/task-roles.test.ts; roles held through a group, project-roles.test.ts). Asking for a writable project when a task is
// created in such a view (FR-061, TC-086, TC-087) waits for those nodes too.

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

/** The project `name`, created by the person signed in on `page`; gives its id. */
async function createProject(page: Page, name: string): Promise<string> {
  return idOf(await call(page, 'POST', '/projects', { name }))
}

/** Creates a task in `project` and gives its id. */
async function createTask(page: Page, project: string, fields: Record<string, unknown>) {
  return idOf(await call(page, 'POST', `/projects/${project}/tasks`, fields))
}

/** Reads a task through the REST API. */
async function readTask(page: Page, task: string): Promise<Record<string, unknown>> {
  const read = await call(page, 'GET', `/tasks/${task}`)
  if (typeof read !== 'object' || read === null) throw new Error('The answer is not a task')
  return { ...read }
}

/** Opens the Kanban of the project `name` from the navigation, and gives the Kanban. */
async function openKanban(page: Page, name: string): Promise<Locator> {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Navigation' }).getByRole('link', { name }).click()
  await page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('link', { name: 'Kanban' })
    .click()
  const kanban = page.getByRole('group', { name: `Kanban of ${name}` })
  await expect(kanban).toBeVisible()
  return kanban
}

/** The column of the Kanban headed `name`. */
const column = (kanban: Locator, name: string) => kanban.getByRole('region', { name, exact: true })

/** The card of the task titled `title`, wherever it is. */
const card = (kanban: Locator, title: string) =>
  kanban.getByRole('article', { name: title, exact: true })

const COLUMNS = ['Not started', 'In progress', 'On hold', 'Done', 'Cancelled']

test('TC-004: an unscheduled task appears on the Kanban', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  await createTask(page, apollo, { title: 'Triage backlog' })
  await createTask(page, apollo, {
    title: 'Write guide',
    plannedStart: '2027-03-01',
    durationWorkingDays: 2,
  })

  // Step 1: as alice, open the Kanban view of Apollo in the browser.
  const kanban = await openKanban(page, 'Apollo')

  // Both cards are shown, on the Kanban itself: not behind a filter or a separate page.
  await expect(card(kanban, 'Triage backlog')).toBeVisible()
  await expect(card(kanban, 'Write guide')).toBeVisible()
  await expect(card(kanban, 'Triage backlog')).toContainText('No dates')

  await page.context().close()
})

test("TC-065: a project's Kanban has one column per task status", async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  await createTask(page, apollo, { title: 'New' })
  const doing = await createTask(page, apollo, { title: 'Doing' })
  await call(page, 'PUT', `/tasks/${doing}/status`, { status: 'in-progress' })
  const paused = await createTask(page, apollo, { title: 'Paused' })
  await call(page, 'PUT', `/tasks/${paused}/status`, { status: 'on-hold' })
  const finished = await createTask(page, apollo, { title: 'Finished' })
  await call(page, 'PUT', `/tasks/${finished}/status`, { status: 'done' })
  const dropped = await createTask(page, apollo, { title: 'Dropped' })
  await call(page, 'POST', `/tasks/${dropped}/cancel`, {})

  // Step 1: as alice, open the Kanban of Apollo.
  const kanban = await openKanban(page, 'Apollo')

  // One column for each of the five statuses, and no status with two.
  await expect(kanban.getByRole('region')).toHaveCount(5)
  for (const name of COLUMNS) await expect(column(kanban, name)).toHaveCount(1)

  // Each task's card is in the column of its own status, and in no other.
  const expected: Record<string, string> = {
    New: 'Not started',
    Doing: 'In progress',
    Paused: 'On hold',
    Finished: 'Done',
    Dropped: 'Cancelled',
  }
  for (const [title, status] of Object.entries(expected)) {
    await expect(card(kanban, title)).toHaveCount(1)
    await expect(card(column(kanban, status), title)).toBeVisible()
  }

  await page.context().close()
})

test('TC-191: a cancelled task stays on the Kanban in the cancelled column', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  const t = await createTask(page, apollo, { title: 'T' })

  // Step 1: as alice, cancel T, on the Kanban, by moving its card to the cancelled column.
  const kanban = await openKanban(page, 'Apollo')
  await card(kanban, 'T').getByLabel('Move T to').selectOption('Cancelled')
  await expect(card(column(kanban, 'Cancelled'), 'T')).toBeVisible()
  expect((await readTask(page, t))['status']).toBe('cancelled')

  // Step 2: open the Kanban of Apollo. T's card is in the cancelled column, and in no other.
  await page.reload()
  await expect(card(column(kanban, 'Cancelled'), 'T')).toBeVisible()
  await expect(card(kanban, 'T')).toHaveCount(1)

  await page.context().close()
})

test('TC-214: unscheduled tasks are laid at the bottom of the Kanban', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  await createTask(page, apollo, { title: 'U' })
  await createTask(page, apollo, {
    title: 'S1',
    plannedStart: '2027-03-01',
    durationWorkingDays: 1,
  })
  await createTask(page, apollo, {
    title: 'S2',
    plannedStart: '2027-03-08',
    durationWorkingDays: 1,
  })

  // Step 1: as alice, open the Kanban of Apollo.
  const kanban = await openKanban(page, 'Apollo')
  const notStarted = column(kanban, 'Not started')
  const top = async (title: string) => {
    const box = await card(notStarted, title).boundingBox()
    if (!box) throw new Error(`${title} is not drawn`)
    return box.y
  }

  // In the column holding all three, U's card is below S1's and S2's: no scheduled card is below it.
  const [u, s1, s2] = [await top('U'), await top('S1'), await top('S2')]
  expect(u).toBeGreaterThan(s1)
  expect(u).toBeGreaterThan(s2)

  await page.context().close()
})

test('TC-071: a field shown on a Kanban card can be edited on the Kanban', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  const t = await createTask(page, apollo, { title: 'Draft' })

  // Step 1: as alice, open the Kanban of Apollo.
  const kanban = await openKanban(page, 'Apollo')

  // Step 2: change each field T's card shows, on the Kanban. It shows its title, "No dates" and
  // "Unassigned": set the title to Draft v2, give it dates, and assign alice.
  await card(kanban, 'Draft').getByRole('button', { name: 'Edit Draft' }).click()
  const form = kanban.getByRole('form', { name: 'Edit Draft' })
  await form.getByLabel('Title').fill('Draft v2')
  await form.getByLabel('Planned start').fill('2027-03-01')
  await form.getByLabel('Duration in working days').fill('2')
  await form.getByLabel('alice').check()
  await form.getByRole('button', { name: 'Save' }).click()
  const edited = card(kanban, 'Draft v2')
  await expect(edited).toContainText('1–2 Mar · 2d')
  await expect(edited.getByTitle('alice')).toHaveText('AL')

  // Move the card to the in-progress column, by dragging it there.
  await edited.dragTo(column(kanban, 'In progress'))
  await expect(card(column(kanban, 'In progress'), 'Draft v2')).toBeVisible()

  // Step 3: read T back through the REST API. Each change is saved.
  const read = await readTask(page, t)
  expect(read).toMatchObject({
    title: 'Draft v2',
    status: 'in-progress',
    plannedStart: '2027-03-01',
    plannedFinish: '2027-03-02',
    durationWorkingDays: 2,
    assignees: [alice.id],
  })

  await page.context().close()
})

test('TC-064: the four view kinds are available for a project (the Kanban)', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  await createTask(page, apollo, { title: 'T', plannedStart: '2027-03-01', durationWorkingDays: 2 })
  await call(page, 'POST', `/projects/${apollo}/baselines`, { name: 'v1' })
  const before = await call(page, 'GET', `/projects/${apollo}/tasks`)

  // Step 1, the Kanban: it opens and shows T. The Gantt is in gantt.spec.ts. Pending: the person
  // load view (SC-032, F20) and the baseline variance view (SC-033, F21).
  const kanban = await openKanban(page, 'Apollo')
  await expect(card(kanban, 'T')).toContainText('1–2 Mar · 2d')

  // Negative: opening it changes no task.
  expect(await call(page, 'GET', `/projects/${apollo}/tasks`)).toEqual(before)

  await page.context().close()
})

test("TC-154: a read-only member sees every view and the project's data (the Kanban)", async ({
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

  // Step 1, the Kanban: as bob, it opens and shows T. The Gantt is in gantt.spec.ts. Pending: the
  // person load view (SC-032, F20), the baseline variance view (SC-033, F21) and the saved view
  // Board (SC-020, SC-091, F22), and step 2's reads through the REST API (see
  // backend/test/integration/project-roles.test.ts).
  const bobsPage = await signedIn(browser, deployment.url, bob)
  const kanban = await openKanban(bobsPage, 'Apollo')
  const t = card(kanban, 'T')
  await expect(t).toContainText('1 Mar · 1d')
  await expect(t.getByTitle('alice')).toHaveText('AL')

  // Negative: the view does not refuse bob access.
  await expect(bobsPage.getByRole('alert')).toHaveCount(0)

  await alicesPage.context().close()
  await bobsPage.context().close()
})
