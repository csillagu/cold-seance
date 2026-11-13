import type { Browser, Page } from '@playwright/test'
import { type Account, expect, test } from '../fixtures.ts'

// A project someone cannot see, opened in the browser (FR-017): the project page tells them it is
// not visible to them.

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

test('TC-025: opening a project one cannot see says it is not visible', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')

  // Inputs: project Borealis, created by bob, where alice has no role; its address in the UI,
  // taken from bob's browser.
  const bobsPage = await signedIn(browser, deployment.url, bob)
  // bob creates it on the project creation form (SC-079), which opens its page.
  await bobsPage.getByRole('navigation').getByRole('link', { name: 'New project' }).click()
  await bobsPage.getByLabel('Project name').fill('Borealis')
  await bobsPage.getByRole('button', { name: 'Create project' }).click()
  await expect(bobsPage.getByRole('heading', { level: 1 })).toHaveText('Borealis')
  const address = new URL(bobsPage.url()).pathname
  expect(address).toMatch(/^\/projects\/[0-9a-f-]{36}$/)

  // Step 1: as alice, open Borealis's address in the browser.
  const alicesPage = await signedIn(browser, deployment.url, alice)
  await alicesPage.goto(address)

  // The page tells alice that the project is not visible to her.
  const content = alicesPage.getByRole('main')
  await expect(content.getByRole('heading', { level: 1 })).toHaveText(
    'This project is not visible to you',
  )

  // Negative: the message does not say "not found", "deleted" or "no permission", and no data of
  // Borealis is shown, in the page or its navigation.
  await expect(alicesPage.locator('body')).not.toContainText(/not found|deleted|no permission/i)
  await expect(alicesPage.locator('body')).not.toContainText('Borealis')

  await bobsPage.context().close()
  await alicesPage.context().close()
})
