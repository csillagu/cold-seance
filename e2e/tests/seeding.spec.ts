import type { Browser, Page } from '@playwright/test'
import { type Account, expect, test } from '../fixtures.ts'

// The project seeding screen (SC-095) in the browser: a project's admin chooses repositories the
// project pulls issues from, starts the import, and sees whether it succeeded or failed as a whole
// and brought nothing in (FR-102, FR-137). The test cases' "GitHub Project with a status field the
// tool uses" is a fake Project whose field is `Status`, with the configuration's default options
// (SRC-252). The importer's own side of these test cases (service and REST) is in
// backend/test/integration/seeding.test.ts.

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
 * Calls the REST API as the person signed in on `page`, and gives its status and parsed answer.
 * The call is made by the page itself, as the session cookie is `Secure` and only the browser
 * sends it to the test deployment's plain-HTTP address.
 */
async function send(
  page: Page,
  method: string,
  path: string,
  data?: unknown,
): Promise<{ status: number; body: unknown }> {
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

/**
 * Project `name`, created by the person of `page`, pulling issues from `repository`, which they
 * registered: as its admin and the project's both, the repository is added at once (FR-170).
 */
async function projectPulling(page: Page, name: string, repository: string): Promise<string> {
  const [owner, repo] = repository.split('/')
  const repositoryId = idOf(await call(page, 'POST', '/repositories', { owner, name: repo }))
  const project = idOf(await call(page, 'POST', '/projects', { name }))
  await call(page, 'POST', `/projects/${project}/repository-requests`, { repositoryId })
  return project
}

/** The field `key` of `item`, an object the REST API answered with. */
function fieldOf(item: unknown, key: string): unknown {
  if (typeof item !== 'object' || item === null) throw new Error('The item is not an object')
  return Object.entries(item).find(([name]) => name === key)?.[1]
}

/** A task as the REST API lists it, with the fields the test cases read. */
interface ApiTask {
  id: string
  status: unknown
  assignees: unknown
  /** The number of the issue it is linked to, if any. */
  issue: unknown
}

/** The tasks of `project`, as the REST API lists them. */
async function tasksOf(page: Page, project: string): Promise<ApiTask[]> {
  const listed = await call(page, 'GET', `/projects/${project}/tasks`)
  if (!Array.isArray(listed)) throw new Error('The answer is not a list')
  return listed.map((task: unknown) => {
    const issue = fieldOf(task, 'githubIssue')
    return {
      id: String(fieldOf(task, 'id')),
      status: fieldOf(task, 'status'),
      assignees: fieldOf(task, 'assignees'),
      issue: issue === null ? null : fieldOf(issue, 'number'),
    }
  })
}

/** The id of the parent of `task`, and the ids of its blockers, as the REST API reads them. */
async function relationsOf(page: Page, task: ApiTask) {
  const relations = await call(page, 'GET', `/tasks/${task.id}/relations`)
  const parent = fieldOf(relations, 'parent')
  const blockedBy = fieldOf(relations, 'blockedBy')
  return {
    parent: parent === null ? null : fieldOf(parent, 'id'),
    blockedBy: Array.isArray(blockedBy) ? blockedBy.map((b: unknown) => fieldOf(b, 'id')) : [],
  }
}

/** Opens the project's seeding screen from the project's page. */
async function openSeeding(page: Page, project: string) {
  await page.goto(`/projects/${project}`)
  await page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('link', { name: 'Seeding' })
    .click()
  await expect(page.getByRole('heading', { level: 2, name: /^Seed .* from GitHub$/ })).toBeVisible()
}

/** Chooses `repository` on the seeding screen and starts the import. */
async function seedFrom(page: Page, repository: string) {
  await page.getByRole('checkbox', { name: repository }).check()
  await page.getByRole('button', { name: 'Start seeding' }).click()
}

test('TC-149: seeding imports issues with their relations, assignees and status', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  await call(page, 'PUT', `/accounts/${alice.id}/github`, { githubLogin: 'tc-alice' })
  const { github } = deployment
  github.createRepository('csillagu/tc-seed')
  const one = github.issues.createIssue('csillagu/tc-seed', 'One')
  const two = github.issues.createIssue('csillagu/tc-seed', 'Two')
  const three = github.issues.createIssue('csillagu/tc-seed', 'Three')
  two.parent = one.id
  two.assignees = ['tc-alice']
  github.issues.addToProject('csillagu/tc-seed', 2, { status: 'In Progress' })
  three.blockedBy = [two.id]
  const apollo = await projectPulling(page, 'Apollo', 'csillagu/tc-seed')
  const before = JSON.stringify(github.issues.issuesOf('csillagu/tc-seed'))
  const isRead = (r: string) =>
    r.startsWith('GET ') || r === 'POST /graphql' || /^POST \/app\/installations\//.test(r)
  const writes = () => github.requests.filter((r) => !isRead(r)).length
  const written = writes()

  // Step 1: as alice, seed Apollo from tc-seed.
  await openSeeding(page, apollo)
  await seedFrom(page, 'csillagu/tc-seed')
  await expect(page.getByRole('status')).toHaveText('The seeding succeeded: 3 tasks imported.')

  // Step 2: list the tasks of Apollo and read each.
  const tasks = await tasksOf(page, apollo)
  const byNumber = (n: number) => {
    const task = tasks.find((t) => t.issue === n)
    if (!task) throw new Error(`No task for #${n}`)
    return task
  }
  expect(tasks).toHaveLength(3)
  const t1 = byNumber(1)
  const t2 = byNumber(2)
  const t3 = byNumber(3)
  expect(t2.status).toBe('in-progress')
  expect(t2.assignees).toEqual([alice.id])
  expect((await relationsOf(page, t2)).parent).toBe(t1.id)
  expect((await relationsOf(page, t3)).blockedBy).toEqual([t2.id])

  // Negative: no issue on GitHub is changed by the seeding.
  expect(JSON.stringify(github.issues.issuesOf('csillagu/tc-seed'))).toBe(before)
  expect(writes()).toBe(written)
})

test('TC-150: seeding from a repository the GitHub App cannot reach is refused', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const { github } = deployment
  github.createRepository('csillagu/tc-closed', { installed: false })
  github.issues.createIssue('csillagu/tc-closed', 'Unreachable')
  const apollo = idOf(await call(page, 'POST', '/projects', { name: 'Apollo' }))

  // Step 1: as alice, try to seed Apollo from tc-closed. It cannot be registered, so Apollo
  // cannot pull from it and it is not offered.
  const registered = await send(page, 'POST', '/repositories', {
    owner: 'csillagu',
    name: 'tc-closed',
  })
  expect(registered.status).toBeGreaterThanOrEqual(400)
  await openSeeding(page, apollo)
  await expect(page.getByText(/Apollo pulls issues from no repository/)).toBeVisible()
  await expect(page.getByRole('checkbox')).toHaveCount(0)

  // Step 2: list the tasks of Apollo. It has none.
  expect(await tasksOf(page, apollo)).toEqual([])

  // A repository Apollo pulls from that the App has since lost is offered, and the seeding is
  // refused, bringing nothing in.
  github.createRepository('csillagu/tc-lost')
  github.issues.createIssue('csillagu/tc-lost', 'Lost')
  const borealis = await projectPulling(page, 'Borealis', 'csillagu/tc-lost')
  github.uninstall('csillagu/tc-lost')
  await openSeeding(page, borealis)
  await seedFrom(page, 'csillagu/tc-lost')
  await expect(page.getByRole('alert')).toHaveText(
    'The tool cannot reach csillagu/tc-lost on GitHub. Nothing was imported.',
  )
  expect(await tasksOf(page, borealis)).toEqual([])
})

test('TC-202: a seeding import that fails partway brings nothing in', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const { github } = deployment
  github.createRepository('csillagu/tc-seed')
  for (let i = 1; i <= 50; i++) github.issues.createIssue('csillagu/tc-seed', `Issue ${i}`)
  const apollo = await projectPulling(page, 'Apollo', 'csillagu/tc-seed')
  await openSeeding(page, apollo)

  // Steps 1 and 2: as alice, start seeding Apollo from tc-seed; access to GitHub is cut off once
  // the import has read a part of the issues.
  github.cutOffAfter(40)
  await seedFrom(page, 'csillagu/tc-seed')

  // Step 3: the import reports that it failed. Restore access and list the tasks of Apollo.
  await expect(page.getByRole('alert')).toHaveText(
    'The seeding failed: GitHub could not be read. Nothing was imported.',
  )
  github.restore()
  expect(await tasksOf(page, apollo)).toEqual([])

  // Negative: none of the 50 is recorded as imported, so a later import brings in all of them.
  await seedFrom(page, 'csillagu/tc-seed')
  await expect(page.getByRole('status')).toHaveText('The seeding succeeded: 50 tasks imported.')
  expect(await tasksOf(page, apollo)).toHaveLength(50)
})
