import type { Browser, Locator, Page } from '@playwright/test'
import { type Account, expect, test } from '../fixtures.ts'

// The Gantt timeline (SC-031): the browser steps of the test cases it makes pass, in full or in
// part. What the Gantt shows comes from the REST API, whose part of each test case is tested in
// backend/test/integration/. The inputs are put in place through the REST API, in the browser's
// own session, until the screens that make them are built (the calendar screens, F10); the
// changes the test cases make to tasks are made in the task's editor on the Gantt (SC-067).

/** The red of the approved design (SRC-249), as the browser gives a computed colour. */
const RED = 'rgb(239, 68, 68)'

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

/** Opens the Gantt of the project `name` from the navigation, and gives the Gantt. */
async function openGantt(page: Page, name: string): Promise<Locator> {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Navigation' }).getByRole('link', { name }).click()
  await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Gantt' }).click()
  const gantt = page.getByRole('table', { name: `Gantt of ${name}` })
  await expect(gantt).toBeVisible()
  return gantt
}

/** The row of the task titled `title` on the Gantt. */
const row = (gantt: Locator, title: string) => gantt.getByRole('row', { name: title, exact: true })

/** The bar or milestone of the task titled `title` on the Gantt. */
const bar = (gantt: Locator, title: string) =>
  row(gantt, title).getByRole('img', { name: new RegExp(`^${title}: `) })

/** The colour the bar or milestone of the task titled `title` is drawn in. */
const colourOf = (gantt: Locator, title: string) =>
  bar(gantt, title).evaluate((element) => getComputedStyle(element).backgroundColor)

/** Checks that the bar of `title` lies on the columns of the days `from` to `to`, and no others. */
async function expectDrawnFrom(gantt: Locator, title: string, from: string, to: string) {
  const box = await bar(gantt, title).boundingBox()
  const first = await gantt.locator(`[data-date="${from}"]`).boundingBox()
  const last = await gantt.locator(`[data-date="${to}"]`).boundingBox()
  if (!box || !first || !last) throw new Error(`${title} or its days are not drawn`)
  expect(box.x).toBeGreaterThanOrEqual(first.x)
  expect(box.x).toBeLessThan(first.x + first.width / 2)
  expect(box.x + box.width).toBeLessThanOrEqual(last.x + last.width)
  expect(box.x + box.width).toBeGreaterThan(last.x + last.width / 2)
}

/** Checks that the milestone `title` is drawn on the column of the day `on`. */
async function expectMilestoneOn(gantt: Locator, title: string, on: string) {
  const box = await bar(gantt, title).boundingBox()
  const day = await gantt.locator(`[data-date="${on}"]`).boundingBox()
  if (!box || !day) throw new Error(`${title} or ${on} is not drawn`)
  const centre = box.x + box.width / 2
  expect(centre).toBeGreaterThan(day.x)
  expect(centre).toBeLessThan(day.x + day.width)
}

/** A dependency arrow on the Gantt: `task` blocked by `blocker`. */
const arrow = (gantt: Locator, task: string, blocker: string) =>
  gantt
    .getByRole('group', { name: 'Dependencies' })
    .getByRole('img', { name: new RegExp(`^${task} is blocked by ${blocker}(,|$)`) })

/** The project `name`, created by the person signed in on `page`; gives its id. */
async function createProject(page: Page, name: string): Promise<string> {
  return idOf(await call(page, 'POST', '/projects', { name }))
}

test('TC-067: the Gantt shows the schedule, a dependency and a milestone', async ({
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
  const b = await createTask(page, apollo, { title: 'B', durationWorkingDays: 2 })
  await block(page, b, a)
  const m = await createTask(page, apollo, {
    title: 'M',
    milestone: { variant: 'fixed-date', date: '2027-03-12' },
  })
  await block(page, m, b)

  // Step 1: as alice, open the Gantt of Apollo in the browser.
  const gantt = await openGantt(page, 'Apollo')

  // A is drawn from 2027-03-01 to 2027-03-03 and B from 2027-03-04 to 2027-03-05.
  await expect(bar(gantt, 'A')).toHaveAccessibleName('A: 1 Mar 2027 to 3 Mar 2027')
  await expectDrawnFrom(gantt, 'A', '2027-03-01', '2027-03-03')
  await expect(bar(gantt, 'B')).toHaveAccessibleName('B: 4 Mar 2027 to 5 Mar 2027')
  await expectDrawnFrom(gantt, 'B', '2027-03-04', '2027-03-05')

  // The dependency of B on A and of M on B are drawn.
  await expect(arrow(gantt, 'B', 'A')).toBeAttached()
  await expect(arrow(gantt, 'M', 'B')).toBeAttached()
  await expect(arrow(gantt, 'B', 'A').locator('path')).toHaveAttribute('d', /^M/)

  // M is drawn as a milestone on 2027-03-12.
  await expect(bar(gantt, 'M')).toHaveAccessibleName('M: fixed-date milestone on 12 Mar 2027')
  await expectMilestoneOn(gantt, 'M', '2027-03-12')

  // Negative: no constraint violation is shown in red, since none exists.
  await expect(gantt.locator('[data-red="true"]')).toHaveCount(0)
  for (const title of ['A', 'B']) expect(await colourOf(gantt, title)).not.toBe(RED)
  expect(await colourOf(gantt, 'M')).not.toBe(RED)

  await page.context().close()
})

test('TC-021: a milestone pushed past its fixed date shows a red violation on the Gantt (browser: the red violation)', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  const a = await createTask(page, apollo, {
    title: 'A',
    plannedStart: '2027-03-01',
    durationWorkingDays: 5,
  })
  const m = await createTask(page, apollo, {
    title: 'M',
    milestone: { variant: 'fixed-date', date: '2027-03-12' },
  })
  await block(page, m, a)

  // Step 1: M shows no red violation.
  let gantt = await openGantt(page, 'Apollo')
  await expect(row(gantt, 'M')).toHaveAttribute('data-red', 'false')
  expect(await colourOf(gantt, 'M')).not.toBe(RED)
  await expect(arrow(gantt, 'M', 'A')).toHaveAttribute('data-red', 'false')

  // Step 2: A's duration becomes 15 working days, finishing 2027-03-19, in A's editor on the
  // Gantt (SC-067).
  await gantt.getByRole('button', { name: 'Edit A' }).click()
  const editor = page.getByRole('dialog', { name: 'Edit A' })
  await editor.getByLabel('Duration in working days').fill('15')
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(editor).toHaveCount(0)

  // Step 3: reload the Gantt. The violation on M, and on its dependency on A, is red.
  await page.reload()
  gantt = page.getByRole('table', { name: 'Gantt of Apollo' })
  await expect(row(gantt, 'M')).toHaveAttribute('data-red', 'true')
  expect(await colourOf(gantt, 'M')).toBe(RED)
  await expect(row(gantt, 'M')).toContainText('Fixed 12 Mar · pushed: blocker ends 19 Mar')
  await expect(arrow(gantt, 'M', 'A')).toHaveAttribute('data-red', 'true')
  expect(
    await arrow(gantt, 'M', 'A')
      .locator('path')
      .evaluate((path) => getComputedStyle(path).stroke),
  ).toBe(RED)

  // Negative: M is still drawn on 2027-03-12.
  await expectMilestoneOn(gantt, 'M', '2027-03-12')

  await page.context().close()
})

test('TC-029: a task turns red when an assigned person is overloaded during it (browser: T1 red on the Gantt)', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  await createTask(page, apollo, {
    title: 'T1',
    assignees: [alice.id],
    aiShare: 0,
    plannedStart: '2027-03-01',
    durationWorkingDays: 3,
  })
  await createTask(page, apollo, { title: 'T2', assignees: [alice.id], aiShare: 0 })

  // Step 1: T1 is not red.
  let gantt = await openGantt(page, 'Apollo')
  await expect(row(gantt, 'T1')).toHaveAttribute('data-red', 'false')
  expect(await colourOf(gantt, 'T1')).not.toBe(RED)

  // Step 2: T2 gets its dates, putting alice at 200% on 2027-03-03, in T2's editor on the Gantt
  // (SC-067).
  await gantt.getByRole('button', { name: 'Edit T2' }).click()
  const editor = page.getByRole('dialog', { name: 'Edit T2' })
  await editor.getByLabel('Planned start').fill('2027-03-03')
  await editor.getByLabel('Duration in working days').fill('1')
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(editor).toHaveCount(0)

  // Step 3: reload. T1 and T2 are both shown in red.
  await page.reload()
  gantt = page.getByRole('table', { name: 'Gantt of Apollo' })
  for (const title of ['T1', 'T2']) {
    await expect(row(gantt, title)).toHaveAttribute('data-red', 'true')
    expect(await colourOf(gantt, title)).toBe(RED)
  }

  // Negative: neither task's dates change.
  await expect(bar(gantt, 'T1')).toHaveAccessibleName(/^T1: 1 Mar 2027 to 3 Mar 2027/)
  await expect(bar(gantt, 'T2')).toHaveAccessibleName(/^T2: 3 Mar 2027 to 3 Mar 2027/)

  await page.context().close()
})

test('TC-030: a task turns red when an assigned person takes a day off during it (browser: T red on the Gantt)', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  await createTask(page, apollo, {
    title: 'T',
    assignees: [alice.id],
    plannedStart: '2027-03-01',
    durationWorkingDays: 3,
  })

  // Step 1: T is not red.
  let gantt = await openGantt(page, 'Apollo')
  await expect(row(gantt, 'T')).toHaveAttribute('data-red', 'false')
  expect(await colourOf(gantt, 'T')).not.toBe(RED)

  // Step 2: alice adds a day off on 2027-03-02 to their own calendar. The calendar screen is node
  // F10's; until then the change goes through the REST API.
  await call(page, 'PATCH', `/accounts/${alice.id}/calendar`, { addHolidays: ['2027-03-02'] })

  // Step 3: reload. T is shown in red.
  await page.reload()
  gantt = page.getByRole('table', { name: 'Gantt of Apollo' })
  await expect(row(gantt, 'T')).toHaveAttribute('data-red', 'true')
  expect(await colourOf(gantt, 'T')).toBe(RED)

  // Negative: T still runs 2027-03-01 to 2027-03-03.
  await expect(bar(gantt, 'T')).toHaveAccessibleName(/^T: 1 Mar 2027 to 3 Mar 2027/)
  await expectDrawnFrom(gantt, 'T', '2027-03-01', '2027-03-03')

  await page.context().close()
})

test('TC-031: a red overload flag clears once the overload is gone (browser: the red clears on the Gantt)', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  const assigned = { assignees: [alice.id], aiShare: 0 }
  await createTask(page, apollo, {
    title: 'T1',
    ...assigned,
    plannedStart: '2027-03-01',
    durationWorkingDays: 3,
  })
  await createTask(page, apollo, {
    title: 'T2',
    ...assigned,
    plannedStart: '2027-03-03',
    durationWorkingDays: 1,
  })

  // Step 1: T1 and T2 are red.
  let gantt = await openGantt(page, 'Apollo')
  for (const title of ['T1', 'T2']) {
    await expect(row(gantt, title)).toHaveAttribute('data-red', 'true')
    expect(await colourOf(gantt, title)).toBe(RED)
  }

  // Step 2: remove alice from T2's assigned people, in T2's editor on the Gantt (SC-067).
  await gantt.getByRole('button', { name: 'Edit T2' }).click()
  const editor = page.getByRole('dialog', { name: 'Edit T2' })
  await editor.getByRole('checkbox', { name: 'alice' }).uncheck()
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(editor).toHaveCount(0)

  // Step 3: reload. Neither T1 nor T2 is red.
  await page.reload()
  gantt = page.getByRole('table', { name: 'Gantt of Apollo' })
  for (const title of ['T1', 'T2']) {
    await expect(row(gantt, title)).toHaveAttribute('data-red', 'false')
    expect(await colourOf(gantt, title)).not.toBe(RED)
  }

  // Negative: neither task's dates change.
  await expect(bar(gantt, 'T1')).toHaveAccessibleName('T1: 1 Mar 2027 to 3 Mar 2027')
  await expect(bar(gantt, 'T2')).toHaveAccessibleName('T2: 3 Mar 2027 to 3 Mar 2027')

  await page.context().close()
})

test('TC-064: the four view kinds are available for a project (the Gantt)', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  await createTask(page, apollo, { title: 'T', plannedStart: '2027-03-01', durationWorkingDays: 2 })
  await call(page, 'POST', `/projects/${apollo}/baselines`, { name: 'v1' })
  const before = await call(page, 'GET', `/projects/${apollo}/tasks`)

  // Step 1, the Gantt: it opens and shows T. The Kanban is in kanban.spec.ts, the person load view in
  // person-load.spec.ts, the baseline variance view in baseline-variance.spec.ts.
  const gantt = await openGantt(page, 'Apollo')
  await expect(bar(gantt, 'T')).toHaveAccessibleName('T: 1 Mar 2027 to 2 Mar 2027')

  // Negative: opening it changes no task.
  expect(await call(page, 'GET', `/projects/${apollo}/tasks`)).toEqual(before)

  await page.context().close()
})

test("TC-154: a read-only member sees every view and the project's data (the Gantt)", async ({
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

  // Step 1, the Gantt: as bob, it opens and shows T. The Kanban is in kanban.spec.ts, the person load
  // view in person-load.spec.ts, the baseline variance view in baseline-variance.spec.ts. Pending:
  // the saved view Board (SC-020, SC-091, F22), and step 2's reads through the REST API (see
  // backend/test/integration/project-roles.test.ts).
  const bobsPage = await signedIn(browser, deployment.url, bob)
  const gantt = await openGantt(bobsPage, 'Apollo')
  await expect(bar(gantt, 'T')).toHaveAccessibleName('T: 1 Mar 2027 to 1 Mar 2027')
  await expect(row(gantt, 'T').getByTitle('alice')).toHaveText('AL')

  // Negative: the view does not refuse bob access.
  await expect(bobsPage.getByRole('alert')).toHaveCount(0)

  await alicesPage.context().close()
  await bobsPage.context().close()
})
