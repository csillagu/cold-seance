import type { Browser, Page } from '@playwright/test'
import { createServices } from '../../backend/src/service/services.ts'
import { type Account, type Deployment, expect, test } from '../fixtures.ts'

// The proposal conflict panel (SC-070) and the proposal editor (SC-071): the browser steps of the
// test cases they make pass. Which changes conflict, and what an edit saves, come from the REST
// API, whose part of each test case is tested in backend/test/integration/proposal-conflicts.test.ts
// and proposal-edits.test.ts. The test cases create each proposal through the MCP server, which
// comes with SC-027 (B19); until then it is created through the service layer with the channel the
// MCP server will give it, as the proposal preview's tests do. The other inputs are put in place
// through the REST API, in the browser's own session.
//
// Pending: TC-107, a change to a deleted task is shown as a conflict. No SC deletes a task (tasks
// are cancelled, SC-038), so there is no task to delete in a test; the owner's question is open on
// #125. The panel says such a conflict as its unit test checks (frontend/src/pages/
// ProposalPage.test.tsx).

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

/** Reads an object through the REST API: a task or a proposal. */
async function read(page: Page, path: string): Promise<Record<string, unknown>> {
  const answer = await call(page, 'GET', path)
  if (typeof answer !== 'object' || answer === null) throw new Error(`${path} is not an object`)
  return { ...answer }
}

const startOf = async (page: Page, task: string) =>
  (await read(page, `/tasks/${task}`)).plannedStart

/**
 * Project `Apollo` created by alice, with bob, if given, in the read-write role, and task `A` in
 * it, 2027-03-01, 1 working day, with `fields` besides.
 */
async function apolloWithA(page: Page, bob?: Account, fields: Record<string, unknown> = {}) {
  const apollo = idOf(await call(page, 'POST', '/projects', { name: 'Apollo' }))
  if (bob) await call(page, 'PUT', `/projects/${apollo}/members/${bob.id}`, { role: 'read-write' })
  const a = idOf(
    await call(page, 'POST', `/projects/${apollo}/tasks`, {
      title: 'A',
      plannedStart: '2027-03-01',
      durationWorkingDays: 1,
      ...fields,
    }),
  )
  return { apollo, a }
}

/** The change that moves the task to `date`. */
const move = (task: string, date: string) => ({
  kind: 'update-task',
  task: { taskId: task },
  fields: { plannedStart: date },
})

/**
 * Creates a proposal of one group, by `account`, through the channel the MCP server gives, at the
 * deployment's clock.
 */
async function propose(deployment: Deployment, account: Account, changes: object[]) {
  const services = createServices(deployment.db, { now: deployment.now })
  const proposal = await services.proposals.createProposal(
    { accountId: account.id, channel: 'mcp' },
    { groups: [{ changes }] },
  )
  return proposal.id
}

/** Opens the proposal from Apollo's proposals, once its conflicts are shown. */
async function openProposal(page: Page): Promise<void> {
  await page.goto('/')
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Apollo' })
    .click()
  await page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('link', { name: 'Proposals' })
    .click()
  await page
    .getByRole('table', { name: 'Proposals of Apollo' })
    .getByRole('link', { name: /^Proposal of / })
    .click()
  await expect(page.getByRole('heading', { name: 'Conflicts' })).toBeVisible()
}

/** The proposal's groups of changes, as the REST API gives them, without their ids. */
async function changesOf(page: Page, proposal: string): Promise<unknown[]> {
  const { groups } = await read(page, `/proposals/${proposal}`)
  if (!Array.isArray(groups)) throw new Error('The proposal has no groups')
  return groups.map((group: { changes: { id: string; projectId: string }[] }) =>
    group.changes.map(({ id: _id, projectId: _project, ...change }) => change),
  )
}

/** Edits the group in the browser: types `date` as the planned start of its change, and saves. */
async function moveInEditor(page: Page, date: string) {
  await page
    .getByRole('listitem', { name: 'Group 1' })
    .getByRole('button', { name: 'Edit group' })
    .click()
  const form = page.getByRole('form', { name: 'Edit group 1' })
  await form.getByLabel('Planned start').fill(date)
  await form.getByRole('button', { name: 'Save group' }).click()
  await expect(form).toHaveCount(0)
}

test("TC-106: another person's later edit to the same input is shown as a conflict", async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const page = await signedIn(browser, deployment.url, alice)
  const { a } = await apolloWithA(page, bob)
  await propose(deployment, alice, [move(a, '2027-03-08')])
  // Then bob sets A's planned start to 2027-03-03.
  const bobPage = await signedIn(browser, deployment.url, bob)
  await call(bobPage, 'PATCH', `/tasks/${a}`, { plannedStart: '2027-03-03' })

  // Step 1: as alice, open the proposal. The move of A is a conflict, to resolve or drop.
  await openProposal(page)
  const conflicts = page.getByRole('list', { name: 'Conflicts' })
  const conflict = conflicts.getByRole('listitem')
  await expect(conflict).toHaveCount(1)
  await expect(conflict).toHaveAccessibleName('Change A: planned start 8 Mar 2027')
  await expect(conflict).toContainText(
    'Someone else changed the planned start of A after the change was proposed.',
  )
  await expect(conflict.getByRole('button', { name: 'Resolve' })).toBeEnabled()
  await expect(conflict.getByRole('button', { name: 'Drop' })).toBeEnabled()

  // Negative: opening the proposal does not move A; it still starts 2027-03-03.
  expect(await startOf(page, a)).toBe('2027-03-03')

  await bobPage.context().close()
  await page.context().close()
})

test('TC-108: an edit to a different input on the same task is not a conflict', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const page = await signedIn(browser, deployment.url, alice)
  const { a } = await apolloWithA(page, bob, { title: 'Draft' })
  await propose(deployment, alice, [move(a, '2027-03-08')])
  // Then bob changes A's title to Draft v2.
  const bobPage = await signedIn(browser, deployment.url, bob)
  await call(bobPage, 'PATCH', `/tasks/${a}`, { title: 'Draft v2' })

  // Step 1: as alice, open the proposal. It shows no conflict...
  await openProposal(page)
  await expect(
    page.getByText(
      'None: no one else has changed what the proposal changes since it was proposed.',
    ),
  ).toBeVisible()
  // ...and, negative, the move of A is not marked as one.
  await expect(page.getByRole('list', { name: 'Conflicts' })).toHaveCount(0)
  await expect(page.getByRole('listitem', { name: 'Group 1' })).toContainText(
    'Change Draft v2: planned start 8 Mar 2027',
  )

  await bobPage.context().close()
  await page.context().close()
})

test('TC-104: a read-write reviewer edits a proposal in the browser', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const page = await signedIn(browser, deployment.url, alice)
  const { a } = await apolloWithA(page, bob)
  const proposal = await propose(deployment, alice, [move(a, '2027-03-08')])

  // Step 1: as bob, open the proposal, change A's proposed start to 2027-03-10, and save it
  // without approving it.
  const bobPage = await signedIn(browser, deployment.url, bob)
  await openProposal(bobPage)
  await moveInEditor(bobPage, '2027-03-10')
  await expect(bobPage.getByRole('listitem', { name: 'Group 1' })).toContainText(
    'Change A: planned start 10 Mar 2027',
  )

  // Step 2: read the proposal and A through the REST API. The proposal now moves A to 2027-03-10...
  expect(await changesOf(bobPage, proposal)).toEqual([[move(a, '2027-03-10')]])
  expect((await read(bobPage, `/proposals/${proposal}`)).status).toBe('waiting')
  // ...and, negative, A still starts 2027-03-01.
  expect(await startOf(bobPage, a)).toBe('2027-03-01')

  await bobPage.context().close()
  await page.context().close()
})

test('TC-116: an edit within 24 hours keeps a proposal from expiring', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const { a } = await apolloWithA(page)
  const t0 = new Date()
  const hours = (count: number) => new Date(t0.getTime() + count * 60 * 60 * 1000)
  deployment.setClock(t0)
  const proposal = await propose(deployment, alice, [move(a, '2027-03-08')])

  // Step 1: at t0 + 23 hours, as alice, edit the proposal in the browser to move A to 2027-03-09.
  deployment.setClock(hours(23))
  await openProposal(page)
  await moveInEditor(page, '2027-03-09')

  // Step 2: at t0 + 25 hours, the proposal is not expired: it still waits for review.
  deployment.setClock(hours(25))
  await openProposal(page)
  await expect(page.getByText('Waiting for review')).toBeVisible()
  await expect(page.getByRole('listitem', { name: 'Group 1' })).toContainText(
    'Change A: planned start 9 Mar 2027',
  )
  const read25 = await read(page, `/proposals/${proposal}`)
  expect(read25.status).toBe('waiting')
  expect(read25.lastEditedAt).toBe(hours(23).toISOString())
  expect(await changesOf(page, proposal)).toEqual([[move(a, '2027-03-09')]])

  // Step 3: as alice, approve the proposal, and read A: the approval succeeds, the proposal is
  // not reported as expired, and A starts 2027-03-09.
  const review = page.getByRole('region', { name: 'Review' })
  await review.getByRole('button', { name: 'Approve' }).click()
  await expect(review).toContainText('Approved by alice')
  await expect(page.getByText('Expired')).toHaveCount(0)
  expect(await startOf(page, a)).toBe('2027-03-09')

  await page.context().close()
})
