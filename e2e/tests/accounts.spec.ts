import type { Page } from '@playwright/test'
import { accounts } from '../../backend/src/db/schema.ts'
import { storedAccount } from '../../backend/test/helpers/accounts.ts'
import { type Account, expect, test } from '../fixtures.ts'

// The account screens in the browser: account administration (SC-076), where system admins create
// accounts (FR-117) and make other people system admins (FR-140), and the GitHub account link
// setting (SC-077), where a person or a system admin links the person's GitHub account (FR-135).
// The REST API side of these test cases is in backend/test/integration/accounts.test.ts and
// github-links.test.ts.

async function signIn(page: Page, account: Pick<Account, 'username' | 'password'>) {
  await page.goto('/sign-in')
  await page.getByLabel('Username').fill(account.username)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('navigation', { name: 'Navigation' })).toBeVisible()
}

/**
 * Ends the browser's session through the API the frontend uses (the signed-in person menu, with
 * its sign-out, is SC-115's, node F02).
 */
async function signOut(page: Page) {
  const status = await page.evaluate(
    async () => (await fetch('/api/session', { method: 'DELETE' })).status,
  )
  expect(status).toBe(204)
}

/** Opens account administration from the navigation. */
async function openAccounts(page: Page) {
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Accounts' })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible()
}

async function createAccount(page: Page, account: Pick<Account, 'username' | 'password'>) {
  const form = page.getByRole('form', { name: 'Create an account' })
  await form.getByLabel('Username').fill(account.username)
  await form.getByLabel('Password').fill(account.password)
  await form.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('status')).toHaveText(`Account ${account.username} created.`)
}

const ERIN = { username: 'erin', password: 'erin-password' }

/** The usernames of the accounts linked to the GitHub account `login`. */
async function linkedTo(db: Parameters<typeof storedAccount>[0], login: string) {
  return (await db.select().from(accounts))
    .filter((a) => a.githubLogin?.toLowerCase() === login.toLowerCase())
    .map((a) => a.username)
}

test('TC-174: a system admin creates an account', async ({ deployment, page }) => {
  // Step 1: as root, create erin on the account administration screen.
  await signIn(page, deployment.root)
  await openAccounts(page)
  await createAccount(page, ERIN)
  await expect(page.getByRole('table', { name: 'Accounts' })).toContainText('erin')

  // Step 2: erin can sign in.
  await signOut(page)
  await signIn(page, ERIN)

  // Negative: erin is not a system admin; the navigation offers her no account administration.
  const nav = page.getByRole('navigation', { name: 'Navigation' })
  await expect(nav.getByRole('link', { name: 'API tokens' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Accounts' })).toHaveCount(0)
  expect((await storedAccount(deployment.db, 'erin'))?.systemAdmin).toBe(false)
})

test('TC-175: someone who is not a system admin cannot create an account (alice is offered no way to create accounts)', async ({
  deployment,
  page,
}) => {
  const alice = await deployment.seedAccount('alice')
  await signIn(page, alice)
  // alice is the admin of Apollo, which she creates.
  const created = await page.evaluate(async () => {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Apollo' }),
    })
    return response.status
  })
  expect(created).toBe(201)
  await page.reload()

  // The navigation leads her to no account administration.
  const nav = page.getByRole('navigation', { name: 'Navigation' })
  await expect(nav.getByRole('link', { name: 'Apollo' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'API tokens' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Accounts' })).toHaveCount(0)

  // Opened by its address, the screen offers her nothing to create an account with.
  await page.goto('/accounts')
  await expect(page.getByText('Only system admins can administer accounts.')).toBeVisible()
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('main').getByRole('textbox')).toHaveCount(0)
  // The REST API's refusal and the failed sign-in as erin are tested through the API.
  expect(await storedAccount(deployment.db, 'erin')).toBeUndefined()
})

test('TC-207: a system admin makes another person a system admin', async ({ deployment, page }) => {
  const alice = await deployment.seedAccount('alice')

  // Step 1: as root, make alice a system admin on the account administration screen.
  await signIn(page, deployment.root)
  await openAccounts(page)
  await page.getByRole('button', { name: 'Make alice a system admin' }).click()
  await expect(page.getByRole('status')).toHaveText('alice is now a system admin.')
  await expect(page.getByRole('row', { name: /alice/ })).toContainText('System admin')

  // Step 2: as alice, create erin; it succeeds, as alice is now a system admin.
  await signOut(page)
  await signIn(page, alice)
  await openAccounts(page)
  await createAccount(page, ERIN)

  // Negative: root is still a system admin.
  await expect(page.getByRole('row', { name: /root/ })).toContainText('System admin')
  expect((await storedAccount(deployment.db, 'root'))?.systemAdmin).toBe(true)
})

test('TC-199: a person links their own GitHub account', async ({ deployment, page }) => {
  const alice = await deployment.seedAccount('alice')
  await signIn(page, alice)

  // Step 1: as alice, link her account to tc-alice in her settings.
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'GitHub account' })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: 'Your GitHub account' })).toBeVisible()
  await expect(page.getByTestId('github-link')).toHaveText('Not linked to a GitHub account.')
  await page.getByLabel('GitHub account name').fill('tc-alice')
  await page.getByRole('button', { name: 'Link' }).click()
  await expect(page.getByRole('status')).toHaveText('Linked to the GitHub account tc-alice.')

  // Step 2: read alice's linked GitHub account, afresh.
  await page.reload()
  await expect(page.getByTestId('github-link')).toHaveText('Linked to the GitHub account tc-alice.')

  // Negative: no other account in the tool is linked to tc-alice.
  expect(await linkedTo(deployment.db, 'tc-alice')).toEqual(['alice'])
  // Not tested: that the tester can sign in to GitHub as tc-alice. The link is given by name alone
  // (SRC-202), so nothing here signs in to GitHub.
})

test("TC-200: a system admin links a person's GitHub account", async ({ deployment, page }) => {
  await deployment.seedAccount('alice')

  // Step 1: as root, link alice's account to tc-alice, from account administration.
  await signIn(page, deployment.root)
  await openAccounts(page)
  await page.getByRole('link', { name: 'GitHub account of alice' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'GitHub account of alice' }),
  ).toBeVisible()
  await page.getByLabel('GitHub account name').fill('tc-alice')
  await page.getByRole('button', { name: 'Link' }).click()
  await expect(page.getByRole('status')).toHaveText('Linked to the GitHub account tc-alice.')

  // Step 2: read alice's linked GitHub account, afresh.
  await page.reload()
  await expect(page.getByTestId('github-link')).toHaveText('Linked to the GitHub account tc-alice.')

  // Negative: root's own account is not linked to tc-alice.
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'GitHub account' })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: 'Your GitHub account' })).toBeVisible()
  await expect(page.getByTestId('github-link')).toHaveText('Not linked to a GitHub account.')
  expect(await linkedTo(deployment.db, 'tc-alice')).toEqual(['alice'])
})

test('TC-240: the first system admin comes from an environment variable', async ({
  deployment,
  page,
}) => {
  // The deployment was started with the first system admin root given by the environment
  // variables the tool documents (FR-165), on an empty database.

  // Negative: no other account exists before step 2.
  expect((await deployment.db.select().from(accounts)).map((a) => a.username)).toEqual(['root'])

  // Steps 1 and 2: root signs in, and creates alice, so root is a system admin.
  await signIn(page, deployment.root)
  await openAccounts(page)
  await createAccount(page, { username: 'alice', password: 'alice-password' })
  expect(await storedAccount(deployment.db, 'alice')).toBeDefined()
})

test('a person creates an API token, sees its secret once, and revokes it (SC-078)', async ({
  deployment,
  page,
}) => {
  const alice = await deployment.seedAccount('alice')
  await signIn(page, alice)
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'API tokens' })
    .click()
  await expect(page.getByText('You have no tokens.')).toBeVisible()

  await page.getByRole('button', { name: 'Create token' }).click()
  const secret = (await page.getByTestId('token-secret').textContent()) ?? ''
  expect(secret).not.toBe('')
  // The token acts as alice through the REST API.
  const status = await page.evaluate(
    async (token) =>
      (
        await fetch('/api/projects', {
          credentials: 'omit',
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    secret,
  )
  expect(status).toBe(200)

  // Shown once: afresh, the page lists the token but not its secret.
  await page.reload()
  await expect(page.getByRole('table', { name: 'Your tokens' }).getByRole('row')).toHaveCount(2)
  await expect(page.getByTestId('token-secret')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(secret)

  await page.getByRole('button', { name: /^Revoke the token created/ }).click()
  await expect(page.getByText('You have no tokens.')).toBeVisible()
  const after = await page.evaluate(
    async (token) =>
      (
        await fetch('/api/projects', {
          credentials: 'omit',
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    secret,
  )
  expect(after).toBe(401)
})
