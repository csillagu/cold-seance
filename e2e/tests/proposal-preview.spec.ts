import type { Browser, Locator, Page } from '@playwright/test'
import type { Channel } from '../../backend/src/service/caller.ts'
import { createServices } from '../../backend/src/service/services.ts'
import { type Account, type Deployment, expect, test } from '../fixtures.ts'

// The proposal preview screen (SC-034): the browser steps of the test cases it makes pass in full.
// What the preview holds comes from the REST API, whose part of each test case is tested in
// backend/test/integration/proposal-preview.test.ts. The test cases create each proposal through
// the MCP server, which comes with SC-027 (B19); until then it is created through the service
// layer with the channel the MCP server will give it, as the integration tests do. The other
// inputs are put in place through the REST API, in the browser's own session.

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
  const parsed: unknown = answer.text === '' ? null : JSON.parse(answer.text)
  return parsed
}

/** The id of what the REST API created, from its answer. */
function idOf(created: unknown): string {
  if (typeof created !== 'object' || created === null || !('id' in created)) {
    throw new Error('The answer holds no id')
  }
  return String(created.id)
}

const createProject = async (page: Page, name: string) =>
  idOf(await call(page, 'POST', '/projects', { name }))

const createTask = async (page: Page, project: string, fields: Record<string, unknown>) =>
  idOf(await call(page, 'POST', `/projects/${project}/tasks`, fields))

const block = (page: Page, task: string, blocker: string) =>
  call(page, 'POST', `/tasks/${task}/blocked-by`, { blockerId: blocker })

/** Reads an object through the REST API: a task or a proposal. */
async function read(page: Page, path: string): Promise<Record<string, unknown>> {
  const answer = await call(page, 'GET', path)
  if (typeof answer !== 'object' || answer === null) throw new Error(`${path} is not an object`)
  return { ...answer }
}

const readTask = (page: Page, id: string) => read(page, `/tasks/${id}`)

/** The changes of a proposal as the REST API gives it, from all its groups. */
function changesOf(proposal: Record<string, unknown>): unknown[] {
  const { groups } = proposal
  if (!Array.isArray(groups)) throw new Error('The proposal has no groups')
  return groups.flatMap((group: unknown) =>
    typeof group === 'object' &&
    group !== null &&
    'changes' in group &&
    Array.isArray(group.changes)
      ? group.changes
      : [],
  )
}

/** Creates a proposal of one group, by `account`, through the channel the MCP server gives. */
async function propose(
  deployment: Deployment,
  account: Account,
  changes: object[],
  channel: Channel = 'mcp',
): Promise<string> {
  const services = createServices(deployment.db)
  const proposal = await services.proposals.createProposal(
    { accountId: account.id, channel },
    { groups: [{ changes }] },
  )
  return proposal.id
}

/** Opens the proposal from the project's proposals, and gives the table of what would change. */
async function openProposal(page: Page, project: string): Promise<Locator> {
  await page.goto('/')
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: project })
    .click()
  await page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('link', { name: 'Proposals' })
    .click()
  await page
    .getByRole('table', { name: `Proposals of ${project}` })
    .getByRole('link', { name: /^Proposal of / })
    .click()
  const table = page.getByRole('table', { name: 'What would change' })
  await expect(table).toBeVisible()
  return table
}

/** The cells of the task titled `title` in what would change: start, finish, days, assigned. */
function cellsOf(table: Locator, title: string) {
  const cells = table.getByRole('row', { name: title, exact: true }).getByRole('cell')
  return {
    start: cells.nth(0),
    finish: cells.nth(1),
    days: cells.nth(2),
    assigned: cells.nth(3),
  }
}

const newRedFlags = (page: Page) => page.getByRole('list', { name: 'New red flags' })

/** The bar of the task titled `title` on the Gantt of `project`, opened from the project page. */
async function ganttBar(page: Page, project: string, title: string): Promise<Locator> {
  await page.goto('/')
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: project })
    .click()
  await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Gantt' }).click()
  const gantt = page.getByRole('table', { name: `Gantt of ${project}` })
  return gantt
    .getByRole('row', { name: title, exact: true })
    .getByRole('img', { name: new RegExp(`^${title}: `) })
}

test('TC-100: a proposal leaves the live plan unchanged before approval', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  const a = await createTask(page, apollo, {
    title: 'A',
    plannedStart: '2027-03-01',
    durationWorkingDays: 1,
  })

  // Step 1: create the proposal, moving A to 2027-03-08.
  await propose(deployment, alice, [
    { kind: 'update-task', task: { taskId: a }, fields: { plannedStart: '2027-03-08' } },
  ])
  const auditBefore = await call(page, 'GET', `/audit-log?projectId=${apollo}`)

  // Step 2: as alice, open it in the browser, without approving it. The preview moves A.
  const table = await openProposal(page, 'Apollo')
  await expect(cellsOf(table, 'A').start).toHaveText('1 Mar 2027 → 8 Mar 2027')

  // Step 3: A still starts 2027-03-01 in the REST API and on the plain Gantt.
  expect((await readTask(page, a)).plannedStart).toBe('2027-03-01')
  const bar = await ganttBar(page, 'Apollo', 'A')
  await expect(bar).toHaveAccessibleName('A: 1 Mar 2027 to 1 Mar 2027')
  await expect(bar).toHaveAttribute('data-start', '2027-03-01')

  // Negative: the audit log records no change to A, nor anything else, since it was created.
  expect(await call(page, 'GET', `/audit-log?projectId=${apollo}`)).toEqual(auditBefore)

  await page.context().close()
})

test('TC-101: opening a proposal previews its rescheduled differences and new red flags', async ({
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
  const b = await createTask(page, apollo, {
    title: 'B',
    durationWorkingDays: 2,
    assignees: [alice.id],
    aiShare: 0,
  })
  await block(page, b, a)
  await createTask(page, apollo, {
    title: 'C',
    plannedStart: '2027-03-09',
    durationWorkingDays: 1,
    assignees: [alice.id],
    aiShare: 0,
  })
  await propose(deployment, alice, [
    { kind: 'update-task', task: { taskId: a }, fields: { durationWorkingDays: 5 } },
  ])

  // Step 1: as alice, open the proposal in the browser. The preview shows A finishing 2027-03-05
  // and B moved to 2027-03-08 to 2027-03-09...
  const table = await openProposal(page, 'Apollo')
  await expect(cellsOf(table, 'A').finish).toHaveText('3 Mar 2027 → 5 Mar 2027')
  await expect(cellsOf(table, 'A').days).toHaveText('3 → 5')
  await expect(cellsOf(table, 'B').start).toHaveText('4 Mar 2027 → 8 Mar 2027')
  await expect(cellsOf(table, 'B').finish).toHaveText('5 Mar 2027 → 9 Mar 2027')
  // C does not move.
  await expect(table.getByRole('row', { name: 'C', exact: true })).toHaveCount(0)

  // ...and a new red flag: alice overloaded on 2027-03-09. (It also shows the flags that follow
  // from it: B and C, which load her that day, cannot be done by their assigned people, FR-020.)
  await expect(
    newRedFlags(page)
      .getByRole('listitem')
      .filter({ hasText: /^alice overloaded on / }),
  ).toHaveText([/^alice overloaded on 9 Mar 2027/])

  // Step 2, and negative: nothing was saved.
  expect(await readTask(page, a)).toMatchObject({
    plannedFinish: '2027-03-03',
    durationWorkingDays: 3,
  })
  expect(await readTask(page, b)).toMatchObject({
    plannedStart: '2027-03-04',
    plannedFinish: '2027-03-05',
  })

  await page.context().close()
})

test("TC-112: a plan change does not rewrite a proposal's changes", async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(page, 'Apollo')
  await call(page, 'PUT', `/projects/${apollo}/members/${bob.id}`, { role: 'read-write' })
  const a = await createTask(page, apollo, {
    title: 'A',
    plannedStart: '2027-03-01',
    durationWorkingDays: 1,
  })
  const b = await createTask(page, apollo, { title: 'B', durationWorkingDays: 1 })
  await block(page, b, a)
  expect((await readTask(page, b)).plannedStart).toBe('2027-03-02')
  const assign = { kind: 'update-task', task: { taskId: b }, fields: { assignees: [bob.id] } }
  const proposal = await propose(deployment, alice, [assign])

  // Then bob moves A to 2027-03-08, so that B is rescheduled to 2027-03-09.
  const bobPage = await signedIn(browser, deployment.url, bob)
  await call(bobPage, 'PATCH', `/tasks/${a}`, { plannedStart: '2027-03-08' })
  expect((await readTask(page, b)).plannedStart).toBe('2027-03-09')

  // Step 1: the proposal still holds exactly one change, assigning bob to B.
  const stored = await read(page, `/proposals/${proposal}`)
  const changes = changesOf(stored)
  expect(changes).toEqual([expect.objectContaining(assign)])
  expect(Object.keys(changes[0] ?? {}).toSorted()).toEqual([
    'fields',
    'id',
    'kind',
    'projectId',
    'task',
  ])

  // Step 2: as alice, open the proposal's preview. It shows B on 2027-03-09, assigned to bob.
  const table = await openProposal(page, 'Apollo')
  await expect(table.getByRole('row')).toHaveCount(2)
  await expect(cellsOf(table, 'B').start).toHaveText('9 Mar 2027')
  await expect(cellsOf(table, 'B').finish).toHaveText('9 Mar 2027')
  await expect(cellsOf(table, 'B').assigned).toHaveText('— → bob')

  // Negative: opening the preview added nothing to the proposal and altered nothing in it.
  expect(await read(page, `/proposals/${proposal}`)).toEqual(stored)

  await bobPage.context().close()
  await page.context().close()
})

test('TC-226: a proposal holds the changed input and no derived dates', async ({
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
  const proposal = await propose(deployment, alice, [
    { kind: 'update-task', task: { taskId: a }, fields: { durationWorkingDays: 5 } },
  ])

  // Step 1: the proposal's stored content holds one change: A's duration set to 5...
  const stored = await read(page, `/proposals/${proposal}`)
  const changes = changesOf(stored)
  expect(changes).toHaveLength(1)
  expect(changes[0]).toMatchObject({
    kind: 'update-task',
    task: { taskId: a },
    fields: { durationWorkingDays: 5 },
  })
  // ...and, negative, no planned finish for A and no dates for B.
  expect(JSON.stringify(stored)).not.toContain('2027-03')
  expect(JSON.stringify(stored)).not.toContain(b)

  // Step 2: open the proposal's preview. It shows B on 2027-03-08 to 2027-03-09.
  const table = await openProposal(page, 'Apollo')
  await expect(cellsOf(table, 'B').start).toHaveText('4 Mar 2027 → 8 Mar 2027')
  await expect(cellsOf(table, 'B').finish).toHaveText('5 Mar 2027 → 9 Mar 2027')

  await page.context().close()
})
