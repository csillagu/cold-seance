import type { Browser, Page } from '@playwright/test'
import { projectMembers, projects } from '../../backend/src/db/schema.ts'
import { type Account, expect, test } from '../fixtures.ts'

// The project screens in the browser: the project creation form (SC-079), where anyone with an
// account creates a project (FR-119) under a name no other project has (FR-120), and the project
// members and roles screen (SC-080), where a project's admin manages its members and their roles
// (FR-105, FR-109) and cannot remove its last admin (FR-110). The REST API side of these test
// cases is in backend/test/integration/projects.test.ts and project-roles.test.ts.

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

/** Creates the project `name` on the project creation form, opened from the navigation. */
async function openForm(page: Page, name: string) {
  await navigation(page).getByRole('link', { name: 'New project' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'New project' })).toBeVisible()
  await page.getByLabel('Project name').fill(name)
  await page.getByRole('button', { name: 'Create project' }).click()
}

/**
 * Creates the project `name` on the form and waits for its page, which opens on its Kanban (#221);
 * answers the project's id.
 */
async function createProject(page: Page, name: string): Promise<string> {
  await openForm(page, name)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
  await expect(page).toHaveURL(/\/kanban$/)
  const id = /^\/projects\/([0-9a-f-]{36})\/kanban$/.exec(new URL(page.url()).pathname)?.[1]
  expect(id).toBeDefined()
  return id ?? ''
}

/** Opens the members screen of the project `name`, from the navigation. */
async function openMembers(page: Page, name: string) {
  await navigation(page).getByRole('link', { name, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
  await page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('link', { name: 'Members' })
    .click()
  await expect(page.getByRole('table', { name: `Members of ${name}` })).toBeVisible()
}

/** Adds `username` to the project whose members screen is open, with `role`. */
async function addMember(page: Page, username: string, role: string) {
  const form = page.getByRole('form', { name: 'Add a member' })
  await form.getByLabel('Username').fill(username)
  await form.getByLabel('Role').selectOption({ label: role })
  await form.getByRole('button', { name: 'Add member' }).click()
}

/** The role the members screen shows `username` holding, by the role's name. */
const roleOf = (page: Page, username: string) =>
  page.getByRole('combobox', { name: `Role of ${username}` })

test('TC-178: anyone with an account creates a project', async ({ browser, deployment }) => {
  const erin = await deployment.seedAccount('erin')
  const page = await signedIn(browser, deployment.url, erin)

  // Step 1: as erin, create Erin's project on the project creation form.
  await createProject(page, "Erin's project")

  // Step 2: the projects erin can read, as the navigation lists them, include it.
  await expect(navigation(page).getByRole('link', { name: "Erin's project" })).toBeVisible()
  await page.reload()
  await expect(navigation(page).getByRole('link', { name: "Erin's project" })).toBeVisible()

  // Negative: no other project is created.
  expect((await deployment.db.select().from(projects)).map((p) => p.name)).toEqual([
    "Erin's project",
  ])
})

test('TC-179: creating a project with a name already used is rejected', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  await createProject(await signedIn(browser, deployment.url, alice), 'Apollo')

  // Step 1: as bob, try to create a project named Apollo; the form says it is refused.
  const page = await signedIn(browser, deployment.url, bob)
  await openForm(page, 'Apollo')
  await expect(page.getByRole('alert')).toHaveText('A project named Apollo already exists')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('New project')
  await expect(navigation(page).getByRole('link', { name: 'Apollo' })).toHaveCount(0)

  // Step 2: there is exactly one project named Apollo, created by alice. (Listing all projects as
  // root reads the database here, as the UI lists only the projects one can read.)
  const all = await deployment.db.select().from(projects)
  expect(all.map((p) => [p.name, p.createdBy])).toEqual([['Apollo', alice.id]])

  // Negative: bob is not made admin of any project.
  const bobs = (await deployment.db.select().from(projectMembers)).filter(
    (m) => m.accountId === bob.id,
  )
  expect(bobs).toEqual([])
})

test('TC-153: a person holds a different role in each project', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  await deployment.seedAccount('bob')
  const page = await signedIn(browser, deployment.url, alice)
  const given = [
    ['P1', 'Read-only'],
    ['P2', 'Contributor'],
    ['P3', 'Read-write'],
    ['P4', 'Admin'],
  ] as const

  // Step 1: as alice, create the four projects and give bob a different role in each.
  for (const [name, role] of given) {
    await createProject(page, name)
    await openMembers(page, name)
    await addMember(page, 'bob', role)
    await expect(page.getByRole('status')).toHaveText(
      `bob is now ${role.toLowerCase()} in ${name}.`,
    )
  }

  // Step 2: read bob's role in each project, afresh.
  for (const [name, role] of given) {
    await page.goto('/')
    await openMembers(page, name)
    const select = roleOf(page, 'bob')
    await expect(select.locator('option:checked')).toHaveText(role)

    // Negative: no role offered falls outside these four.
    await expect(select.locator('option')).toHaveText([
      'Read-only',
      'Contributor',
      'Read-write',
      'Admin',
    ])
  }
})

test("TC-160: a project admin manages the project's members and roles", async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  await deployment.seedAccount('bob')
  const page = await signedIn(browser, deployment.url, alice)
  await createProject(page, 'Apollo')
  await openMembers(page, 'Apollo')

  // Step 1: as alice, add bob with the read-only role; read his role.
  await addMember(page, 'bob', 'Read-only')
  await expect(page.getByRole('status')).toHaveText('bob is now read-only in Apollo.')
  await page.reload()
  await expect(roleOf(page, 'bob')).toHaveValue('read-only')
  await expect(roleOf(page, 'alice')).toHaveValue('admin')

  // Step 2: change bob's role to read-write; read it.
  await roleOf(page, 'bob').selectOption({ label: 'Read-write' })
  await expect(page.getByRole('status')).toHaveText('bob is now read-write in Apollo.')
  await page.reload()
  await expect(roleOf(page, 'bob')).toHaveValue('read-write')
  await expect(roleOf(page, 'alice')).toHaveValue('admin')

  // Step 3: remove bob from Apollo; read Apollo's members.
  await page.getByRole('button', { name: 'Remove bob' }).click()
  await expect(page.getByRole('status')).toHaveText('bob is no longer a member of Apollo.')
  await page.reload()
  const table = page.getByRole('table', { name: 'Members of Apollo' })
  await expect(table.getByRole('rowheader')).toHaveText(['alice(you)'])

  // Negative: alice's own role stays admin throughout.
  await expect(roleOf(page, 'alice')).toHaveValue('admin')
})

test("TC-161: removing a project's last admin is rejected", async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const page = await signedIn(browser, deployment.url, alice)
  await createProject(page, 'Apollo')
  await openMembers(page, 'Apollo')
  await addMember(page, 'bob', 'Read-write')
  await expect(page.getByRole('status')).toHaveText('bob is now read-write in Apollo.')

  // Step 1: as alice, try to remove alice from Apollo; it is refused.
  await page.getByRole('button', { name: 'Remove alice' }).click()
  await expect(page.getByRole('alert')).toHaveText("The project's last admin cannot be removed")

  // Step 2: read Apollo's members, afresh: alice is still its admin.
  await page.reload()
  await expect(roleOf(page, 'alice')).toHaveValue('admin')

  // Negative: bob is not made admin as a side effect.
  await expect(roleOf(page, 'bob')).toHaveValue('read-write')
  const bobs = (await deployment.db.select().from(projectMembers)).filter(
    (m) => m.accountId === bob.id,
  )
  expect(bobs.map((m) => m.role)).toEqual(['read-write'])
})
