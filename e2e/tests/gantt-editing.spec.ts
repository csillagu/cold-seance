import type { Browser, Locator, Page } from '@playwright/test'
import { type Account, expect, test } from '../fixtures.ts'

// In-place editing on the Gantt (SC-067): the browser steps of the test cases it makes pass. The
// inputs are put in place through the REST API, in the browser's own session; the changes the
// test cases make on the Gantt are made on it, with the mouse, as a person drags a bar or draws a
// dependency.
//
// Pending: the parts on the Gantt of TC-084, TC-085, TC-086 and TC-087, which open "a personal
// view of alice's covering Apollo and Borealis". Saved views covering several projects are built
// now (SC-020, SC-091; saved-views.spec.ts), after this node, but an opened saved view's Gantt only
// shows: editing on it, and these parts, are left for a follow-up, named in the Open points of
// PR #208. On the Gantt, a change to a
// task goes to the REST API, which allows or refuses it by the viewer's role in the task's project
// (backend/test/integration/task-roles.test.ts; roles held through a group,
// project-roles.test.ts), and a refusal is shown (TC-018 below). The question of a new task's
// project on a Gantt covering several, offering only the projects the viewer can write to, or
// none when the view's filter allows one project (FR-061), is tested on the dialog
// (frontend/src/gantt/GanttNewTaskDialog.test.tsx).

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

/** Drags the `end` of the bar of `title`, its start or its finish, from the day `from` to `to`. */
async function dragEnd(
  page: Page,
  gantt: Locator,
  title: string,
  end: 'start' | 'finish',
  from: string,
  to: string,
) {
  const grip = await middleOf(bar(gantt, title).locator(`[data-resize="${end}"]`))
  const by = await distance(gantt, from, to)
  await dragMouse(page, grip, { x: grip.x + by, y: grip.y })
}

test('#223: a bar is resized by its ends, the other end staying put', async ({
  browser,
  deployment,
  baseURL,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, baseURL!, alice)
  const apollo = await createProject(page, 'Apollo')
  // Monday 2027-03-01 to Friday 2027-03-05.
  const r = await createTask(page, apollo, {
    title: 'R',
    plannedStart: '2027-03-01',
    durationWorkingDays: 5,
  })
  const gantt = await openGantt(page, 'Apollo')
  await expect(bar(gantt, 'R').locator('[data-resize="finish"]')).toHaveCSS('cursor', 'ew-resize')
  await expect(bar(gantt, 'R')).toHaveCSS('cursor', 'grab')

  // The right end, dragged from Friday to Monday: the finish moves, the start stays.
  await dragEnd(page, gantt, 'R', 'finish', '2027-03-05', '2027-03-08')
  await expect(bar(gantt, 'R')).toHaveAttribute('data-finish', '2027-03-08')
  await expect(bar(gantt, 'R')).toHaveAttribute('data-start', '2027-03-01')
  expect(await fieldOf(page, r, 'durationWorkingDays')).toBe(6)

  // The left end, dragged from Monday to Wednesday: the start moves, the finish stays.
  await dragEnd(page, gantt, 'R', 'start', '2027-03-01', '2027-03-03')
  await expect(bar(gantt, 'R')).toHaveAttribute('data-start', '2027-03-03')
  await expect(bar(gantt, 'R')).toHaveAttribute('data-finish', '2027-03-08')
  expect(await fieldOf(page, r, 'plannedStart')).toBe('2027-03-03')
  expect(await fieldOf(page, r, 'durationWorkingDays')).toBe(4)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('#223: a done task is frozen on the Gantt', async ({ browser, deployment, baseURL }) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, baseURL!, alice)
  const apollo = await createProject(page, 'Apollo')
  const d = await createTask(page, apollo, {
    title: 'D',
    plannedStart: '2027-03-01',
    durationWorkingDays: 2,
  })
  await call(page, 'PUT', `/tasks/${d}/status`, { status: 'done' })
  const gantt = await openGantt(page, 'Apollo')

  // No resize ends and no grab cursor.
  await expect(bar(gantt, 'D')).toHaveAttribute('data-movable', 'false')
  await expect(bar(gantt, 'D').locator('[data-resize]')).toHaveCount(0)
  await expect(bar(gantt, 'D')).not.toHaveCSS('cursor', 'grab')

  // Dragged by its middle, it does not move.
  await dragBar(page, gantt, 'D', '2027-03-01', '2027-03-03')
  await expect(bar(gantt, 'D')).toHaveAttribute('data-start', '2027-03-01')
  expect(await fieldOf(page, d, 'plannedStart')).toBe('2027-03-01')
})

/** The lane of the unscheduled task `title`, drawn on to schedule it (#228). */
const drawLane = (gantt: Locator, title: string) => row(gantt, title).locator('[data-draw="lane"]')

/** The middle of the column of the day `date`, across the page, on the row of `title`. */
async function dayOn(gantt: Locator, title: string, date: string) {
  const column = await middleOf(gantt.locator(`[data-date="${date}"]`))
  const lane = await middleOf(drawLane(gantt, title))
  return { x: column.x, y: lane.y }
}

test('#228: an unscheduled task is scheduled by drawing its bar on its lane, right to left', async ({
  browser,
  deployment,
  baseURL,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, baseURL!, alice)
  const apollo = await createProject(page, 'Apollo')
  await createTask(page, apollo, { title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 1 })
  const u = await createTask(page, apollo, { title: 'U' })
  const gantt = await openGantt(page, 'Apollo')
  await expect(row(gantt, 'U')).toHaveAttribute('data-unscheduled', 'true')
  await expect(drawLane(gantt, 'U')).toHaveCSS('cursor', 'crosshair')

  // Hovering shows a faint day where a bar would start.
  const tuesday = await dayOn(gantt, 'U', '2027-03-09')
  await page.mouse.move(tuesday.x, tuesday.y)
  await expect(row(gantt, 'U').locator('[data-draw="preview"]')).toBeVisible()

  // Drawn from Tuesday 9 back to Wednesday 3 March: the earlier day is the start, and the labels
  // say the start, the finish and the working days, the weekend between not counted.
  const wednesday = await dayOn(gantt, 'U', '2027-03-03')
  await page.mouse.down()
  await page.mouse.move(wednesday.x, wednesday.y, { steps: 10 })
  const ghost = row(gantt, 'U').locator('[data-draw="ghost"]')
  await expect(ghost).toHaveAttribute('data-start', '2027-03-03')
  await expect(ghost).toHaveAttribute('data-finish', '2027-03-09')
  await expect(row(gantt, 'U').locator('[data-draw="label"]')).toHaveText(
    /3 Mar.*9 Mar.*5 working days/,
  )
  await page.mouse.up()

  // U moves up into the scheduled rows, selected, on the days drawn, and it is announced.
  await expect(bar(gantt, 'U')).toHaveAttribute('data-start', '2027-03-03')
  await expect(bar(gantt, 'U')).toHaveAttribute('data-finish', '2027-03-09')
  await expect(row(gantt, 'U')).not.toHaveAttribute('data-unscheduled')
  await expect(row(gantt, 'U')).toHaveAttribute('data-selected', 'true')
  await expect(page.getByRole('status').filter({ hasText: 'Scheduled U' })).toHaveText(
    'Scheduled U: 3 Mar – 9 Mar',
  )
  await expect(page.getByRole('alert')).toHaveCount(0)
  const rows = await gantt
    .getByRole('row')
    .evaluateAll((all) => all.map((one) => one.getAttribute('aria-label')))
  expect(rows.slice(1)).toEqual(['A', 'U'])

  // It stores the start and the working days; the finish is derived from them (FR-144).
  expect(await fieldOf(page, u, 'plannedStart')).toBe('2027-03-03')
  expect(await fieldOf(page, u, 'durationWorkingDays')).toBe(5)
  expect(await fieldOf(page, u, 'plannedFinish')).toBe('2027-03-09')
})

test('#228: a plain click, Escape and letting go off the lane change nothing', async ({
  browser,
  deployment,
  baseURL,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, baseURL!, alice)
  const apollo = await createProject(page, 'Apollo')
  await createTask(page, apollo, { title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 1 })
  const u = await createTask(page, apollo, { title: 'U' })
  const gantt = await openGantt(page, 'Apollo')
  const monday = await dayOn(gantt, 'U', '2027-03-01')
  const friday = await dayOn(gantt, 'U', '2027-03-05')

  // A plain click.
  await page.mouse.click(monday.x, monday.y)

  // Escape while drawing.
  await page.mouse.move(monday.x, monday.y)
  await page.mouse.down()
  await page.mouse.move(friday.x, friday.y, { steps: 5 })
  await expect(row(gantt, 'U').locator('[data-draw="ghost"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(row(gantt, 'U').locator('[data-draw="ghost"]')).toHaveCount(0)
  await page.mouse.up()

  // Let go on another row.
  await page.mouse.move(monday.x, monday.y)
  await page.mouse.down()
  await page.mouse.move(friday.x, friday.y - 40, { steps: 5 })
  await page.mouse.up()

  await expect(row(gantt, 'U')).toHaveAttribute('data-unscheduled', 'true')
  expect(await fieldOf(page, u, 'plannedStart')).toBeNull()
  expect(await fieldOf(page, u, 'durationWorkingDays')).toBeNull()
})

test('#228: a refused drawing goes back and the refusal is shown', async ({
  browser,
  deployment,
  baseURL,
}) => {
  const root = await signedIn(browser, baseURL!, deployment.root)
  await call(root, 'PATCH', '/calendar', { addHolidays: ['2027-03-10'] })
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, baseURL!, alice)
  const apollo = await createProject(page, 'Apollo')
  await createTask(page, apollo, { title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 1 })
  const u = await createTask(page, apollo, { title: 'U' })
  const gantt = await openGantt(page, 'Apollo')

  // Drawn from the company holiday, which a task cannot start on.
  await dragMouse(
    page,
    await dayOn(gantt, 'U', '2027-03-10'),
    await dayOn(gantt, 'U', '2027-03-12'),
  )
  await expect(page.getByRole('alert')).toContainText('U was not scheduled')
  await expect(row(gantt, 'U')).toHaveAttribute('data-unscheduled', 'true')
  await expect(row(gantt, 'U').locator('[data-draw="saving"]')).toHaveCount(0)
  expect(await fieldOf(page, u, 'plannedStart')).toBeNull()
})

test('#228: the lanes of a done task and of a floating milestone are inert', async ({
  browser,
  deployment,
  baseURL,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, baseURL!, alice)
  const apollo = await createProject(page, 'Apollo')
  await createTask(page, apollo, { title: 'A', plannedStart: '2027-03-01', durationWorkingDays: 1 })
  const d = await createTask(page, apollo, { title: 'D' })
  await call(page, 'PUT', `/tasks/${d}/status`, { status: 'done' })
  await createTask(page, apollo, { title: 'F', milestone: { variant: 'floating' } })
  const gantt = await openGantt(page, 'Apollo')

  for (const title of ['D', 'F']) {
    await expect(row(gantt, title)).toHaveAttribute('data-unscheduled', 'true')
    await expect(drawLane(gantt, title)).toHaveCount(0)
    await expect(row(gantt, title).getByRole('cell').last()).not.toHaveCSS('cursor', 'crosshair')
  }
})
