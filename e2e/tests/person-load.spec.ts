import type { Browser, Locator, Page } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { accounts } from '../../backend/src/db/schema.ts'
import { type Account, type Deployment, expect, test } from '../fixtures.ts'

// The person load view (SC-032) and its unassigned task rating panel (SC-069): the browser steps
// of the test cases they make pass, in full or in part. The inputs are put in place through the
// REST API, in the browser's own session, and capacities straight in the database.
//
// The REST side of TC-056, TC-057, TC-058, TC-060, TC-061, TC-062 and TC-063 is in
// backend/test/integration/ (B02, B03). The other views of TC-064 and TC-154 are in kanban.spec.ts
// and gantt.spec.ts; their baseline variance view waits for SC-033 (F21).

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

/** Gives `person` the role in `project`, as its admin signed in on `page`. */
async function giveRole(page: Page, project: string, person: Account, role: string) {
  await call(page, 'PUT', `/projects/${project}/members/${person.id}`, { role })
}

/** Sets a person's capacity, as the test case's inputs give it. */
async function setCapacity(deployment: Deployment, person: Account, capacity: number) {
  await deployment.db.update(accounts).set({ capacity }).where(eq(accounts.id, person.id))
}

/** A task read through the REST API. */
async function readTask(page: Page, task: string): Promise<Record<string, unknown>> {
  const read = await call(page, 'GET', `/tasks/${task}`)
  if (typeof read !== 'object' || read === null) throw new Error('The answer is not a task')
  return { ...read }
}

/** The planned dates of a task, read through the REST API. */
async function datesOf(page: Page, task: string): Promise<unknown[]> {
  const read = await readTask(page, task)
  return [read['plannedStart'], read['plannedFinish']]
}

/**
 * Opens the person load view of the project `name` from the navigation, for the days from `from`
 * to `to` if given, and gives the view's table.
 */
async function openPersonLoad(page: Page, name: string, from?: string, to?: string) {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Navigation' }).getByRole('link', { name }).click()
  await page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('link', { name: 'Person load' })
    .click()
  if (from && to) {
    await page.getByLabel('From').fill(from)
    await page.getByLabel('To').fill(to)
    await page.getByRole('button', { name: 'Show' }).click()
    await expect(page).toHaveURL(new RegExp(`from=${from}&to=${to}$`))
  }
  const table = page.getByRole('table', { name: `Person load of ${name}` })
  await expect(table).toBeVisible()
  return table
}

/** The cell of `username` on `day`, such as `1 Mar 2027`. */
const cell = (page: Page, username: string, day: string): Locator =>
  page.getByRole('button', { name: new RegExp(`^${username}, ${day}: `) })

/** Checks that the cell is shown overloaded, in red, or not. */
async function expectOverloaded(cellOf: Locator, overloaded: boolean) {
  if (overloaded) {
    await expect(cellOf).toHaveAccessibleName(/, overloaded$/)
    await expect(cellOf).toHaveClass(/load__cell--over/)
    await expect(cellOf).toHaveCSS('color', 'rgb(185, 28, 28)')
  } else {
    await expect(cellOf).not.toHaveAccessibleName(/overloaded/)
    await expect(cellOf).not.toHaveClass(/load__cell--over/)
  }
}

/** The rated task `title` in the unassigned task rating panel. */
const rated = (page: Page, title: string) =>
  page
    .getByRole('region', { name: 'Unassigned tasks' })
    .getByRole('article', { name: title, exact: true })

test('TC-006: an unscheduled task appears in the person load view', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  await createTask(page, apollo, { title: 'Triage backlog', assignees: [alice.id] })

  // Step 1: as alice, open the person load view covering Apollo in the browser.
  await openPersonLoad(page, 'Apollo')

  const backlog = page
    .getByRole('region', { name: "Tasks on no one's load" })
    .getByRole('article', { name: 'Triage backlog' })
  await expect(backlog).toBeVisible()
  await expect(backlog).toContainText('Assigned to alice')

  // Showing it adds no load to alice on any day: every one of her days is at 0%.
  const days = page.getByRole('button', { name: /^alice, / })
  await expect(days).toHaveCount(28)
  for (const label of await days.evaluateAll((all) =>
    all.map((b) => b.getAttribute('aria-label') ?? ''),
  )) {
    expect(label).toMatch(/: 0% of 100% capacity$/)
  }

  await page.context().close()
})

test('TC-056: a person is marked overloaded on a day their load exceeds their capacity', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  await setCapacity(deployment, alice, 80)
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  await createTask(page, apollo, {
    title: 'T',
    assignees: [alice.id],
    aiShare: 0,
    plannedStart: '2027-03-01',
    durationWorkingDays: 2,
  })

  // Step 1: as alice, open the person load view for 2027-03-01 to 2027-03-05.
  await openPersonLoad(page, 'Apollo', '2027-03-01', '2027-03-05')

  await expectOverloaded(cell(page, 'alice', '1 Mar 2027'), true)
  await expectOverloaded(cell(page, 'alice', '2 Mar 2027'), true)
  for (const day of ['3 Mar 2027', '4 Mar 2027', '5 Mar 2027']) {
    await expectOverloaded(cell(page, 'alice', day), false)
  }

  await page.context().close()
})

test('TC-057: a load equal to capacity is not an overload', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  await setCapacity(deployment, alice, 80)
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  await createTask(page, apollo, {
    title: 'T',
    assignees: [alice.id],
    aiShare: 20,
    plannedStart: '2027-03-01',
    durationWorkingDays: 1,
  })

  // Step 1: as alice, open the person load view for 2027-03-01.
  await openPersonLoad(page, 'Apollo', '2027-03-01', '2027-03-01')

  const day = cell(page, 'alice', '1 Mar 2027')
  await expect(day).toHaveAccessibleName('alice, 1 Mar 2027: 80% of 80% capacity')
  await expect(day).toContainText('80%')
  await expectOverloaded(day, false)

  await page.context().close()
})

test("TC-058: a shared person's overload is red to every project involved", async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const carol = await deployment.seedAccount('carol')
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const bobsPage = await signedIn(browser, deployment.url, bob)
  const apollo = await createProject(alicesPage, 'Apollo')
  const borealis = await createProject(bobsPage, 'Borealis')
  await giveRole(alicesPage, apollo, carol, 'read-only')
  await giveRole(bobsPage, borealis, carol, 'read-only')
  const day = { assignees: [carol.id], aiShare: 0, plannedStart: '2027-03-01' }
  const t1 = await createTask(alicesPage, apollo, { title: 'T1', ...day, durationWorkingDays: 1 })
  const t2 = await createTask(bobsPage, borealis, { title: 'T2', ...day, durationWorkingDays: 1 })

  // Step 1: as alice, open the person load view of Apollo for 2027-03-01.
  await openPersonLoad(alicesPage, 'Apollo', '2027-03-01', '2027-03-01')
  // Step 2: as bob, open the person load view of Borealis for 2027-03-01.
  await openPersonLoad(bobsPage, 'Borealis', '2027-03-01', '2027-03-01')

  for (const page of [alicesPage, bobsPage]) {
    await expectOverloaded(cell(page, 'carol', '1 Mar 2027'), true)
  }
  // Neither task has moved.
  expect(await datesOf(alicesPage, t1)).toEqual(['2027-03-01', '2027-03-01'])
  expect(await datesOf(bobsPage, t2)).toEqual(['2027-03-01', '2027-03-01'])

  await alicesPage.context().close()
  await bobsPage.context().close()
})

test('TC-063: load from projects the viewer cannot read shows only as a percentage', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const carol = await deployment.seedAccount('carol')
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const bobsPage = await signedIn(browser, deployment.url, bob)
  const apollo = await createProject(alicesPage, 'Apollo')
  const borealis = await createProject(bobsPage, 'Borealis')
  await giveRole(alicesPage, apollo, carol, 'read-only')
  await giveRole(bobsPage, borealis, carol, 'read-only')
  const day = { assignees: [carol.id], plannedStart: '2027-03-01', durationWorkingDays: 1 }
  await createTask(alicesPage, apollo, { title: 'Visible task', aiShare: 60, ...day })
  await createTask(bobsPage, borealis, { title: 'Hidden task', aiShare: 40, ...day })
  await bobsPage.context().close()

  // Step 1: as alice, open the person load view and look at carol on 2027-03-01.
  await openPersonLoad(alicesPage, 'Apollo', '2027-03-01', '2027-03-01')
  const carols = cell(alicesPage, 'carol', '1 Mar 2027')
  await expect(carols).toHaveAccessibleName(/^carol, 1 Mar 2027: 100%/)
  await carols.click()

  const details = alicesPage.getByRole('region', { name: 'Load of carol on 1 Mar 2027' })
  await expect(details).toContainText('Total 100%')
  const visible = details.getByRole('listitem').filter({ hasText: 'Visible task' })
  await expect(visible).toContainText('40%')
  await expect(details.getByText('Other projects: 60%')).toBeVisible()

  // Nothing of Hidden task or of Borealis is shown to alice.
  await expect(alicesPage.locator('body')).not.toContainText('Hidden task')
  await expect(alicesPage.locator('body')).not.toContainText('Borealis')

  await alicesPage.context().close()
})

test("TC-069: the person load view shows each person's daily load across projects against capacity", async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const carol = await deployment.seedAccount('carol')
  await setCapacity(deployment, carol, 80)
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const bobsPage = await signedIn(browser, deployment.url, bob)
  const apollo = await createProject(alicesPage, 'Apollo')
  const borealis = await createProject(bobsPage, 'Borealis')
  await giveRole(bobsPage, borealis, alice, 'read-only')
  await giveRole(alicesPage, apollo, carol, 'read-only')
  await giveRole(bobsPage, borealis, carol, 'read-only')
  await createTask(alicesPage, apollo, {
    title: 'T1',
    assignees: [carol.id],
    aiShare: 50,
    plannedStart: '2027-03-01',
    plannedFinish: '2027-03-02',
  })
  await createTask(bobsPage, borealis, {
    title: 'T2',
    assignees: [carol.id],
    aiShare: 80,
    plannedStart: '2027-03-02',
    plannedFinish: '2027-03-03',
  })
  await bobsPage.context().close()

  // Step 1: as alice, open the person load view for 2027-03-01 to 2027-03-04 and look at carol.
  await openPersonLoad(alicesPage, 'Apollo', '2027-03-01', '2027-03-04')

  const expected = [
    ['1 Mar 2027', '50%'],
    ['2 Mar 2027', '70%'],
    ['3 Mar 2027', '20%'],
    ['4 Mar 2027', '0%'],
  ]
  for (const [day, load] of expected) {
    const carols = cell(alicesPage, 'carol', day!)
    // Each day's load is shown against carol's capacity of 80%, and none is an overload.
    await expect(carols).toHaveAccessibleName(`carol, ${day}: ${load} of 80% capacity`)
    await expect(carols).toContainText(load!)
    await expectOverloaded(carols, false)
  }
  // The tasks behind the load are both in projects alice can read, so both are named.
  const tasks = alicesPage.getByRole('list', { name: 'Tasks of carol' })
  await expect(tasks.getByRole('listitem')).toHaveText(['T1 50%', 'T2 20% · Borealis'])

  await alicesPage.context().close()
})

test.describe('the unassigned task rating panel', () => {
  /** Alice and bob, capacity 100%, and Apollo, where bob has the read-only role. */
  async function inputs(browser: Browser, deployment: Deployment) {
    const alice = await deployment.seedAccount('alice')
    const bob = await deployment.seedAccount('bob')
    const page = await signedIn(browser, deployment.url, alice)
    const apollo = await createProject(page, 'Apollo')
    await giveRole(page, apollo, bob, 'read-only')
    const week = { aiShare: 0, plannedStart: '2027-03-01', durationWorkingDays: 5 }
    return { alice, bob, page, apollo, week }
  }

  /** Creates U, eligible `alice OR bob` with no one assigned, and gives its id. */
  async function createU(
    page: Page,
    apollo: string,
    alice: Account,
    bob: Account,
    week: object,
  ): Promise<string> {
    return createTask(page, apollo, {
      title: 'U',
      eligibility: { any: [alice.id, bob.id] },
      ...week,
    })
  }

  /** Checks that U is shown in `colour` alone, and still has no assigned people. */
  async function expectRated(page: Page, u: string, colour: 'Red' | 'Amber' | 'Green') {
    const badge = rated(page, 'U').getByText(colour, { exact: true })
    await expect(badge).toHaveClass(new RegExp(`load__rating--${colour.toLowerCase()}`))
    for (const other of ['Red', 'Amber', 'Green'].filter((name) => name !== colour)) {
      await expect(rated(page, 'U').getByText(other, { exact: true })).toHaveCount(0)
    }
    expect((await readTask(page, u))['assignees']).toEqual([])
  }

  test('TC-060: an unassigned task is red when every eligible combination overloads someone', async ({
    browser,
    deployment,
  }) => {
    const { alice, bob, page, apollo, week } = await inputs(browser, deployment)
    await createTask(page, apollo, { title: 'X', assignees: [alice.id], ...week })
    await createTask(page, apollo, { title: 'Y', assignees: [bob.id], ...week })
    const u = await createU(page, apollo, alice, bob, week)

    // Step 1: as alice, open the person load view of Apollo for 2027-03-01 to 2027-03-05.
    await openPersonLoad(page, 'Apollo', '2027-03-01', '2027-03-05')

    await expectRated(page, u, 'Red')
    await page.context().close()
  })

  test('TC-061: an unassigned task is amber when only some eligible combinations overload someone', async ({
    browser,
    deployment,
  }) => {
    const { alice, bob, page, apollo, week } = await inputs(browser, deployment)
    await createTask(page, apollo, { title: 'X', assignees: [alice.id], ...week })
    const u = await createU(page, apollo, alice, bob, week)

    // Step 1: as alice, open the person load view of Apollo for 2027-03-01 to 2027-03-05.
    await openPersonLoad(page, 'Apollo', '2027-03-01', '2027-03-05')

    await expectRated(page, u, 'Amber')
    await page.context().close()
  })

  test('TC-062: an unassigned task is green when an eligible combination fits', async ({
    browser,
    deployment,
  }) => {
    const { alice, bob, page, apollo, week } = await inputs(browser, deployment)
    const u = await createU(page, apollo, alice, bob, week)

    // Step 1: as alice, open the person load view of Apollo for 2027-03-01 to 2027-03-05.
    await openPersonLoad(page, 'Apollo', '2027-03-01', '2027-03-05')

    await expectRated(page, u, 'Green')
    await page.context().close()
  })
})

test('TC-064: the person load view is available for a project and shows its task', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  const t = await createTask(page, apollo, {
    title: 'T',
    plannedStart: '2027-03-01',
    durationWorkingDays: 2,
  })

  // Step 1, the person load view: as alice, open the person load view of Apollo.
  await openPersonLoad(page, 'Apollo')

  // T has no one assigned, so it loads no one: it is shown among the tasks on no one's load.
  await expect(
    page
      .getByRole('region', { name: "Tasks on no one's load" })
      .getByRole('article', { name: 'T', exact: true }),
  ).toContainText('No one assigned')
  // Opening the view changes no task.
  expect(await datesOf(page, t)).toEqual(['2027-03-01', '2027-03-02'])

  await page.context().close()
})

test('TC-154: a read-only member sees the person load view and the project data', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(alicesPage, 'Apollo')
  await giveRole(alicesPage, apollo, bob, 'read-only')
  await createTask(alicesPage, apollo, {
    title: 'T',
    assignees: [alice.id],
    plannedStart: '2027-03-01',
    durationWorkingDays: 1,
  })
  await alicesPage.context().close()

  // Step 1, the person load view: as bob, open the person load view for Apollo.
  const page = await signedIn(browser, deployment.url, bob)
  await openPersonLoad(page, 'Apollo', '2027-03-01', '2027-03-05')

  // The view opens, refuses bob nothing, and shows T behind alice's load.
  await expect(
    page.getByRole('list', { name: 'Tasks of alice' }).getByRole('link', { name: 'T' }),
  ).toBeVisible()
  await expect(cell(page, 'alice', '1 Mar 2027')).toHaveAccessibleName(/: 100% of 100% capacity$/)
  await expect(page.getByRole('alert')).toHaveCount(0)

  await page.context().close()
})
