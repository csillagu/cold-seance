import type { Browser, Page } from '@playwright/test'
import { projectMembers, projects, repositories } from '../../backend/src/db/schema.ts'
import { type Account, expect, test } from '../fixtures.ts'

// The repository screens in the browser: the repository registration screen (SC-085), where
// anyone with an account registers a repository the tool reaches on GitHub and nobody has
// registered (FR-167), and the repository admins screen (SC-086), where a repository's admins add
// and remove admins or step down (FR-174, FR-176), a system admin changes them (FR-169), and no
// change leaves the repository without an admin (FR-175). GitHub is the deployment's fake GitHub,
// on which each test creates the test case's "GitHub test repository". The REST API side of these
// test cases is in backend/test/integration/repositories.test.ts.

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

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation' })

/** Opens the repository registration screen from the navigation. */
async function openRepositories(page: Page) {
  await navigation(page).getByRole('link', { name: 'Repositories' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Repositories' })).toBeVisible()
}

/** Registers `fullName` on the repository registration screen, opened from the navigation. */
async function register(page: Page, fullName: string) {
  await openRepositories(page)
  await page.getByRole('textbox', { name: 'Repository' }).fill(fullName)
  await page.getByRole('button', { name: 'Register' }).click()
}

/** The registered repositories as the registration screen lists them: name, then admins. */
const listed = (page: Page) =>
  page.getByRole('table', { name: 'Registered repositories' }).getByRole('row')

/** Opens the admins screen of `fullName` from the registration screen. */
async function openAdmins(page: Page, fullName: string) {
  await openRepositories(page)
  await page.getByRole('link', { name: fullName }).click()
  await expect(page.getByRole('heading', { level: 1, name: fullName })).toBeVisible()
}

/** The admins the admins screen of `fullName` lists, by username. */
const admins = (page: Page, fullName: string) =>
  page.getByRole('table', { name: `Admins of ${fullName}` }).getByRole('rowheader')

/** Adds `username` as an admin on the admins screen that is open. */
async function addAdmin(page: Page, username: string) {
  const form = page.getByRole('form', { name: 'Add an admin' })
  await form.getByLabel('Username').fill(username)
  await form.getByRole('button', { name: 'Add admin' }).click()
}

/** tc-repo on GitHub with the tool's App installed, registered in the tool by `registrant`. */
async function tcRepoRegisteredBy(browser: Browser, url: string, registrant: Account) {
  const page = await signedIn(browser, url, registrant)
  await register(page, 'csillagu/tc-repo')
  await expect(page.getByRole('status')).toHaveText(
    'csillagu/tc-repo is registered, and you are its admin.',
  )
  return page
}

test.beforeEach(({ deployment }) => {
  deployment.github.createRepository('csillagu/tc-repo')
})

test('TC-242: anyone with an account registers an unregistered repository and becomes its admin', async ({
  browser,
  deployment,
}) => {
  const erin = await deployment.seedAccount('erin')
  const page = await signedIn(browser, deployment.url, erin)

  // Step 1: as erin, with no role anywhere, register tc-repo.
  await register(page, 'csillagu/tc-repo')
  await expect(page.getByRole('status')).toHaveText(
    'csillagu/tc-repo is registered, and you are its admin.',
  )

  // Step 2: read tc-repo's admins, afresh.
  await page.reload()
  await expect(listed(page)).toHaveText(['RepositoryAdmins', 'csillagu/tc-repoerin'])
  await openAdmins(page, 'csillagu/tc-repo')
  await expect(admins(page, 'csillagu/tc-repo')).toHaveText(['erin(you)'])

  // Negative: no project is created or changed.
  expect(await deployment.db.select().from(projects)).toEqual([])
  expect(await deployment.db.select().from(projectMembers)).toEqual([])
})

test('TC-243: registering an already registered repository is rejected', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  await tcRepoRegisteredBy(browser, deployment.url, alice)

  // Step 1: as bob, try to register tc-repo; it is refused.
  const page = await signedIn(browser, deployment.url, bob)
  await register(page, 'csillagu/tc-repo')
  await expect(page.getByRole('alert')).toHaveText('csillagu/tc-repo is already registered')

  // Step 2: the registered repositories, afresh: tc-repo once, with admins [alice].
  await page.reload()
  await expect(listed(page)).toHaveText(['RepositoryAdmins', 'csillagu/tc-repoalice'])
  await openAdmins(page, 'csillagu/tc-repo')
  // Negative: bob is not an admin of tc-repo.
  await expect(admins(page, 'csillagu/tc-repo')).toHaveText(['alice'])
})

test('TC-244: a repository the GitHub App cannot reach cannot be registered', async ({
  browser,
  deployment,
}) => {
  const erin = await deployment.seedAccount('erin')
  deployment.github.createRepository('csillagu/tc-closed', { installed: false })
  const page = await signedIn(browser, deployment.url, erin)

  // Step 1: as erin, try to register tc-closed; it is refused.
  await register(page, 'csillagu/tc-closed')
  await expect(page.getByRole('alert')).toHaveText(
    'The tool cannot reach csillagu/tc-closed on GitHub: its GitHub App is not installed on it, its token is not given it, or it does not exist',
  )

  // Step 2: list the registered repositories, afresh. Negative: tc-closed is not registered.
  await page.reload()
  await expect(page.getByText('No repository is registered yet.')).toBeVisible()
  expect(await deployment.db.select().from(repositories)).toEqual([])
})

test("TC-248: a system admin changes a repository's admins", async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  await deployment.seedAccount('bob')
  await tcRepoRegisteredBy(browser, deployment.url, alice)

  // Step 1: as root, not one of its admins, add bob as an admin of tc-repo, then remove alice.
  const page = await signedIn(browser, deployment.url, deployment.root)
  await openAdmins(page, 'csillagu/tc-repo')
  await addAdmin(page, 'bob')
  await expect(page.getByRole('status')).toHaveText('bob is now an admin of csillagu/tc-repo.')
  await page.getByRole('button', { name: 'Remove alice' }).click()
  await expect(page.getByRole('status')).toHaveText(
    'alice is no longer an admin of csillagu/tc-repo.',
  )

  // Step 2: read tc-repo's admins, afresh. Negative: root has not become one of them.
  await page.reload()
  await expect(admins(page, 'csillagu/tc-repo')).toHaveText(['bob'])
})

test('TC-254: a repository admin adds another admin', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  await deployment.seedAccount('bob')
  const page = await tcRepoRegisteredBy(browser, deployment.url, alice)

  // Step 1: as alice, make bob an admin of tc-repo.
  await openAdmins(page, 'csillagu/tc-repo')
  await addAdmin(page, 'bob')
  await expect(page.getByRole('status')).toHaveText('bob is now an admin of csillagu/tc-repo.')

  // Step 2: read tc-repo's admins, afresh. Negative: alice is still an admin.
  await page.reload()
  await expect(admins(page, 'csillagu/tc-repo')).toHaveText(['alice(you)', 'bob'])
})

test("TC-255: a repository's only admin cannot step down", async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const page = await tcRepoRegisteredBy(browser, deployment.url, alice)

  // Step 1: as alice, try to step down as admin of tc-repo; it is refused.
  await openAdmins(page, 'csillagu/tc-repo')
  await page.getByRole('button', { name: 'Step down' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'csillagu/tc-repo cannot be left without an admin: make someone else its admin first',
  )

  // Step 2: read tc-repo's admins, afresh.
  await page.reload()
  await expect(admins(page, 'csillagu/tc-repo')).toHaveText(['alice(you)'])

  // Negative: tc-repo is still registered.
  await openRepositories(page)
  await expect(listed(page)).toHaveText(['RepositoryAdmins', 'csillagu/tc-repoalice'])
})

test("TC-256: a system admin cannot remove a repository's only admin", async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  await tcRepoRegisteredBy(browser, deployment.url, alice)

  // Step 1: as root, try to remove alice as admin of tc-repo; it is refused.
  const page = await signedIn(browser, deployment.url, deployment.root)
  await openAdmins(page, 'csillagu/tc-repo')
  await page.getByRole('button', { name: 'Remove alice' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'csillagu/tc-repo cannot be left without an admin: make someone else its admin first',
  )

  // Step 2: read tc-repo's admins, afresh. Negative: root is not made an admin in alice's place.
  await page.reload()
  await expect(admins(page, 'csillagu/tc-repo')).toHaveText(['alice'])
})

test('TC-257: a repository admin removes another admin', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const alicePage = await tcRepoRegisteredBy(browser, deployment.url, alice)
  await openAdmins(alicePage, 'csillagu/tc-repo')
  await addAdmin(alicePage, 'bob')
  await expect(alicePage.getByRole('status')).toHaveText('bob is now an admin of csillagu/tc-repo.')

  // Step 1: as bob, remove alice as admin of tc-repo.
  const page = await signedIn(browser, deployment.url, bob)
  await openAdmins(page, 'csillagu/tc-repo')
  await page.getByRole('button', { name: 'Remove alice' }).click()
  await expect(page.getByRole('status')).toHaveText(
    'alice is no longer an admin of csillagu/tc-repo.',
  )

  // Step 2: read tc-repo's admins, afresh.
  await page.reload()
  await expect(admins(page, 'csillagu/tc-repo')).toHaveText(['bob(you)'])

  // Negative: tc-repo is still registered.
  await openRepositories(page)
  await expect(listed(page)).toHaveText(['RepositoryAdmins', 'csillagu/tc-repobob'])
})

test('TC-258: a repository admin steps down while another admin remains', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const page = await tcRepoRegisteredBy(browser, deployment.url, alice)
  await openAdmins(page, 'csillagu/tc-repo')
  await addAdmin(page, 'bob')
  await expect(page.getByRole('status')).toHaveText('bob is now an admin of csillagu/tc-repo.')

  // Step 1: as alice, step down as admin of tc-repo.
  await page.getByRole('button', { name: 'Step down' }).click()
  await expect(page.getByRole('status')).toHaveText(
    'You are no longer an admin of csillagu/tc-repo.',
  )

  // Step 2: read tc-repo's admins, afresh.
  await page.reload()
  await expect(admins(page, 'csillagu/tc-repo')).toHaveText(['bob'])

  // Negative: bob is unchanged as admin; he still has the controls an admin has.
  const bobPage = await signedIn(browser, deployment.url, bob)
  await openAdmins(bobPage, 'csillagu/tc-repo')
  await expect(admins(bobPage, 'csillagu/tc-repo')).toHaveText(['bob(you)'])
  await expect(bobPage.getByRole('form', { name: 'Add an admin' })).toBeVisible()
})
