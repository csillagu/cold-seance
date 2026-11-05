import { expect, test } from '../fixtures.ts'

// The browser tests' own setup (node P01): each test gets a fresh test deployment whose backend
// serves the built frontend. The test cases' browser steps are written beside this file by the
// frontend nodes, one spec file per screen or test case, each test named with its TC's id.

test('the deployment serves the built frontend to the browser', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/.+/)
  await expect(page.locator('#root')).not.toBeEmpty()
})

test('a page address outside /api gets the frontend, which the browser renders', async ({
  page,
}) => {
  const response = await page.goto('/projects/anything')
  expect(response?.status()).toBe(200)
  await expect(page.locator('#root')).not.toBeEmpty()
})

test('the deployment has its first system admin root, and the accounts a test seeds', async ({
  deployment,
  request,
}) => {
  // Without a session, the API refuses (SC-026).
  expect((await request.get('/api/accounts')).status()).toBe(401)
  const alice = await deployment.seedAccount('alice')
  for (const account of [deployment.root, alice]) {
    const signIn = await request.post('/api/session', {
      data: { username: account.username, password: account.password },
    })
    expect(signIn.ok()).toBe(true)
  }
})
