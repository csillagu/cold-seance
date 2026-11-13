import type { Browser, Locator, Page } from '@playwright/test'
import { type Account, expect, test } from '../fixtures.ts'

// In-place editing on the Gantt (SC-067): the browser steps of the test cases it makes pass. The
// inputs are put in place through the REST API, in the browser's own session; the changes the
// test cases make on the Gantt are made on it, with the mouse, as a person drags a bar or draws a
// dependency.
//
// Pending: the parts on the Gantt of TC-084, TC-085, TC-086 and TC-087, which open "a personal
// view of alice's covering Apollo and Borealis": saved views (SC-020, B06) and their editor
// (SC-091, F22) are not built, so no Gantt covers several projects yet. On the Gantt, a change to a
// task goes to the REST API, which allows or refuses it by the viewer's role in the task's project
// (backend/test/integration/task-roles.test.ts; roles held through a group,
// project-roles.test.ts), and a refusal is shown (TC-018 below). The question of a new task's
// project on a Gantt covering several, offering only the projects the viewer can write to, or
// none when the view's filter allows one project (FR-061), is tested on the dialog
// (frontend/src/gantt/GanttNewTaskDialog.test.tsx); the views that open such a Gantt are those
// nodes'.

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

/** A field of `task` as the REST API reads it. */
async function fieldOf(page: Page, task: string, field: string): Promise<unknown> {
  const read = await call(page, 'GET', `/tasks/${task}`)
  if (typeof read !== 'object' || read === null) throw new Error('The answer is not a task')
  return Object.entries(read).find(([key]) => key === field)?.[1]
}

/** The ids of the tasks `task` is blocked by, as the REST API reads them. */
async function blockersOf(page: Page, task: string): Promise<string[]> {
  const blockedBy = await fieldOfPath(page, `/tasks/${task}/relations`, 'blockedBy')
  if (!Array.isArray(blockedBy)) throw new Error('The answer holds no blockers')
  return blockedBy.map((blocker: unknown) => idOf(blocker))
}

/** A field of what the REST API answers at `path`. */
async function fieldOfPath(page: Page, path: string, field: string): Promise<unknown> {
  const read = await call(page, 'GET', path)
  if (typeof read !== 'object' || read === null) throw new Error('The answer is not an object')
  return Object.entries(read).find(([key]) => key === field)?.[1]
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

/** The bar of the task titled `title` on the Gantt. */
const bar = (gantt: Locator, title: string) =>
  row(gantt, title).getByRole('img', { name: new RegExp(`^${title}: `) })

/** The middle of what `locator` finds on the page. */
async function middleOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('It is not drawn')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** How far apart, in pixels, the columns of the days `from` and `to` are on the Gantt. */
async function distance(gantt: Locator, from: string, to: string): Promise<number> {
  const a = await middleOf(gantt.locator(`[data-date="${from}"]`))
  const b = await middleOf(gantt.locator(`[data-date="${to}"]`))
  return b.x - a.x
}

/** Drags with the mouse from `from` to `to`, in steps, as a person does. */
async function dragMouse(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.up()
}

/** Drags the bar of `title` sideways from the day `from` to the day `to`. */
async function dragBar(page: Page, gantt: Locator, title: string, from: string, to: string) {
  const start = await middleOf(bar(gantt, title))
  const by = await distance(gantt, from, to)
  await dragMouse(page, start, { x: start.x + by, y: start.y })
}

/** Draws a dependency from the end of the bar of `blocker` to the bar of `task`. */
async function drawDependency(page: Page, gantt: Locator, blocker: string, task: string) {
  await row(gantt, blocker).hover()
  const handle = await middleOf(row(gantt, blocker).locator('.gantt__link-handle'))
  await dragMouse(page, handle, await middleOf(bar(gantt, task)))
}

/** A dependency arrow on the Gantt: `task` blocked by `blocker`. */
const arrow = (gantt: Locator, task: string, blocker: string) =>
  gantt
    .getByRole('group', { name: 'Dependencies' })
    .getByRole('img', { name: new RegExp(`^${task} is blocked by ${blocker}(,|$)`) })

test("TC-072: a task's dates shown on the Gantt can be edited on the Gantt", async ({
  browser,
  deployment,
  baseURL,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, baseURL!, alice)
  const apollo = await createProject(page, 'Apollo')
  const a = await createTask(page, apollo, {
    title: 'A',
    plannedStart: '2027-03-01',
    durationWorkingDays: 1,
  })
  const b = await createTask(page, apollo, {
    title: 'B',
    plannedStart: '2027-03-08',
    durationWorkingDays: 1,
  })

  // Step 1: alice opens the Gantt of Apollo.
  const gantt = await openGantt(page, 'Apollo')
  const ganttAddress = page.url()

  // Step 2: alice moves A to start on 2027-03-02, by dragging its bar one day to the right.
  await dragBar(page, gantt, 'A', '2027-03-01', '2027-03-02')
  await expect(bar(gantt, 'A')).toHaveAttribute('data-start', '2027-03-02')

  // Step 3: alice draws a dependency making B blocked by A.
  await drawDependency(page, gantt, 'A', 'B')
  await expect(arrow(gantt, 'B', 'A')).toBeVisible()

  // Neither change required leaving the Gantt.
  expect(page.url()).toBe(ganttAddress)
  await expect(page.getByRole('alert')).toHaveCount(0)

  // Step 4: A and B read back through the REST API.
  expect(await fieldOf(page, a, 'plannedStart')).toBe('2027-03-02')
  expect(await blockersOf(page, b)).toEqual([a])
})

test('TC-018: moving a task onto a company holiday is rejected in the UI', async ({
  browser,
  deployment,
  baseURL,
}) => {
  const root = await signedIn(browser, baseURL!, deployment.root)
  await call(root, 'PATCH', '/calendar', { addHolidays: ['2027-03-10'] })
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, baseURL!, alice)
  const apollo = await createProject(page, 'Apollo')
  const t = await createTask(page, apollo, {
    title: 'T',
    plannedStart: '2027-03-01',
    durationWorkingDays: 1,
  })

  // Step 1: alice opens the Gantt of Apollo and moves T to start on 2027-03-10.
  let gantt = await openGantt(page, 'Apollo')
  await dragBar(page, gantt, 'T', '2027-03-01', '2027-03-10')

  // The UI reports that the move was rejected.
  await expect(page.getByRole('alert')).toContainText('T was not moved')
  await expect(page.getByRole('alert')).toContainText('2027-03-10')
  await expect(bar(gantt, 'T')).toHaveAttribute('data-start', '2027-03-01')

  // Step 2: after a reload, T is still on 2027-03-01, through the Gantt and the REST API.
  await page.reload()
  gantt = page.getByRole('table', { name: 'Gantt of Apollo' })
  await expect(bar(gantt, 'T')).toHaveAttribute('data-start', '2027-03-01')
  await expect(bar(gantt, 'T')).toHaveAttribute('data-finish', '2027-03-01')
  expect(await fieldOf(page, t, 'plannedStart')).toBe('2027-03-01')
  // T is not stored on 2027-03-10 or on any other new date.
  expect(await fieldOf(page, t, 'plannedFinish')).toBe('2027-03-01')
})
