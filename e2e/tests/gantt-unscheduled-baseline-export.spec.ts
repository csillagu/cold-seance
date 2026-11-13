import { createRequire } from 'node:module'
import type { Browser, Locator, Page } from '@playwright/test'
import { type Account, expect, test } from '../fixtures.ts'

// The Gantt's unscheduled and cancelled tasks (SC-064), its baseline bars (SC-065) and its export
// dialog (SC-096): the browser steps of the test cases they make pass. The inputs are put in place
// through the REST API, in the browser's own session, until the screens that make them are built
// (cancelling a task, F12; saving a baseline, F21; editing a task on the Gantt, F19).

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

/** Checks that `drawn` lies on the columns of the days `from` to `to`, and no others. */
async function expectOnDays(gantt: Locator, drawn: Locator, from: string, to: string) {
  const box = await drawn.boundingBox()
  const first = await gantt.locator(`[data-date="${from}"]`).boundingBox()
  const last = await gantt.locator(`[data-date="${to}"]`).boundingBox()
  if (!box || !first || !last) throw new Error(`The bar or its days ${from}–${to} are not drawn`)
  expect(box.x).toBeGreaterThanOrEqual(first.x)
  expect(box.x).toBeLessThan(first.x + first.width / 2)
  expect(box.x + box.width).toBeLessThanOrEqual(last.x + last.width)
  expect(box.x + box.width).toBeGreaterThan(last.x + last.width / 2)
}

/** How opaque `element` is drawn: the product of its own opacity and its ancestors'. */
const opacityOf = (element: Locator) =>
  element.evaluate((node) => {
    let opacity = 1
    for (let at: Element | null = node; at; at = at.parentElement) {
      opacity *= Number(getComputedStyle(at).opacity)
    }
    return opacity
  })

test('TC-005: an unscheduled task appears on the Gantt', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  const triage = await createTask(page, apollo, { title: 'Triage backlog' })
  await createTask(page, apollo, {
    title: 'Write guide',
    plannedStart: '2027-03-01',
    durationWorkingDays: 2,
  })

  // Step 1: as alice, open the Gantt view of Apollo in the browser.
  const gantt = await openGantt(page, 'Apollo')

  // Triage backlog is shown on the Gantt, on the same page as the scheduled task: no filter and
  // no separate page hides it.
  await expect(row(gantt, 'Triage backlog')).toBeVisible()
  await expect(row(gantt, 'Triage backlog')).toContainText('No planned dates')

  // Write guide is shown as a bar from 2027-03-01 to 2027-03-02.
  await expect(bar(gantt, 'Write guide')).toHaveAccessibleName(
    'Write guide: 1 Mar 2027 to 2 Mar 2027',
  )
  await expectOnDays(gantt, bar(gantt, 'Write guide'), '2027-03-01', '2027-03-02')

  // Negative: showing it gives Triage backlog no dates.
  await expect(row(gantt, 'Triage backlog').getByRole('img')).toHaveCount(0)
  expect(await call(page, 'GET', `/tasks/${triage}`)).toMatchObject({
    plannedStart: null,
    plannedFinish: null,
  })

  await page.context().close()
})

test('TC-192: a cancelled task stays on the Gantt, faded', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  const day = { plannedStart: '2027-03-01', durationWorkingDays: 1 }
  const t = await createTask(page, apollo, { title: 'T', ...day })
  await createTask(page, apollo, { title: 'U', ...day })
  let gantt = await openGantt(page, 'Apollo')
  const before = await opacityOf(bar(gantt, 'U'))

  // Step 1: as alice, cancel T. The cancel action is node F12's; until then it goes through the
  // REST API.
  await call(page, 'POST', `/tasks/${t}/cancel`)

  // Step 2: open the Gantt of Apollo.
  gantt = await openGantt(page, 'Apollo')

  // T's bar is still shown, on 2027-03-01, visibly fainter than U's.
  await expect(bar(gantt, 'T')).toHaveAccessibleName('T: 1 Mar 2027 to 1 Mar 2027, cancelled')
  await expectOnDays(gantt, bar(gantt, 'T'), '2027-03-01', '2027-03-01')
  const faded = await opacityOf(bar(gantt, 'T'))
  const u = await opacityOf(bar(gantt, 'U'))
  expect(faded).toBeLessThanOrEqual(u / 2)

  // Negative: U is drawn as before.
  await expect(bar(gantt, 'U')).toHaveAccessibleName('U: 1 Mar 2027 to 1 Mar 2027')
  await expectOnDays(gantt, bar(gantt, 'U'), '2027-03-01', '2027-03-01')
  expect(u).toBe(before)

  await page.context().close()
})

test('TC-215: unscheduled tasks are laid at the bottom of the Gantt', async ({
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

  // Step 1: as alice, open the Gantt of Apollo.
  const gantt = await openGantt(page, 'Apollo')

  // U's row is below the rows of S1 and S2; no scheduled task's row is below U's.
  const top = async (title: string) => {
    const box = await row(gantt, title).boundingBox()
    if (!box) throw new Error(`${title}'s row is not drawn`)
    return box.y
  }
  const u = await top('U')
  expect(u).toBeGreaterThan(await top('S1'))
  expect(u).toBeGreaterThan(await top('S2'))
  const rows = await gantt.getByRole('row').evaluateAll((all) =>
    all.map((each) => ({
      title: each.getAttribute('aria-label'),
      unscheduled: each.getAttribute('data-unscheduled') === 'true',
      y: each.getBoundingClientRect().y,
    })),
  )
  for (const scheduled of rows.filter((each) => each.title && !each.unscheduled)) {
    if (scheduled.title === 'Unscheduled') continue
    expect(scheduled.y, `${scheduled.title} is above U`).toBeLessThan(u)
  }

  await page.context().close()
})

test('TC-068: a selected baseline is drawn as bars on the Gantt', async ({
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
  // Baseline v1 is saved while T is on 2027-03-01 to 2027-03-03, then T moves to 2027-03-08. The
  // baseline save dialog is node F21's and editing on the Gantt node F19's; until then both go
  // through the REST API.
  await call(page, 'POST', `/projects/${apollo}/baselines`, { name: 'v1' })
  await call(page, 'PATCH', `/tasks/${t}`, { plannedStart: '2027-03-08' })
  const before = await call(page, 'GET', `/projects/${apollo}/tasks`)

  // Step 1: as alice, open the Gantt of Apollo and select baseline v1.
  const gantt = await openGantt(page, 'Apollo')
  await expect(gantt.getByRole('img', { name: /^Baseline / })).toHaveCount(0)
  const select = page.getByRole('combobox', { name: 'Baseline:' })
  const v1 = await select.getByRole('option', { name: /^v1 \(/ }).getAttribute('value')
  await select.selectOption(v1 ?? '')

  // T's current bar runs 2027-03-08 to 2027-03-10.
  await expect(bar(gantt, 'T')).toHaveAccessibleName('T: 8 Mar 2027 to 10 Mar 2027')
  await expectOnDays(gantt, bar(gantt, 'T'), '2027-03-08', '2027-03-10')

  // A baseline bar for T runs 2027-03-01 to 2027-03-03.
  const baseline = row(gantt, 'T').getByRole('img', {
    name: 'Baseline v1 of T: 1 Mar 2027 to 3 Mar 2027',
  })
  await expect(baseline).toBeVisible()
  await expectOnDays(gantt, baseline, '2027-03-01', '2027-03-03')

  // Negative: selecting the baseline changes no task's dates.
  expect(await call(page, 'GET', `/projects/${apollo}/tasks`)).toEqual(before)

  await page.context().close()
})

/** Mermaid's browser build: what GitHub draws a `mermaid` code block with. */
const mermaidScript = createRequire(import.meta.url).resolve('mermaid/dist/mermaid.min.js')

test('TC-089: the exported Gantt renders in GitHub markdown with tasks, dates, dependencies and milestones', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  const busy = { assignees: [alice.id], aiShare: 0, plannedStart: '2027-03-01' }
  const a = await createTask(page, apollo, { title: 'A', ...busy, durationWorkingDays: 3 })
  await createTask(page, apollo, { title: 'B', ...busy, durationWorkingDays: 1 })
  const c = await createTask(page, apollo, { title: 'C', durationWorkingDays: 2 })
  await call(page, 'POST', `/tasks/${c}/blocked-by`, { blockerId: a })
  const m = await createTask(page, apollo, {
    title: 'M',
    milestone: { variant: 'fixed-date', date: '2027-03-12' },
  })
  await call(page, 'POST', `/tasks/${m}/blocked-by`, { blockerId: c })

  // Step 1: as alice, export the Gantt of Apollo. alice is overloaded, so A and B are red on it.
  const gantt = await openGantt(page, 'Apollo')
  await expect(row(gantt, 'A')).toHaveAttribute('data-red', 'true')
  await page.getByRole('button', { name: 'Export as Mermaid' }).click()
  const dialog = page.getByRole('dialog', { name: 'Export as Mermaid' })
  const text = dialog.getByRole('textbox', { name: 'Mermaid chart' })
  await expect(text).toBeVisible()
  const exported = await text.inputValue()

  // The export holds A, B, C and M on their dates, and the dependencies C on A and M on C.
  expect(exported).toContain('\n    A : 2027-03-01, 2027-03-03\n')
  expect(exported).toContain('\n    B : 2027-03-01, 2027-03-01\n')
  expect(exported).toContain('\n    C (after A) : 2027-03-04, 2027-03-05\n')
  expect(exported).toContain('\n    M (after C) : milestone, 2027-03-12, 0d\n')

  // Negative: no load figure for alice, and no red flag or red marking.
  expect(exported).not.toMatch(/%|alice|load|crit|red/i)

  // Step 2: GitHub draws a `mermaid` code block in a markdown file with Mermaid. A GitHub test
  // repository is not reachable from the browser tests, so the block is drawn here with Mermaid
  // itself, in the browser, as GitHub's rendered view of the file does.
  const fence = /^```mermaid\n([\s\S]*)\n```\n?$/.exec(exported)
  expect(fence, 'the export is one fenced mermaid code block').not.toBeNull()
  const chart = await page.context().newPage()
  await chart.addScriptTag({ path: mermaidScript })
  const drawn = await chart.evaluate(async (code) => {
    const { mermaid } = window
    mermaid.initialize({ startOnLoad: false })
    const { svg } = await mermaid.render('chart', code)
    document.body.innerHTML = svg
    const tasks = [...document.querySelectorAll('rect.task')].map((rect) => {
      const box = rect.getBoundingClientRect()
      return { classes: rect.getAttribute('class') ?? '', x: box.x, width: box.width }
    })
    const labels = [...document.querySelectorAll('text[class*="Text"][id$="-text"]')].map((label) =>
      label.textContent.trim(),
    )
    return { tasks, labels, text: document.body.textContent }
  }, fence![1]!)

  // GitHub renders the export as a chart, not as plain text or an error.
  expect(drawn.text).not.toMatch(/syntax error/i)
  expect(drawn.labels).toEqual(['A', 'B', 'C (after A)', 'M (after C)'])
  const [barA, barB, barC, barM] = drawn.tasks
  if (!barA || !barB || !barC || !barM) throw new Error('A task is not drawn')
  // A lasts three days and B one, both from 2027-03-01; C follows A for two days; M is a milestone,
  // eleven days after 2027-03-01, on 2027-03-12.
  expect(barA.x).toBeCloseTo(barB.x, 0)
  expect(barA.width / barB.width).toBeCloseTo(3, 1)
  expect(barC.x).toBeCloseTo(barA.x + barA.width, 0)
  expect(barC.width / barB.width).toBeCloseTo(2, 1)
  expect(barM.classes).toMatch(/milestone/)
  const day = barB.width
  const mCentre = (barM.x + barM.width / 2 - barA.x) / day
  expect(mCentre).toBeGreaterThanOrEqual(11)
  expect(mCentre).toBeLessThanOrEqual(12)

  await page.context().close()
})

declare global {
  interface Window {
    /** Mermaid's browser build, once its script is on the page. */
    mermaid: MermaidApi
  }
}

/** The part of Mermaid's browser API the test uses. */
interface MermaidApi {
  initialize(config: { startOnLoad: boolean }): void
  render(id: string, code: string): Promise<{ svg: string }>
}
