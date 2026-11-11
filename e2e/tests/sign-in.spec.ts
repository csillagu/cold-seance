import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures.ts'

// The sign-in page (SC-075) in the browser: a person signs in with an account held in the tool
// (FR-118), and nobody can register (FR-117).

/**
 * The status the API answers `method` on `path` with, asked from the page, so with the browser's
 * session cookie. (Playwright's own request context does not send the cookie, which is `Secure`,
 * to a test deployment served over plain HTTP.)
 */
async function apiStatus(page: Page, method: string, path: string): Promise<number> {
  return page.evaluate(async ([m, p]) => (await fetch(p, { method: m })).status, [
    method,
    path,
  ] as const)
}

async function signIn(page: Page, username: string, password: string) {
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('TC-177: a person signs in with an account held in the tool', async ({ deployment, page }) => {
  const alice = await deployment.seedAccount('alice')

  // Step 1: on the sign-in page, alice signs in with her credentials C, and is signed in.
  await page.goto('/sign-in')
  await signIn(page, alice.username, alice.password)
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('navigation', { name: 'Navigation' })).toBeVisible()
  expect(await apiStatus(page, 'GET', '/api/projects')).toBe(200)

  // Step 2: she signs out (the signed-in person menu, SC-115, is node F02's; here the browser's
  // session is ended through the API it uses), and her sign-in with wrong credentials W is refused.
  expect(await apiStatus(page, 'DELETE', '/api/session')).toBe(204)
  await page.goto('/sign-in')
  await signIn(page, alice.username, 'not-alice-password')
  await expect(page.getByRole('alert')).toHaveText(
    'Signing in failed. The username or the password is wrong.',
  )
  await expect(page).toHaveURL('/sign-in')
  expect(await apiStatus(page, 'GET', '/api/projects')).toBe(401)

  // Negative: the sign-in page offers no sign-in through an outside identity provider. Its one
  // control that acts is the form's own button, and it links nowhere.
  await expect(page.getByRole('button')).toHaveText(['Sign in'])
  await expect(page.getByRole('link')).toHaveCount(0)
})

test('TC-176: there is no self-registration (the sign-in page offers no registration)', async ({
  page,
}) => {
  // Step 1, in a browser with no one signed in: the tool sends it to the sign-in page.
  await page.goto('/')
  await expect(page).toHaveURL(/\/sign-in/)
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()

  await expect(page.getByRole('link')).toHaveCount(0)
  await expect(page.getByRole('button')).toHaveText(['Sign in'])
  await expect(page.locator('body')).not.toContainText(/register|sign up|create (an )?account/i)
  // Step 2 (the REST API rejects creating erin without a session) and the negative assertion are
  // tested through the API, in backend/test/integration/accounts.test.ts.
})

test('someone who is not signed in comes back to the page they opened once signed in', async ({
  deployment,
  page,
}) => {
  const alice = await deployment.seedAccount('alice')
  await page.goto('/no-such-page')
  await expect(page).toHaveURL(/\/sign-in\?next=/)
  await signIn(page, alice.username, alice.password)
  await expect(page).toHaveURL('/no-such-page')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This page does not exist')
})
