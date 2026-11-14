import type { Browser, Page } from '@playwright/test'
import { createServices } from '../../backend/src/service/services.ts'
import { type Account, type Deployment, expect, test } from '../fixtures.ts'

// The pending overlay of a proposal under review on the Gantt (SC-068) and the Kanban (SC-030):
// the test cases it makes pass in full. The test cases create each proposal through the MCP
// server, which comes with SC-027 (B19); until then it is created through the service layer with
// the channel the MCP server will give it, as proposal-preview.spec.ts does. The other inputs are
// put in place through the REST API, in the browser's own session.

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

/** Creates a proposal of one group, by `account`, through the channel the MCP server gives. */
async function propose(deployment: Deployment, account: Account, changes: object[]) {
  const services = createServices(deployment.db)
  const proposal = await services.proposals.createProposal(
    { accountId: account.id, channel: 'mcp' },
    { groups: [{ changes }] },
  )
  return proposal.id
}

/** Opens the view `view` of `project` from the project's page. */
async function openView(page: Page, project: string, view: 'Gantt' | 'Kanban') {
  await page.goto('/')
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: project })
    .click()
  await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: view }).click()
}

test('TC-102: a proposal under review shows as a pending overlay on the Gantt', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  // Alice's access token, which the MCP server will take the proposal with.
  await call(page, 'POST', '/tokens', {})
  const apollo = await createProject(page, 'Apollo')
  const a = await createTask(page, apollo, {
    title: 'A',
    plannedStart: '2027-03-01',
    durationWorkingDays: 1,
  })
  const proposal = await propose(deployment, alice, [
    { kind: 'update-task', task: { taskId: a }, fields: { plannedStart: '2027-03-08' } },
  ])

  // Step 1: as alice, open the Gantt of Apollo.
  await openView(page, 'Apollo', 'Gantt')
  const row = page
    .getByRole('table', { name: 'Gantt of Apollo' })
    .getByRole('row', { name: 'A', exact: true })

  // A's live bar is on 2027-03-01.
  const live = row.getByRole('img', { name: 'A: 1 Mar 2027 to 1 Mar 2027' })
  await expect(live).toHaveAttribute('data-start', '2027-03-01')

  // A pending bar for A on 2027-03-08 is shown, marked apart from the live plan.
  const pending = row.getByRole('img', { name: 'Pending proposal for A: 8 Mar 2027 to 8 Mar 2027' })
  await expect(pending).toHaveAttribute('data-start', '2027-03-08')
  await expect(pending).toHaveAttribute('data-proposal-id', proposal)
  await expect(row.getByText('Proposed: 8 Mar')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Proposals under review' })).toContainText(
    'AI proposal under review: 1 change shown as pending',
  )

  // Negative: A, read through the REST API, still starts 2027-03-01.
  const task = await call(page, 'GET', `/tasks/${a}`)
  expect(task).toMatchObject({ plannedStart: '2027-03-01' })

  await page.context().close()
})

test('TC-103: a proposal under review shows as a pending overlay on the Kanban', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  // Alice's access token, which the MCP server will take the proposal with.
  await call(page, 'POST', '/tokens', {})
  const apollo = await createProject(page, 'Apollo')
  await propose(deployment, alice, [
    { kind: 'create-task', key: 'p1', projectId: apollo, fields: { title: 'Proposed task' } },
  ])

  // Step 1: as alice, open the Kanban of Apollo.
  await openView(page, 'Apollo', 'Kanban')
  const kanban = page.getByRole('group', { name: 'Kanban of Apollo' })
  await expect(kanban).toBeVisible()

  // A card for Proposed task is shown, marked as pending, apart from the live cards.
  const proposed = kanban.getByRole('list', { name: 'Not started, proposed' })
  const card = proposed.getByRole('article', { name: 'Proposed task, proposed' })
  await expect(card).toHaveAttribute('data-pending', 'true')
  await expect(card.getByText('Pending', { exact: true })).toBeVisible()
  await expect(kanban.getByRole('list', { name: 'Not started, scheduled' })).not.toContainText(
    'Proposed task',
  )
  await expect(
    kanban.getByRole('region', { name: 'Not started' }).getByLabel('0 tasks'),
  ).toBeVisible()

  // Negative: the task list of Apollo read through the REST API has no Proposed task.
  const tasks = await call(page, 'GET', `/projects/${apollo}/tasks`)
  expect(tasks).toEqual([])

  await page.context().close()
})
