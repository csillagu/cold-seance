import type { Browser, Page } from '@playwright/test'
import { projectRepositoryRequests, repositories } from '../../backend/src/db/schema.ts'
import { type Account, type Deployment, expect, test } from '../fixtures.ts'

// The repository request inbox (SC-087) in the browser: a repository's admins approve a project's
// waiting request for it, one admin's approval being enough (FR-168), reject it, which leaves the
// repository out of the project (FR-171), and withdraw an approval given earlier (FR-172). The
// project's side, asking for a repository, is the project repository settings screen (SC-081),
// whose browser tests are in project-repositories.spec.ts; here the project's admin asks through
// the REST API, as that screen does. The REST API side of these test cases is in
// backend/test/integration/project-repositories.test.ts.

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

/** Calls the REST API as the person signed in on `page`, giving the status and the answer. */
async function send(page: Page, method: string, path: string, data?: unknown) {
  return page.evaluate(
    async (request) => {
      const response = await fetch(`/api${request.path}`, {
        method: request.method,
        headers: request.data === undefined ? {} : { 'content-type': 'application/json' },
        body: request.data === undefined ? undefined : JSON.stringify(request.data),
      })
      const text = await response.text()
      return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) }
    },
    { method, path, data },
  )
}

/** Calls the REST API as the person signed in on `page`, failing unless it succeeds. */
async function call(page: Page, method: string, path: string, data?: unknown): Promise<unknown> {
  const answer = await send(page, method, path, data)
  expect(answer.status, `${method} ${path}: ${JSON.stringify(answer.body)}`).toBeLessThan(300)
  return answer.body
}

/** The `id` of an object the REST API answered with. */
function idOf(answer: unknown): string {
  if (typeof answer !== 'object' || answer === null || !('id' in answer)) {
    throw new Error('The answer holds no id')
  }
  return String(answer.id)
}

/** The items of the answer, a list, failing if it is not one. */
function itemsOf(answer: unknown): unknown[] {
  if (!Array.isArray(answer)) throw new Error('The answer is not a list')
  return answer
}

/** The string field `key` of `item`, failing if it has none. */
function textOf(item: unknown, key: string): string {
  if (typeof item !== 'object' || item === null) throw new Error('The item is not an object')
  const value: unknown = Object.entries(item).find(([name]) => name === key)?.[1]
  if (typeof value !== 'string') throw new Error(`The item holds no ${key}`)
  return value
}

/** The full names of the repositories `project` pulls issues from, as its admin reads them. */
async function repositoriesOf(page: Page, project: string): Promise<string[]> {
  const listed = itemsOf(await call(page, 'GET', `/projects/${project}/repositories`))
  return listed.map((repository) => `${textOf(repository, 'owner')}/${textOf(repository, 'name')}`)
}

/** The titles and statuses of `project`'s tasks, by title. */
async function tasksOf(page: Page, project: string): Promise<{ title: string; status: string }[]> {
  const listed = itemsOf(await call(page, 'GET', `/projects/${project}/tasks`))
  return listed
    .map((task) => ({ title: textOf(task, 'title'), status: textOf(task, 'status') }))
    .toSorted((a, b) => a.title.localeCompare(b.title))
}

/** Opens the repository request inbox from the navigation. */
async function openInbox(page: Page) {
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Repository requests' })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: 'Repository requests' })).toBeVisible()
}

/** The rows of the inbox's table `name`, below its header: project, repository and by whom. */
const rows = (page: Page, name: string) =>
  page.getByRole('table', { name }).locator('tbody').getByRole('row')

/** `fullName` on the fake GitHub, registered in the tool by the person of `page`. Gives its id. */
async function registered(page: Page, fullName: string): Promise<string> {
  const [owner, name] = fullName.split('/')
  return idOf(await call(page, 'POST', '/repositories', { owner, name }))
}

/** Project `name`, created by the person of `page`. Gives its id. */
async function createProject(page: Page, name: string): Promise<string> {
  return idOf(await call(page, 'POST', '/projects', { name }))
}

/** The project's admin on `page` asks to add the repository to it. Gives the request's id. */
async function ask(page: Page, project: string, repository: string): Promise<string> {
  return idOf(
    await call(page, 'POST', `/projects/${project}/repository-requests`, {
      repositoryId: repository,
    }),
  )
}

/** The inputs most of these test cases share: alice's Apollo has asked for bob's tc-repo. */
async function apolloAsksForTcRepo(browser: Browser, deployment: Deployment) {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const alicePage = await signedIn(browser, deployment.url, alice)
  const bobPage = await signedIn(browser, deployment.url, bob)
  const repository = await registered(bobPage, 'csillagu/tc-repo')
  const apollo = await createProject(alicePage, 'Apollo')
  await ask(alicePage, apollo, repository)
  return { alicePage, bobPage, repository, apollo }
}

test.beforeEach(({ deployment }) => {
  deployment.github.createRepository('csillagu/tc-repo')
})

test("TC-245: one repository admin's approval adds the repository to a project", async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const carol = await deployment.seedAccount('carol')
  const bobPage = await signedIn(browser, deployment.url, bob)
  const repository = await registered(bobPage, 'csillagu/tc-repo')
  await call(bobPage, 'POST', `/repositories/${repository}/admins`, { accountId: carol.id })
  const alicePage = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(alicePage, 'Apollo')

  // Step 1: as alice, ask to add tc-repo to Apollo to pull its issues. Read Apollo's repositories.
  await ask(alicePage, apollo, repository)
  expect(await repositoriesOf(alicePage, apollo)).toEqual([])
  // Negative: Apollo gets no task from tc-repo before step 2.
  expect(await tasksOf(alicePage, apollo)).toEqual([])

  // Step 2: as carol, approve the request in her inbox. Read Apollo's repositories again.
  const carolPage = await signedIn(browser, deployment.url, carol)
  await openInbox(carolPage)
  await expect(rows(carolPage, 'Waiting for approval')).toHaveText([
    'Apollocsillagu/tc-repoAsked by aliceApproveReject',
  ])
  await carolPage
    .getByRole('button', { name: "Approve Apollo's request for csillagu/tc-repo" })
    .click()
  await expect(carolPage.getByRole('status')).toHaveText('csillagu/tc-repo is added to Apollo.')
  await expect(rows(carolPage, 'Approved')).toHaveText([
    'Apollocsillagu/tc-repoApproved by carolWithdraw approval',
  ])
  // tc-repo is among Apollo's repositories, without bob approving.
  expect(await repositoriesOf(alicePage, apollo)).toEqual(['csillagu/tc-repo'])
  // bob, its other admin, sees the request approved by carol in his inbox too.
  await openInbox(bobPage)
  await expect(rows(bobPage, 'Approved')).toHaveText([
    'Apollocsillagu/tc-repoApproved by carolWithdraw approval',
  ])
  await expect(bobPage.getByText('No request is waiting.')).toBeVisible()
})

test("TC-246: seeding from a repository waits for a repository admin's approval", async ({
  browser,
  deployment,
}) => {
  deployment.github.createRepository('csillagu/tc-seed')
  deployment.github.issues.createIssue('csillagu/tc-seed', 'One')
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const bobPage = await signedIn(browser, deployment.url, bob)
  const repository = await registered(bobPage, 'csillagu/tc-seed')
  const alicePage = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(alicePage, 'Apollo')

  // Step 1: as alice, ask to seed Apollo from tc-seed. List Apollo's tasks: none.
  await ask(alicePage, apollo, repository)
  expect(await tasksOf(alicePage, apollo)).toEqual([])
  expect(await repositoriesOf(alicePage, apollo)).toEqual([])

  // Step 2: as bob, approve in his inbox.
  await openInbox(bobPage)
  await bobPage
    .getByRole('button', { name: "Approve Apollo's request for csillagu/tc-seed" })
    .click()
  await expect(bobPage.getByRole('status')).toHaveText('csillagu/tc-seed is added to Apollo.')
  expect(await repositoriesOf(alicePage, apollo)).toEqual(['csillagu/tc-seed'])
  // Negative: no issue of tc-seed is imported by the approval itself.
  expect(await tasksOf(alicePage, apollo)).toEqual([])

  // As alice, run the seeding on Apollo's seeding screen (SC-095) and list Apollo's tasks: one,
  // for #1, which has its title.
  await alicePage.goto(`/projects/${apollo}/seeding`)
  await alicePage.getByRole('checkbox', { name: 'csillagu/tc-seed' }).check()
  await alicePage.getByRole('button', { name: 'Start seeding' }).click()
  await expect(alicePage.getByRole('status')).toHaveText('The seeding succeeded: 1 task imported.')
  expect(await tasksOf(alicePage, apollo)).toEqual([{ title: 'One', status: 'not-started' }])
})

test('TC-247: an unregistered repository cannot be added to a project', async ({
  browser,
  deployment,
}) => {
  // Pending: step 1 on the project repository settings screen (SC-081, F09), which will offer
  // only registered repositories. Here tc-repo, not registered, has no admin, so no inbox ever
  // shows a request for it.
  const alice = await deployment.seedAccount('alice')
  const alicePage = await signedIn(browser, deployment.url, alice)
  const apollo = await createProject(alicePage, 'Apollo')

  // Step 1: as alice, try to add tc-repo to Apollo: the tool has no id for it, so it is refused.
  const attempt = await send(alicePage, 'POST', `/projects/${apollo}/repository-requests`, {
    repositoryId: '00000000-0000-4000-8000-000000000000',
  })
  expect(attempt.status).toBe(404)

  // Step 2: read Apollo's repositories.
  expect(await repositoriesOf(alicePage, apollo)).toEqual([])
  // No inbox shows a request for it: not alice's, nor a system admin's.
  for (const page of [alicePage, await signedIn(browser, deployment.url, deployment.root)]) {
    await openInbox(page)
    await expect(
      page.getByText('No project has asked for a repository you are an admin of.'),
    ).toBeVisible()
  }
  // Negative: tc-repo is not registered as a side effect.
  expect(await deployment.db.select().from(repositories)).toEqual([])
  expect(await deployment.db.select().from(projectRepositoryRequests)).toEqual([])
})

test("TC-250: a repository admin rejects a project's request", async ({ browser, deployment }) => {
  const { alicePage, bobPage, apollo } = await apolloAsksForTcRepo(browser, deployment)

  // Step 1: as bob, reject the request in his inbox.
  await openInbox(bobPage)
  await bobPage
    .getByRole('button', { name: "Reject Apollo's request for csillagu/tc-repo" })
    .click()
  await expect(bobPage.getByRole('status')).toHaveText(
    "Apollo's request for csillagu/tc-repo is rejected.",
  )

  // Step 2: read Apollo's repositories and the request's state, afresh.
  await bobPage.reload()
  await expect(rows(bobPage, 'Rejected and withdrawn')).toHaveText([
    'Apollocsillagu/tc-repoRejected by bob',
  ])
  // Negative: tc-repo is not among Apollo's repositories, and the request can no longer be
  // approved: the inbox offers no approval for it.
  await expect(bobPage.getByText('No request is waiting.')).toBeVisible()
  await expect(bobPage.getByRole('button', { name: /^Approve / })).toHaveCount(0)
  expect(await repositoriesOf(alicePage, apollo)).toEqual([])
})

test('TC-251: withdrawing an approval stops the project pulling and keeps its tasks', async ({
  browser,
  deployment,
}) => {
  const { alicePage, bobPage, repository, apollo } = await apolloAsksForTcRepo(browser, deployment)
  await openInbox(bobPage)
  await bobPage
    .getByRole('button', { name: "Approve Apollo's request for csillagu/tc-repo" })
    .click()
  await expect(bobPage.getByRole('status')).toHaveText('csillagu/tc-repo is added to Apollo.')
  const old = idOf(await call(alicePage, 'POST', `/projects/${apollo}/tasks`, { title: 'Old' }))
  await call(alicePage, 'PUT', `/tasks/${old}/repository`, { repositoryId: repository })
  const fresh = idOf(await call(alicePage, 'POST', `/projects/${apollo}/tasks`, { title: 'New' }))

  // Step 1: as bob, withdraw the approval for Apollo in his inbox.
  await bobPage
    .getByRole('button', {
      name: "Withdraw the approval of Apollo's request for csillagu/tc-repo",
    })
    .click()
  await expect(bobPage.getByRole('status')).toHaveText(
    'Apollo no longer pulls issues from csillagu/tc-repo.',
  )
  await expect(rows(bobPage, 'Rejected and withdrawn')).toHaveText([
    'Apollocsillagu/tc-repoWithdrawn by bob',
  ])
  await expect(bobPage.getByText('No approval is in force.')).toBeVisible()

  // Step 2: read Apollo's repositories, then as alice try to assign New to tc-repo on its page:
  // tc-repo is no longer offered.
  expect(await repositoriesOf(alicePage, apollo)).toEqual([])
  await alicePage.goto(`/tasks/${fresh}`)
  const section = alicePage.getByRole('form', { name: 'Repository' })
  await expect(section.getByText('The project pulls issues from no repository.')).toBeVisible()
  await expect(section.getByRole('combobox', { name: 'Repository' })).toHaveCount(0)

  // Step 3: list Apollo's tasks. Negative: Old is neither deleted nor cancelled.
  expect(await tasksOf(alicePage, apollo)).toEqual([
    { title: 'New', status: 'not-started' },
    { title: 'Old', status: 'not-started' },
  ])
})

test('TC-252: a receiving project whose approval is withdrawn stops receiving new issues', async ({
  browser,
  deployment,
}) => {
  // Pending: steps 2 and 3, a new issue opened on GitHub and not received by Apollo, wait for the
  // GitHub change handler (SC-023, B16) and the webhook endpoint and re-check timer (SC-105,
  // SC-024, B17). This checks the withdrawal in the inbox of the receiving project's approval.
  const { alicePage, bobPage, repository, apollo } = await apolloAsksForTcRepo(browser, deployment)
  await openInbox(bobPage)
  await bobPage
    .getByRole('button', { name: "Approve Apollo's request for csillagu/tc-repo" })
    .click()
  await expect(bobPage.getByRole('status')).toHaveText('csillagu/tc-repo is added to Apollo.')
  await call(alicePage, 'PUT', `/projects/${apollo}/receiving-repositories/${repository}`, {})
  await call(alicePage, 'POST', `/projects/${apollo}/tasks`, { title: 'Earlier' })

  // Step 1: as bob, withdraw the approval for Apollo in his inbox.
  await bobPage
    .getByRole('button', {
      name: "Withdraw the approval of Apollo's request for csillagu/tc-repo",
    })
    .click()
  await expect(bobPage.getByRole('status')).toHaveText(
    'Apollo no longer pulls issues from csillagu/tc-repo.',
  )
  expect(await repositoriesOf(alicePage, apollo)).toEqual([])

  // Negative: no earlier task of Apollo is removed.
  expect(await tasksOf(alicePage, apollo)).toEqual([{ title: 'Earlier', status: 'not-started' }])
})
