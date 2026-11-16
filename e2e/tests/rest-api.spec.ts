import type { Browser, Page } from '@playwright/test'
import { connectMcp } from '../../backend/test/helpers/mcp.ts'
import { type Account, type Deployment, expect, test } from '../fixtures.ts'

// The REST API (SC-026) beside the UI: the test cases that check that it reads and writes what the
// UI does and refuses what the UI refuses (FR-114), and that one rule holds through the UI, the
// REST API and the MCP server alike (FR-115). The REST calls carry the person's personal access
// token, as an outside client would (DD-048); the token is created in the person's own browser
// session, as the API tokens page does. The browser steps are taken in the browser.

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
  return JSON.parse(answer.text === '' ? 'null' : answer.text)
}

/** An answer of the REST API to a call made with a personal access token. */
interface TokenAnswer {
  status: number
  body: unknown
}

/**
 * Calls the REST API from outside the browser, as an outside client does, with the personal access
 * token `secret` as `Authorization: Bearer <secret>`, and gives its status and parsed body.
 */
async function rest(
  deployment: Deployment,
  secret: string,
  method: string,
  path: string,
  data?: unknown,
): Promise<TokenAnswer> {
  const response = await fetch(`${deployment.url}/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      ...(data === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  const text = await response.text()
  return { status: response.status, body: JSON.parse(text === '' ? 'null' : text) }
}

/** `value` as an object of the API's answer, failing if it is not one. */
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`The answer is not an object: ${JSON.stringify(value)}`)
  }
  return { ...value }
}

function idOf(created: unknown): string {
  return String(record(created)['id'])
}

/** A personal access token of the person signed in on `page`, created in their session. */
async function tokenOf(page: Page): Promise<string> {
  return String(record(await call(page, 'POST', '/tokens', {}))['secret'])
}

/** Opens project `name` from the navigation, then its view `view` from the project's views. */
async function openView(page: Page, name: string, view: string) {
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Navigation' }).getByRole('link', { name }).click()
  await page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: view }).click()
}

test('TC-167: the REST API reads and writes what the UI does', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = idOf(await call(page, 'POST', '/projects', { name: 'Apollo' }))
  const token = await tokenOf(page)

  // Step 1: each operation in turn, through the REST API with alice's token. Each succeeds.
  const created = await rest(deployment, token, 'POST', `/projects/${apollo}/tasks`, {
    title: 'T',
  })
  expect(created.status, JSON.stringify(created.body)).toBe(201)
  const t = idOf(created.body)
  const planned = await rest(deployment, token, 'PATCH', `/tasks/${t}`, {
    plannedStart: '2027-03-01',
    durationWorkingDays: 2,
  })
  expect(planned.status, JSON.stringify(planned.body)).toBe(200)
  expect(planned.body).toMatchObject({ plannedStart: '2027-03-01', plannedFinish: '2027-03-02' })
  const baseline = await rest(deployment, token, 'POST', `/projects/${apollo}/baselines`, {
    name: 'v1',
  })
  expect(baseline.status, JSON.stringify(baseline.body)).toBe(201)
  const board = await rest(deployment, token, 'POST', '/saved-views', {
    name: 'Board',
    kind: 'kanban',
    keptIn: 'personal',
    projects: [apollo],
  })
  expect(board.status, JSON.stringify(board.body)).toBe(201)
  const load = await rest(
    deployment,
    token,
    'GET',
    `/accounts/${alice.id}/load?from=2027-03-01&to=2027-03-01`,
  )
  expect(load.status, JSON.stringify(load.body)).toBe(200)
  const audit = await rest(deployment, token, 'GET', `/audit-log?projectId=${apollo}`)
  expect(audit.status, JSON.stringify(audit.body)).toBe(200)
  // The log holds the changes just made, through the REST API channel.
  expect(JSON.stringify(audit.body)).toContain('rest-api')

  // Step 2: open Apollo in the browser as alice: it shows T, v1 and Board as created.
  await openView(page, 'Apollo', 'Kanban')
  const kanban = page.getByRole('group', { name: 'Kanban of Apollo' })
  await expect(kanban.getByRole('article', { name: 'T', exact: true })).toContainText(
    '1–2 Mar · 2d',
  )
  await openView(page, 'Apollo', 'Baseline variance')
  await expect(
    page.getByRole('table', { name: 'Baseline variance of Apollo against v1' }),
  ).toBeVisible()
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Saved views' })
    .click()
  await page.getByRole('main').getByRole('link', { name: 'Board', exact: true }).click()
  await expect(
    page.getByRole('group', { name: 'Board' }).getByRole('article', { name: 'T', exact: true }),
  ).toContainText('1–2 Mar · 2d')

  await page.context().close()
})

test('TC-168: the REST API refuses what the UI refuses', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const carol = await deployment.seedAccount('carol')
  const alicesPage = await signedIn(browser, deployment.url, alice)
  const apollo = idOf(await call(alicesPage, 'POST', '/projects', { name: 'Apollo' }))
  await call(alicesPage, 'PUT', `/projects/${apollo}/members/${carol.id}`, { role: 'contributor' })
  const t = idOf(
    await call(alicesPage, 'POST', `/projects/${apollo}/tasks`, {
      title: 'Draft',
      assignees: [carol.id],
    }),
  )
  const carolsPage = await signedIn(browser, deployment.url, carol)
  const token = await tokenOf(carolsPage)
  const refusal = "Only the project's read-write members and admins can edit its plan"

  // Step 1: as carol, in the browser, try to change T's title. It is refused.
  await carolsPage.goto(`/tasks/${t}`)
  await expect(carolsPage.getByRole('heading', { name: 'Draft', level: 1 })).toBeVisible()
  const details = carolsPage.getByRole('form', { name: 'Details' })
  await details.getByLabel('Title').fill('Mine')
  await details.getByRole('button', { name: 'Save details' }).click()
  await expect(details.getByRole('alert')).toHaveText(refusal)

  // Step 2: with carol's token, the same change through the REST API. It is refused alike.
  const changed = await rest(deployment, token, 'PATCH', `/tasks/${t}`, { title: 'Mine' })
  expect(changed.status).toBe(403)
  expect(record(changed.body)['message']).toBe(refusal)

  // Negative: T's title is still Draft.
  expect(record(await call(alicesPage, 'GET', `/tasks/${t}`))['title']).toBe('Draft')

  await alicesPage.context().close()
  await carolsPage.context().close()
})

test('TC-169: a cycle is rejected alike through the UI, the REST API and the MCP server', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = idOf(await call(page, 'POST', '/projects', { name: 'Apollo' }))
  const a = idOf(await call(page, 'POST', `/projects/${apollo}/tasks`, { title: 'A' }))
  const b = idOf(await call(page, 'POST', `/projects/${apollo}/tasks`, { title: 'B' }))
  await call(page, 'POST', `/tasks/${a}/blocked-by`, { blockerId: b })
  const token = await tokenOf(page)
  const blockersOfB = async () =>
    record(await call(page, 'GET', `/tasks/${b}/relations`))['blockedBy']

  // Step 1: as alice, try to make B blocked by A in the UI. It is rejected.
  await page.goto(`/tasks/${b}`)
  await expect(page.getByRole('heading', { name: 'B', level: 1 })).toBeVisible()
  await page.getByLabel('Add a blocker').selectOption({ label: 'A' })
  await page.getByRole('button', { name: 'Add blocker' }).click()
  await expect(page.getByRole('alert')).toContainText('would create a cycle')

  // Step 2: the same change through the REST API, with alice's token. It is rejected.
  const viaRest = await rest(deployment, token, 'POST', `/tasks/${b}/blocked-by`, {
    blockerId: a,
  })
  expect(viaRest.status).toBe(400)
  expect(record(viaRest.body)['message']).toContain('would create a cycle')

  // Step 3: through the MCP server as a proposal. The proposal store takes it, as the test case
  // allows; trying to approve it in the UI is then rejected.
  const agent = await connectMcp(deployment.url, token)
  const proposed = await agent.call('create_proposal', {
    groups: [{ changes: [{ kind: 'add-blocker', task: { taskId: b }, blocker: { taskId: a } }] }],
  })
  await agent.close()
  expect(proposed.isError, JSON.stringify(proposed.json)).toBe(false)
  const proposal = idOf(proposed.json)
  await page.goto(`/proposals/${proposal}`)
  await expect(
    page.getByRole('heading', { name: 'The proposal cannot be previewed' }),
  ).toBeVisible()
  const review = page.getByRole('region', { name: 'Review' })
  await review.getByRole('button', { name: 'Approve' }).click()
  await expect(review.getByRole('alert')).toContainText('would create a cycle')
  expect(record(await call(page, 'GET', `/proposals/${proposal}`))['status']).toBe('waiting')

  // Step 4: B's blocked-by relations. Negative: B is never blocked by A.
  expect(await blockersOfB()).toEqual([])

  await page.context().close()
})
