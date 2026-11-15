import type { Browser, Locator, Page } from '@playwright/test'
import { type Account, expect, ROOT, test } from '../fixtures.ts'

// The saved view editor (SC-091) and its filter builder (SC-092): the browser steps of the test
// cases they make pass. The inputs are put in place through the REST API, in the browser's own
// session; the views the test cases save are saved in the editor, unless a test case gives one
// as an input, and opened from the lists of saved views.
//
// There is no way to sign out in the frontend yet, so TC-073's "sign out, sign in again" is a new
// browser session signed in afresh, which holds nothing of the one before.

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

/** What the REST API answered: whether it succeeded, and its parsed body. */
async function send(page: Page, method: string, path: string, data?: unknown) {
  const answer = await page.evaluate(
    async (request) => {
      const response = await fetch(`/api${request.path}`, {
        method: request.method,
        headers: request.data === undefined ? {} : { 'content-type': 'application/json' },
        body: request.data === undefined ? undefined : JSON.stringify(request.data),
      })
      return { ok: response.ok, status: response.status, text: await response.text() }
    },
    { method, path, data },
  )
  const body: unknown = answer.text === '' ? null : JSON.parse(answer.text)
  return { ...answer, body }
}

/**
 * Calls the REST API from `page`, in its session, and gives its parsed answer, failing on an error
 * status. The call is made by the page itself, as the session cookie is `Secure` and only the
 * browser sends it to the test deployment's plain-HTTP address.
 */
async function call(page: Page, method: string, path: string, data?: unknown): Promise<unknown> {
  const answer = await send(page, method, path, data)
  expect(answer.ok, `${method} ${path}: ${answer.text}`).toBe(true)
  return answer.body
}

/** The id of what the REST API created, from its answer. */
function idOf(created: unknown): string {
  if (typeof created !== 'object' || created === null || !('id' in created)) {
    throw new Error('The answer holds no id')
  }
  return String(created.id)
}

async function createProject(page: Page, name: string): Promise<string> {
  return idOf(await call(page, 'POST', '/projects', { name }))
}

async function createTask(page: Page, project: string, fields: Record<string, unknown>) {
  return idOf(await call(page, 'POST', `/projects/${project}/tasks`, fields))
}

async function setStatus(page: Page, task: string, status: string) {
  await call(page, 'PUT', `/tasks/${task}/status`, { status })
}

async function createGroup(page: Page, name: string): Promise<string> {
  return idOf(await call(page, 'POST', '/groups', { name }))
}

/** A condition as the filter builder is given it: its field, comparison and value by label. */
interface Condition {
  field: string
  comparison?: string
  /** A value chosen from a list, by its label. */
  choose?: string
  /** A value typed or picked in a text, number or date input. */
  fill?: string
}

interface ViewToSave {
  name: string
  kind: 'Kanban' | 'Gantt'
  kept: 'Personally' | 'In a project' | 'In a group'
  project?: string
  group?: string
  covers?: string[]
  conditions?: Condition[]
}

/** Saves a view in the saved view editor, as the person signed in on `page`; gives its id. */
async function saveView(page: Page, view: ViewToSave): Promise<string> {
  await page.goto('/views')
  await page.getByRole('link', { name: 'New view' }).click()
  const editor = page.getByRole('form', { name: 'Save a view' })
  await editor.getByLabel('Name').fill(view.name)
  await editor.getByLabel('Kind').selectOption({ label: view.kind })
  await editor.getByRole('radio', { name: view.kept }).check()
  if (view.project !== undefined) {
    await editor.getByLabel('Project', { exact: true }).selectOption({ label: view.project })
  }
  if (view.group !== undefined) {
    await editor.getByLabel('Group', { exact: true }).selectOption({ label: view.group })
  }
  for (const project of view.covers ?? []) {
    await editor.getByRole('checkbox', { name: project, exact: true }).check()
  }
  for (const [index, condition] of (view.conditions ?? []).entries()) {
    await editor.getByRole('button', { name: 'Add condition' }).click()
    const row = editor.getByRole('group', { name: `Condition ${index + 1}` })
    await row.getByLabel('Field').selectOption({ label: condition.field })
    if (condition.comparison !== undefined) {
      await row.getByLabel('Comparison').selectOption({ label: condition.comparison })
    }
    if (condition.choose !== undefined) {
      await row.getByLabel('Value').selectOption({ label: condition.choose })
    }
    if (condition.fill !== undefined) await row.getByLabel('Value').fill(condition.fill)
  }
  await editor.getByRole('button', { name: 'Save view' }).click()
  await expect(page.getByRole('heading', { level: 1, name: view.name })).toBeVisible()
  const id = /\/views\/([0-9a-f-]{36})$/.exec(page.url())?.[1]
  if (id === undefined) throw new Error(`The saved view was not opened: ${page.url()}`)
  return id
}

/** The saved views the person signed in on `page` sees, as `/views` lists them, by name. */
async function listedViews(page: Page): Promise<Locator> {
  await page.goto('/')
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Saved views' })
    .click()
  const list = page.getByRole('table', { name: 'Your saved views' })
  const none = page.getByText('No saved views yet.')
  await expect(list.or(none)).toBeVisible()
  return page.getByRole('main')
}

/** Opens the saved view `name` from the list of saved views. */
async function openFromList(page: Page, name: string) {
  const main = await listedViews(page)
  await main.getByRole('link', { name, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

/** Opens the Saved views tab of the project `project`, from the navigation. */
async function projectViews(page: Page, project: string): Promise<Locator> {
  await page.goto('/')
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: project })
    .click()
  await page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('link', { name: 'Saved views' })
    .click()
  const list = page.getByRole('table', { name: `Saved views of ${project}` })
  await expect(list.or(page.getByText('No saved views yet.'))).toBeVisible()
  return page.getByRole('main')
}

const card = (view: Locator, title: string) =>
  view.getByRole('article', { name: title, exact: true })

const column = (kanban: Locator, name: string) => kanban.getByRole('region', { name, exact: true })

test('TC-073: named Kanban and Gantt views can be saved', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  const doing = await createTask(page, apollo, {
    title: 'Doing',
    plannedStart: '2027-03-01',
    durationWorkingDays: 2,
  })
  await setStatus(page, doing, 'in-progress')
  await createTask(page, apollo, {
    title: 'Waiting',
    plannedStart: '2027-03-08',
    durationWorkingDays: 1,
  })
  const before = await call(page, 'GET', `/projects/${apollo}/tasks`)

  // Step 1: as alice, create and save both views.
  await saveView(page, {
    name: 'Team board',
    kind: 'Kanban',
    kept: 'Personally',
    covers: ['Apollo'],
    conditions: [{ field: 'Status', comparison: 'is', choose: 'In progress' }],
  })
  await saveView(page, { name: 'Q1 plan', kind: 'Gantt', kept: 'Personally', covers: ['Apollo'] })
  await page.context().close()

  // Step 2: signed in afresh, alice lists their saved views.
  const again = await signedIn(browser, deployment.url, alice)
  const main = await listedViews(again)
  await expect(main.getByRole('link', { name: 'Team board', exact: true })).toBeVisible()
  await expect(main.getByRole('link', { name: 'Q1 plan', exact: true })).toBeVisible()

  // Step 3: Team board opens as a Kanban with its filter; Q1 plan as a Gantt.
  await openFromList(again, 'Team board')
  const kanban = again.getByRole('group', { name: 'Team board' })
  await expect(card(column(kanban, 'In progress'), 'Doing')).toBeVisible()
  await expect(card(kanban, 'Waiting')).toHaveCount(0)
  await expect(again.getByRole('list', { name: 'Filter' })).toHaveText('Status is In progress')

  await openFromList(again, 'Q1 plan')
  const gantt = again.getByRole('table', { name: 'Q1 plan' })
  await expect(gantt.getByRole('row', { name: 'Doing' })).toBeVisible()
  await expect(gantt.getByRole('row', { name: 'Waiting' })).toBeVisible()

  // Negative: neither view changes any task.
  expect(await call(again, 'GET', `/projects/${apollo}/tasks`)).toEqual(before)

  await again.context().close()
})

test('TC-074: person load and baseline variance views cannot be saved', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  await createTask(page, apollo, { title: 'T', plannedStart: '2027-03-01', durationWorkingDays: 1 })
  await call(page, 'POST', `/projects/${apollo}/baselines`, { name: 'v1' })
  const views = page.getByRole('navigation', { name: 'Views' })
  const offerToSave = page
    .getByRole('main')
    .getByRole('button', { name: /\bsave\b.*view|save as/i })
  const linkToSave = page.getByRole('main').getByRole('link', { name: /\bsave\b.*view|new view/i })

  // Step 1: the person load view offers no way to save it as a named view.
  await page.goto('/')
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Apollo' })
    .click()
  await views.getByRole('link', { name: 'Person load' }).click()
  await expect(page.getByRole('main').getByText('alice').first()).toBeVisible()
  await expect(offerToSave).toHaveCount(0)
  await expect(linkToSave).toHaveCount(0)

  // Step 2: nor does the baseline variance view.
  await views.getByRole('link', { name: 'Baseline variance' }).click()
  await expect(
    page.getByRole('table', { name: 'Baseline variance of Apollo against v1' }),
  ).toBeVisible()
  await expect(offerToSave).toHaveCount(0)
  await expect(linkToSave).toHaveCount(0)

  // The editor offers the Kanban and Gantt kinds only.
  await page.goto('/views/new')
  const kinds = page.getByLabel('Kind').getByRole('option')
  await expect(kinds).toHaveText(['Kanban', 'Gantt'])

  // Step 3: the REST API rejects a saved view of the person load kind.
  const refused = await send(page, 'POST', '/saved-views', {
    name: 'Load view',
    kind: 'person-load',
    keptIn: 'personal',
    projects: [apollo],
  })
  expect(refused.status).toBe(400)

  // Negative: alice's saved views hold no Load view, and no view of either kind.
  const main = await listedViews(page)
  await expect(main.getByText('Load view')).toHaveCount(0)
  expect(await call(page, 'GET', '/saved-views')).toEqual([])

  await page.context().close()
})

test('TC-075: a view kept in a project is seen by anyone who can read the project', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const dave = await deployment.seedAccount('dave')
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(alicesPage, 'Apollo')
  await call(alicesPage, 'PUT', `/projects/${apollo}/members/${bob.id}`, { role: 'read-only' })
  await createTask(alicesPage, apollo, { title: 'T' })
  await saveView(alicesPage, {
    name: 'Apollo board',
    kind: 'Kanban',
    kept: 'In a project',
    project: 'Apollo',
  })

  // Step 1: bob lists the saved views of Apollo and opens Apollo board.
  const bobsPage = await signedIn(browser, deployment.url, bob)
  const apolloViews = await projectViews(bobsPage, 'Apollo')
  await apolloViews.getByRole('link', { name: 'Apollo board', exact: true }).click()
  await expect(bobsPage.getByRole('heading', { level: 1, name: 'Apollo board' })).toBeVisible()
  await expect(card(bobsPage.getByRole('group', { name: 'Apollo board' }), 'T')).toBeVisible()

  // Step 2, negative: Apollo board is not among dave's views.
  const davesPage = await signedIn(browser, deployment.url, dave)
  const davesViews = await listedViews(davesPage)
  await expect(davesViews.getByText('Apollo board')).toHaveCount(0)

  for (const page of [alicesPage, bobsPage, davesPage]) await page.context().close()
})

test("TC-076: a view kept in a group is seen by the group's members", async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const dave = await deployment.seedAccount('dave')
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const platform = await createGroup(alicesPage, 'Platform')
  await call(alicesPage, 'PUT', `/groups/${platform}/members/${bob.id}`, { role: 'read-only' })
  const apollo = await createProject(alicesPage, 'Apollo')
  await call(alicesPage, 'PUT', `/groups/${platform}/projects/${apollo}`)
  await call(alicesPage, 'PUT', `/projects/${apollo}/members/${dave.id}`, { role: 'read-only' })
  await saveView(alicesPage, {
    name: 'Platform board',
    kind: 'Kanban',
    kept: 'In a group',
    group: 'Platform',
    covers: ['Apollo'],
  })

  // Step 1: Platform board is in bob's list.
  const bobsPage = await signedIn(browser, deployment.url, bob)
  const bobsViews = await listedViews(bobsPage)
  await expect(bobsViews.getByRole('link', { name: 'Platform board', exact: true })).toBeVisible()

  // Step 2, negative: it is not in dave's, although dave can read Apollo.
  const davesPage = await signedIn(browser, deployment.url, dave)
  const davesViews = await listedViews(davesPage)
  await expect(davesViews.getByText('Platform board')).toHaveCount(0)
  await expect((await projectViews(davesPage, 'Apollo')).getByText('Platform board')).toHaveCount(0)

  for (const page of [alicesPage, bobsPage, davesPage]) await page.context().close()
})

test('TC-077: a personal view is seen by its owner only', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(alicesPage, 'Apollo')
  await call(alicesPage, 'PUT', `/projects/${apollo}/members/${bob.id}`, { role: 'read-write' })
  await saveView(alicesPage, {
    name: 'My plan',
    kind: 'Gantt',
    kept: 'Personally',
    covers: ['Apollo'],
  })

  // Step 1: My plan is in alice's list.
  const alicesViews = await listedViews(alicesPage)
  await expect(alicesViews.getByRole('link', { name: 'My plan', exact: true })).toBeVisible()

  // Step 2, negative: it is not in bob's, in Apollo or personally.
  const bobsPage = await signedIn(browser, deployment.url, bob)
  await expect((await listedViews(bobsPage)).getByText('My plan')).toHaveCount(0)
  await expect((await projectViews(bobsPage, 'Apollo')).getByText('My plan')).toHaveCount(0)

  await alicesPage.context().close()
  await bobsPage.context().close()
})

test('TC-081: a saved view filters on each task field', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  await call(page, 'PUT', `/projects/${apollo}/members/${bob.id}`, { role: 'read-only' })
  const t1 = await createTask(page, apollo, {
    title: 'T1',
    description: 'alpha',
    plannedStart: '2027-03-01',
    durationWorkingDays: 2,
    effort: 3,
    aiShare: 0,
    eligibility: alice.id,
    assignees: [alice.id],
  })
  await setStatus(page, t1, 'in-progress')
  await createTask(page, apollo, {
    title: 'T2',
    description: 'beta',
    plannedStart: '2027-03-08',
    durationWorkingDays: 5,
    effort: 8,
    aiShare: 50,
    eligibility: bob.id,
    assignees: [bob.id],
  })

  // One filter per field, each matching T1 only.
  const filters: Condition[] = [
    { field: 'Title', comparison: 'is', fill: 'T1' },
    { field: 'Description', comparison: 'is', fill: 'alpha' },
    { field: 'Status', comparison: 'is', choose: 'In progress' },
    { field: 'Planned start', comparison: 'is', fill: '2027-03-01' },
    { field: 'Planned finish', comparison: 'is', fill: '2027-03-02' },
    { field: 'Duration (working days)', comparison: 'is', fill: '2' },
    { field: 'Effort', comparison: 'is', fill: '3' },
    { field: 'AI share (%)', comparison: 'is', fill: '0' },
    { field: 'Eligibility', choose: 'alice' },
    { field: 'Assigned people', choose: 'alice' },
  ]

  // Step 1: for each filter, save a personal Kanban over Apollo with it, and open it.
  for (const [index, filter] of filters.entries()) {
    const name = `By ${filter.field}`
    await saveView(page, {
      name,
      kind: 'Kanban',
      kept: 'Personally',
      covers: ['Apollo'],
      conditions: [filter],
    })
    await openFromList(page, name)
    const kanban = page.getByRole('group', { name })
    // Every view is saved and shows T1; none shows T2.
    await expect(card(kanban, 'T1'), `filter ${index + 1}, ${filter.field}`).toBeVisible()
    await expect(card(kanban, 'T2'), `filter ${index + 1}, ${filter.field}`).toHaveCount(0)
  }

  await page.context().close()
})

test('TC-082: a group view filtered on the viewer shows each viewer their own tasks', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const platform = await createGroup(alicesPage, 'Platform')
  await call(alicesPage, 'PUT', `/groups/${platform}/members/${bob.id}`, { role: 'read-write' })
  const apollo = await createProject(alicesPage, 'Apollo')
  await call(alicesPage, 'PUT', `/groups/${platform}/projects/${apollo}`)
  await createTask(alicesPage, apollo, { title: 'A-task', assignees: [alice.id] })
  await createTask(alicesPage, apollo, { title: 'B-task', assignees: [bob.id] })
  const view = await saveView(alicesPage, {
    name: 'MY kanban',
    kind: 'Kanban',
    kept: 'In a group',
    group: 'Platform',
    covers: ['Apollo'],
    conditions: [{ field: 'Assigned people', choose: 'The person viewing' }],
  })
  const saved = await call(alicesPage, 'GET', `/saved-views/${view}`)

  // Step 1: alice sees A-task only.
  await openFromList(alicesPage, 'MY kanban')
  const alicesKanban = alicesPage.getByRole('group', { name: 'MY kanban' })
  await expect(card(alicesKanban, 'A-task')).toBeVisible()
  await expect(card(alicesKanban, 'B-task')).toHaveCount(0)

  // Step 2: bob sees B-task only.
  const bobsPage = await signedIn(browser, deployment.url, bob)
  await openFromList(bobsPage, 'MY kanban')
  const bobsKanban = bobsPage.getByRole('group', { name: 'MY kanban' })
  await expect(card(bobsKanban, 'B-task')).toBeVisible()
  await expect(card(bobsKanban, 'A-task')).toHaveCount(0)
  await expect(bobsPage.getByRole('list', { name: 'Filter' })).toHaveText(
    'Assigned people contains the person viewing',
  )

  // Negative: the saved filter is the same for both; neither opening changed it.
  expect(await call(bobsPage, 'GET', `/saved-views/${view}`)).toEqual(saved)

  await alicesPage.context().close()
  await bobsPage.context().close()
})

test('TC-066: a cross-project Kanban has one column per task status', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const bobsPage = await signedIn(browser, deployment.url, bob)
  const apollo = await createProject(alicesPage, 'Apollo')
  const borealis = await createProject(bobsPage, 'Borealis')
  await call(bobsPage, 'PUT', `/projects/${borealis}/members/${alice.id}`, { role: 'read-only' })
  await setStatus(
    alicesPage,
    await createTask(alicesPage, apollo, { title: 'A-doing' }),
    'in-progress',
  )
  await setStatus(
    bobsPage,
    await createTask(bobsPage, borealis, { title: 'B-doing' }),
    'in-progress',
  )
  const paused = await createTask(bobsPage, borealis, { title: 'B-paused' })
  await setStatus(bobsPage, paused, 'in-progress')
  await setStatus(bobsPage, paused, 'on-hold')
  await saveView(alicesPage, {
    name: 'Both boards',
    kind: 'Kanban',
    kept: 'Personally',
    covers: ['Apollo', 'Borealis'],
  })

  // Step 1: alice opens the saved Kanban.
  await openFromList(alicesPage, 'Both boards')
  const kanban = alicesPage.getByRole('group', { name: 'Both boards' })

  // A-doing and B-doing are in the same in-progress column; B-paused is on hold.
  await expect(card(column(kanban, 'In progress'), 'A-doing')).toBeVisible()
  await expect(card(column(kanban, 'In progress'), 'B-doing')).toBeVisible()
  await expect(card(column(kanban, 'On hold'), 'B-paused')).toBeVisible()

  // Negative: the columns are not split per project, one column per status.
  await expect(kanban.getByRole('region')).toHaveText([
    /^Not started/,
    /^In progress/,
    /^On hold/,
    /^Done/,
    /^Cancelled/,
  ])

  await alicesPage.context().close()
  await bobsPage.context().close()
})

test('TC-083: a view shows no tasks of a project its viewer can no longer read', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const bobsPage = await signedIn(browser, deployment.url, bob)
  const apollo = await createProject(alicesPage, 'Apollo')
  await createTask(alicesPage, apollo, { title: 'A-task' })
  const borealis = await createProject(bobsPage, 'Borealis')
  await createTask(bobsPage, borealis, { title: 'B-task' })
  await call(bobsPage, 'PUT', `/projects/${borealis}/members/${alice.id}`, { role: 'read-only' })
  await saveView(alicesPage, {
    name: 'Both boards',
    kind: 'Kanban',
    kept: 'Personally',
    covers: ['Apollo', 'Borealis'],
  })

  // Step 1: the view shows A-task and B-task.
  await openFromList(alicesPage, 'Both boards')
  const kanban = alicesPage.getByRole('group', { name: 'Both boards' })
  await expect(card(kanban, 'A-task')).toBeVisible()
  await expect(card(kanban, 'B-task')).toBeVisible()

  // Step 2: bob removes alice from Borealis.
  await call(bobsPage, 'DELETE', `/projects/${borealis}/members/${alice.id}`)

  // Step 3: the view shows A-task, and nothing of Borealis.
  await openFromList(alicesPage, 'Both boards')
  await expect(card(kanban, 'A-task')).toBeVisible()
  await expect(card(kanban, 'B-task')).toHaveCount(0)
  await expect(alicesPage.getByRole('main').getByText('Borealis')).toHaveCount(0)

  await alicesPage.context().close()
  await bobsPage.context().close()
})

test('TC-233: deleting a group deletes its saved views', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const platform = await createGroup(alicesPage, 'Platform')
  const apollo = await createProject(alicesPage, 'Apollo')
  await call(alicesPage, 'PUT', `/groups/${platform}/projects/${apollo}`)
  await saveView(alicesPage, {
    name: 'Group board',
    kind: 'Kanban',
    kept: 'In a group',
    group: 'Platform',
    covers: ['Apollo'],
  })
  await saveView(alicesPage, {
    name: 'Project board',
    kind: 'Kanban',
    kept: 'In a project',
    project: 'Apollo',
  })
  await saveView(alicesPage, {
    name: 'My board',
    kind: 'Kanban',
    kept: 'Personally',
    covers: ['Apollo'],
  })

  // Step 1: root deletes Platform, with the group list screen's delete action (SC-082).
  const rootsPage = await signedIn(browser, deployment.url, { id: '', ...ROOT })
  await rootsPage
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Groups' })
    .click()
  await rootsPage.getByRole('button', { name: 'Delete Platform' }).click()
  await rootsPage.getByRole('button', { name: 'Delete Platform for good' }).click()
  await expect(rootsPage.getByRole('status')).toHaveText(
    'Group Platform is deleted. Its projects stay.',
  )

  // Step 2: alice lists every saved view they can see: Group board is gone.
  const main = await listedViews(alicesPage)
  await expect(main.getByText('Group board')).toHaveCount(0)

  // Negative: Project board and My board still exist.
  await expect(main.getByRole('link', { name: 'Project board', exact: true })).toBeVisible()
  await expect(main.getByRole('link', { name: 'My board', exact: true })).toBeVisible()

  await alicesPage.context().close()
  await rootsPage.context().close()
})

test("TC-154: a read-only member sees every view and the project's data (the saved view Board)", async ({
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
  await saveView(alicesPage, {
    name: 'Board',
    kind: 'Kanban',
    kept: 'In a project',
    project: 'Apollo',
  })

  // Step 1, Board: as bob, it opens from Apollo's saved views and shows T. The other views are in
  // kanban.spec.ts, gantt.spec.ts, person-load.spec.ts and baseline-variance.spec.ts.
  const bobsPage = await signedIn(browser, deployment.url, bob)
  const views = await projectViews(bobsPage, 'Apollo')
  await views.getByRole('link', { name: 'Board', exact: true }).click()
  const board = bobsPage.getByRole('group', { name: 'Board' })
  const t = card(board, 'T')
  await expect(t).toContainText('1 Mar · 1d')
  await expect(t.getByTitle('alice')).toHaveText('AL')

  // Negative: the view does not refuse bob access.
  await expect(bobsPage.getByRole('alert')).toHaveCount(0)

  await alicesPage.context().close()
  await bobsPage.context().close()
})
