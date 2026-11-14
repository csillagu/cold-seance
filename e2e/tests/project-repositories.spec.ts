import type { Browser, Page } from '@playwright/test'
import { notifications } from '../../backend/src/db/schema.ts'
import { type Account, expect, test } from '../fixtures.ts'

// The project repository settings screen (SC-081) and its receiving project control (SC-112) in
// the browser: a project's admin asks to add a registered repository, which waits for one of the
// repository's admins (FR-142) unless they are one too (FR-170), and marks the project as a
// repository's receiving project (FR-143). The REST API side of these test cases is in
// backend/test/integration/project-repositories.test.ts and receiving-projects.test.ts.

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

/** Calls the REST API as the person signed in on `page`, failing unless it succeeds. */
async function call(page: Page, method: string, path: string, data?: unknown): Promise<unknown> {
  const answer = await page.evaluate(
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

/** `fullName` on the fake GitHub, registered in the tool by the person of `page`. */
async function registered(page: Page, fullName: string): Promise<void> {
  const [owner, name] = fullName.split('/')
  await call(page, 'POST', '/repositories', { owner, name })
}

/** Project `name`, created by the person of `page`. Gives its id. */
async function createProject(page: Page, name: string): Promise<string> {
  return idOf(await call(page, 'POST', '/projects', { name }))
}

/** Opens the project's repository settings from the project's page. */
async function openSettings(page: Page, project: string) {
  await page.goto(`/projects/${project}`)
  await page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('link', { name: 'Repositories' })
    .click()
  await expect(page.getByRole('heading', { level: 2, name: 'Add a repository' })).toBeVisible()
}

/** Chooses `fullName` on the settings screen and asks to add it. */
async function addRepository(page: Page, fullName: string) {
  await page.getByLabel('Repository', { exact: true }).selectOption({ label: fullName })
  await page.getByRole('button', { name: 'Add repository' }).click()
}

/** The rows of the settings screen's table `name`, below its header. */
const rows = (page: Page, name: string) =>
  page.getByRole('table', { name }).locator('tbody').getByRole('row')

test.beforeEach(({ deployment }) => {
  deployment.github.createRepository('csillagu/tc-repo')
})

test('TC-210: a project admin adds a repository the project pulls issues from, once approved', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const alicePage = await signedIn(browser, deployment.url, alice)
  const bobPage = await signedIn(browser, deployment.url, bob)
  await registered(bobPage, 'csillagu/tc-repo')
  const apollo = await createProject(alicePage, 'Apollo')

  // Step 1: as alice, set tc-repo as a repository Apollo pulls issues from. Read Apollo's
  // repositories.
  await openSettings(alicePage, apollo)
  await addRepository(alicePage, 'csillagu/tc-repo')
  await expect(alicePage.getByRole('status')).toHaveText(
    "Apollo's request for csillagu/tc-repo waits for one of its admins to approve it.",
  )
  await expect(rows(alicePage, 'Waiting for approval')).toHaveText(['csillagu/tc-repoalice'])
  // tc-repo is not yet among Apollo's repositories.
  await expect(alicePage.getByText('Apollo pulls issues from no repository.')).toBeVisible()

  // Step 2: as bob, approve the request in his inbox. Read Apollo's repositories again.
  await bobPage.goto('/repository-requests')
  await bobPage
    .getByRole('button', { name: "Approve Apollo's request for csillagu/tc-repo" })
    .click()
  await expect(bobPage.getByRole('status')).toHaveText('csillagu/tc-repo is added to Apollo.')
  await alicePage.reload()
  await expect(rows(alicePage, 'Repositories Apollo pulls issues from')).toHaveText([
    'csillagu/tc-repoNot this projectMark as receiving',
  ])
  await expect(alicePage.getByText('No request is waiting.')).toBeVisible()

  // Negative: bob gains no role in Apollo; its members screen lists alice alone.
  await alicePage.getByRole('link', { name: 'Members' }).click()
  await expect(
    alicePage.getByRole('table', { name: 'Members of Apollo' }).getByRole('rowheader'),
  ).toHaveText(['alice(you)'])
})

test('TC-249: an admin of both the repository and the project adds it without approval', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const alicePage = await signedIn(browser, deployment.url, alice)
  await registered(alicePage, 'csillagu/tc-repo')
  const apollo = await createProject(alicePage, 'Apollo')
  const notified = await deployment.db.select().from(notifications)

  // Step 1: as alice, add tc-repo to Apollo to pull its issues.
  await openSettings(alicePage, apollo)
  await addRepository(alicePage, 'csillagu/tc-repo')
  await expect(alicePage.getByRole('status')).toHaveText('csillagu/tc-repo is added to Apollo.')

  // Step 2: read Apollo's repositories and alice's pending approvals. tc-repo is among Apollo's
  // repositories at once.
  await alicePage.reload()
  await expect(rows(alicePage, 'Repositories Apollo pulls issues from')).toHaveText([
    'csillagu/tc-repoNot this projectMark as receiving',
  ])
  // Negative: no approval request is pending for it, on this screen or in alice's inbox, and no
  // repository-request notification is sent.
  await expect(alicePage.getByText('No request is waiting.')).toBeVisible()
  await alicePage.goto('/repository-requests')
  await expect(alicePage.getByText('No request is waiting.')).toBeVisible()
  await expect(
    alicePage.getByRole('button', { name: "Approve Apollo's request for csillagu/tc-repo" }),
  ).toHaveCount(0)
  expect(await deployment.db.select().from(notifications)).toEqual(notified)
})

test("TC-211: a pulling project's admin marks it as the receiving project", async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const alicePage = await signedIn(browser, deployment.url, alice)
  const bobPage = await signedIn(browser, deployment.url, bob)
  await registered(alicePage, 'csillagu/tc-repo')
  const apollo = await createProject(alicePage, 'Apollo')
  const borealis = await createProject(bobPage, 'Borealis')
  // tc-repo is added to both, as a repository both pull issues from: to Apollo at once, as alice
  // is its admin, and to Borealis once alice approves bob's request. Neither is receiving.
  await openSettings(alicePage, apollo)
  await addRepository(alicePage, 'csillagu/tc-repo')
  await expect(alicePage.getByRole('status')).toHaveText('csillagu/tc-repo is added to Apollo.')
  await openSettings(bobPage, borealis)
  await addRepository(bobPage, 'csillagu/tc-repo')
  await expect(bobPage.getByRole('status')).toHaveText(
    "Borealis's request for csillagu/tc-repo waits for one of its admins to approve it.",
  )
  await alicePage.goto('/repository-requests')
  await alicePage
    .getByRole('button', { name: "Approve Borealis's request for csillagu/tc-repo" })
    .click()
  await expect(alicePage.getByRole('status')).toHaveText('csillagu/tc-repo is added to Borealis.')

  // Step 1: as bob, mark Borealis as the receiving project for tc-repo.
  await bobPage.reload()
  await bobPage.getByRole('button', { name: 'Mark Borealis as receiving csillagu/tc-repo' }).click()
  await expect(bobPage.getByRole('status')).toHaveText(
    'Borealis is now the receiving project of csillagu/tc-repo.',
  )

  // Step 2: read tc-repo's receiving project: Borealis.
  await bobPage.reload()
  await expect(rows(bobPage, 'Repositories Borealis pulls issues from')).toHaveText([
    'csillagu/tc-repoBorealisGive up receiving',
  ])
  // Negative: Apollo is not marked as receiving.
  await openSettings(alicePage, apollo)
  await expect(rows(alicePage, 'Repositories Apollo pulls issues from')).toHaveText([
    'csillagu/tc-repoNot this projectMark as receiving',
  ])
})
