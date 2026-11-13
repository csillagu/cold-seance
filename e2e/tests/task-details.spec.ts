import type { Browser, Locator, Page } from '@playwright/test'
import { type Account, type Deployment, expect, test } from '../fixtures.ts'

// The task details editor (SC-098), on the screen that creates a task and on a task's page, and
// the task cancel action (SC-102): the browser steps of the test cases they deliver. Where a test
// case's inputs give a task, it is put in place through the REST API, in the browser's own
// session; the steps the test cases take are taken in the browser, and what they read back is
// read through the REST API, as the test cases say. The REST sides of these test cases are in
// backend/test/integration/.

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

type Json = Record<string, unknown>

function idOf(created: unknown): string {
  if (typeof created !== 'object' || created === null || !('id' in created)) {
    throw new Error('The answer holds no id')
  }
  return String(created.id)
}

/** `value` as an object of the API's answer, failing if it is not one. */
function record(value: unknown): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The answer is not an object')
  }
  return { ...value }
}

/** `value` as a list of the API's objects, failing if it is not one. */
function records(value: unknown): Json[] {
  if (!Array.isArray(value)) throw new Error('The answer is not a list')
  return value.map(record)
}

/** The tasks of a project, read through the REST API. */
async function tasksOf(page: Page, project: string): Promise<Json[]> {
  return records(await call(page, 'GET', `/projects/${project}/tasks`))
}

/** Reads a task through the REST API. */
async function readTask(page: Page, task: string): Promise<Json> {
  return record(await call(page, 'GET', `/tasks/${task}`))
}

/** Account `alice` and project `Apollo`, created by her. Gives her page. */
async function apollo(browser: Browser, deployment: Deployment) {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  const id = idOf(await call(page, 'POST', '/projects', { name: 'Apollo' }))
  return { alice, page, apollo: id }
}

/** Opens Apollo's screen that creates a task, through the navigation. */
async function openNewTask(page: Page): Promise<Locator> {
  await page.goto('/')
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Apollo' })
    .click()
  await page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('link', { name: 'New task' })
    .click()
  const form = page.getByRole('form', { name: 'New task' })
  await expect(form).toBeVisible()
  return form
}

/** Opens the page of the task `task`, and waits for it. */
async function openTask(page: Page, task: string, title: string) {
  await page.goto(`/tasks/${task}`)
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
}

/** The id of the task the browser is on, from the address of its page. */
function taskOnPage(page: Page): string {
  const match = /\/tasks\/([0-9a-f-]{36})$/.exec(new URL(page.url()).pathname)
  if (!match?.[1]) throw new Error(`Not on a task's page: ${page.url()}`)
  return match[1]
}

test('TC-001: a task is stored with every minimum field', async ({ browser, deployment }) => {
  const { alice, page, apollo: project } = await apollo(browser, deployment)
  const bob = await deployment.seedAccount('bob')
  await call(page, 'PUT', `/projects/${project}/members/${bob.id}`, { role: 'read-write' })

  // Step 1: create the task, in the browser: its fields on the creation screen, then who can do
  // it and who will do it on its page.
  const form = await openNewTask(page)
  await form.getByLabel('Title').fill('Write install guide')
  await form.getByLabel('Description').fill('Steps for a fresh install')
  await form.getByLabel('Planned start').fill('2027-03-01')
  await form.getByLabel('Duration in working days').fill('3')
  await form.getByLabel('Effort').fill('5')
  await form.getByLabel('AI share in percent').fill('0')
  await form.getByRole('button', { name: 'Create task' }).click()
  await expect(page.getByRole('heading', { name: 'Write install guide', level: 1 })).toBeVisible()
  const task = taskOnPage(page)

  const eligibility = page.getByRole('group', { name: 'Eligibility' })
  await eligibility.getByLabel('Top level', { exact: true }).selectOption('Any of (OR)')
  await eligibility.getByLabel('Add a person to the top level').selectOption('alice')
  await eligibility.getByLabel('Add a person to the top level').selectOption('bob')
  await page.getByRole('button', { name: 'Save eligibility' }).click()
  await expect.poll(async () => (await readTask(page, task))['eligibility']).not.toBeNull()
  await page
    .getByRole('group', { name: 'Assigned people' })
    .getByLabel('Assign a person')
    .selectOption('alice')
  await page.getByRole('button', { name: 'Save assignment' }).click()
  await expect.poll(async () => (await readTask(page, task))['assignees']).toEqual([alice.id])

  // Step 2: read it back through the REST API.
  const read = await readTask(page, task)
  expect(read).toMatchObject({
    title: 'Write install guide',
    description: 'Steps for a fresh install',
    projectId: project,
    plannedStart: '2027-03-01',
    durationWorkingDays: 3,
    effort: 5,
    aiShare: 0,
    eligibility: { any: [alice.id, bob.id] },
    assignees: [alice.id],
    githubIssue: null,
  })
  expect(read['status']).toEqual(expect.any(String))
  expect(read['plannedFinish']).toEqual(expect.any(String))
  expect(read).toHaveProperty('githubIssue', null)
  // Negative: no other task is created in Apollo.
  expect((await tasksOf(page, project)).map((t) => t['id'])).toEqual([task])
})

test("TC-002: a task's duration is held in whole working days", async ({ browser, deployment }) => {
  const { page, apollo: project } = await apollo(browser, deployment)

  // Step 1: create Draft schema in the browser, starting on Thursday 2027-03-04, for 3 days.
  const form = await openNewTask(page)
  await form.getByLabel('Title').fill('Draft schema')
  await form.getByLabel('Planned start').fill('2027-03-04')
  // Negative: the duration is offered in working days, and in no other unit.
  await expect(form.getByLabel(/duration/i)).toHaveCount(1)
  await form.getByLabel('Duration in working days').fill('3')
  await form.getByRole('button', { name: 'Create task' }).click()
  await expect(page.getByRole('heading', { name: 'Draft schema', level: 1 })).toBeVisible()
  const task = taskOnPage(page)

  // Step 2: three working days, Thursday, Friday and Monday.
  expect(await readTask(page, task)).toMatchObject({
    durationWorkingDays: 3,
    plannedFinish: '2027-03-08',
  })

  // Step 3: try 2.5; it is refused, and no fractional duration is stored.
  const details = page.getByRole('form', { name: 'Details' })
  await details.getByLabel('Duration in working days').fill('2.5')
  await details.getByRole('button', { name: 'Save details' }).click()
  await expect(details.getByRole('alert')).toHaveText(
    'The duration is a whole number of working days, 1 or more.',
  )
  expect((await readTask(page, task))['durationWorkingDays']).toBe(3)
  expect((await tasksOf(page, project)).map((t) => t['durationWorkingDays'])).toEqual([3])
})

test('TC-003: a task without planned dates is kept as unscheduled in its project', async ({
  browser,
  deployment,
}) => {
  const { page, apollo: project } = await apollo(browser, deployment)

  // Step 1: create Triage backlog in the browser with a title only.
  const form = await openNewTask(page)
  await expect(form.getByText('No planned dates: the task is unscheduled.')).toBeVisible()
  await form.getByLabel('Title').fill('Triage backlog')
  await form.getByRole('button', { name: 'Create task' }).click()
  await expect(page.getByRole('heading', { name: 'Triage backlog', level: 1 })).toBeVisible()
  const task = taskOnPage(page)
  await expect(
    page
      .getByRole('form', { name: 'Details' })
      .getByText('No planned dates: the task is unscheduled.'),
  ).toBeVisible()

  // Steps 2 and 3: it is in Apollo's task list, with no planned dates.
  const listed = await tasksOf(page, project)
  expect(listed.map((t) => t['id'])).toEqual([task])
  expect(await readTask(page, task)).toMatchObject({
    projectId: project,
    plannedStart: null,
    plannedFinish: null,
    durationWorkingDays: null,
  })
})

test('TC-208: a task is assigned to a repository its project pulls issues from', async ({
  browser,
  deployment,
}) => {
  deployment.github.createRepository('csillagu/tc-repo')
  const { page, apollo: project } = await apollo(browser, deployment)
  // tc-repo, registered by alice and added to Apollo: she is admin of both, so it is approved.
  const repository = idOf(
    await call(page, 'POST', '/repositories', { owner: 'csillagu', name: 'tc-repo' }),
  )
  await call(page, 'POST', `/projects/${project}/repository-requests`, { repositoryId: repository })
  const task = idOf(await call(page, 'POST', `/projects/${project}/tasks`, { title: 'T' }))

  // Step 1: assign T to tc-repo, on its page.
  await openTask(page, task, 'T')
  const section = page.getByRole('form', { name: 'Repository' })
  await section.getByRole('combobox', { name: 'Repository' }).selectOption('csillagu/tc-repo')
  await section.getByRole('button', { name: 'Assign to repository' }).click()

  // Step 2: T is assigned to tc-repo, and to no other repository.
  await expect.poll(async () => (await readTask(page, task))['repositoryId']).toBe(repository)
  await expect(section.getByRole('combobox', { name: 'Repository' })).toHaveValue(repository)
  // Its issue is created on the deployment's fake GitHub, which the planning mirror calls; the
  // test case's cleanup deletes it.
  await expect.poll(() => deployment.github.issues.issuesOf('csillagu/tc-repo').length).toBe(1)
})

test('TC-209: assigning a task to a repository its project does not pull from is rejected', async ({
  browser,
  deployment,
}) => {
  deployment.github.createRepository('csillagu/tc-other')
  const { page, apollo: project } = await apollo(browser, deployment)
  const bob = await deployment.seedAccount('bob')
  const bobs = await signedIn(browser, deployment.url, bob)
  await call(bobs, 'POST', '/repositories', { owner: 'csillagu', name: 'tc-other' })
  const task = idOf(await call(page, 'POST', `/projects/${project}/tasks`, { title: 'T' }))

  // Step 1: try to assign T to tc-other, on its page: Apollo pulls from no repository, so there is
  // none to choose, tc-other included.
  await openTask(page, task, 'T')
  const section = page.getByRole('form', { name: 'Repository' })
  await expect(section.getByText('The project pulls issues from no repository.')).toBeVisible()
  await expect(section.getByRole('combobox', { name: 'Repository' })).toHaveCount(0)
  await expect(page.getByRole('option', { name: 'csillagu/tc-other' })).toHaveCount(0)

  // Step 2: T is assigned to no repository, and tc-other has no new issue.
  expect(await readTask(page, task)).toMatchObject({ repositoryId: null, githubIssue: null })
  expect(deployment.github.issues.issuesOf('csillagu/tc-other')).toEqual([])
  await bobs.context().close()
})

test('TC-037: a task can be cancelled in the tool', async ({ browser, deployment }) => {
  const { page, apollo: project } = await apollo(browser, deployment)
  const task = idOf(await call(page, 'POST', `/projects/${project}/tasks`, { title: 'T' }))

  // Step 1: cancel T, from its page.
  await openTask(page, task, 'T')
  const status = page.getByRole('region', { name: 'Status' })
  await expect(status.getByLabel('Status: Not started')).toBeVisible()
  await status.getByRole('button', { name: 'Cancel task' }).click()
  await status.getByRole('button', { name: 'Cancel the task' }).click()
  await expect(page.getByLabel('Status: Cancelled')).toBeVisible()

  // Step 2: T is cancelled, and still in Apollo.
  expect((await readTask(page, task))['status']).toBe('cancelled')
  const listed = await tasksOf(page, project)
  expect(listed.map((t) => [t['id'], t['status']])).toEqual([[task, 'cancelled']])
})

test('TC-170: a change in the UI is logged with who, when and the UI channel', async ({
  browser,
  deployment,
}) => {
  const { page, apollo: project } = await apollo(browser, deployment)
  const task = idOf(await call(page, 'POST', `/projects/${project}/tasks`, { title: 'Draft' }))

  // Step 1: change T's title to Final, in the browser, at t.
  await openTask(page, task, 'Draft')
  const details = page.getByRole('form', { name: 'Details' })
  await details.getByLabel('Title').fill('Final')
  const t = Date.now()
  await details.getByRole('button', { name: 'Save details' }).click()
  await expect(page.getByRole('heading', { name: 'Final', level: 1 })).toBeVisible()

  // Step 2: read Apollo's audit log, through the REST API (F04 reads it on its page).
  const log = records(await call(page, 'GET', `/audit-log?projectId=${project}`))
  const renamed = log.filter(
    (entry) => record(entry['subject'])['id'] === task && entry['action'] === 'task.updated',
  )
  expect(renamed).toHaveLength(1)
  expect(renamed[0]).toMatchObject({ by: { username: 'alice' }, channels: ['ui'] })
  // Negative: the entry names no other channel.
  expect(renamed[0]!['channels']).toEqual(['ui'])
  const at = new Date(String(renamed[0]!['at'])).getTime()
  expect(Math.abs(at - t)).toBeLessThan(60_000)
})
