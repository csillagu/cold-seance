import type { Browser, Page } from '@playwright/test'
import { eq } from 'drizzle-orm'
import {
  groupMembers,
  groupProjects,
  groups,
  projectMembers,
  projects,
} from '../../backend/src/db/schema.ts'
import type { ProjectRole } from '../../backend/src/service/project-roles.ts'
import { grantRole, seedProject } from '../../backend/test/helpers/projects.ts'
import { type Account, type Deployment, expect, test } from '../fixtures.ts'

// The group screens in the browser: the group list screen (SC-082), where anyone signed in sees
// every group (FR-122) and creates one (FR-121), and only a system admin deletes one (FR-126); the
// group members screen (SC-083), where a group's admins manage its members (FR-124), a member
// leaves (FR-125) and the last admin cannot (FR-160); and the group projects screen (SC-084), where
// anyone adds a new project and only a project's admin an existing one (FR-123). The REST API side
// of these test cases is in backend/test/integration/groups.test.ts and saved-views.test.ts.

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

/** Puts in place the group `name` created by `creator`, its admin, with `members` besides. */
async function seedGroup(
  deployment: Deployment,
  creator: Account,
  name: string,
  members: [Account, ProjectRole][] = [],
): Promise<string> {
  const [group] = await deployment.db
    .insert(groups)
    .values({ name, createdBy: creator.id })
    .returning({ id: groups.id })
  if (!group) throw new Error('The group was not created')
  await deployment.db
    .insert(groupMembers)
    .values([
      { groupId: group.id, accountId: creator.id, role: 'admin' as const },
      ...members.map(([account, role]) => ({ groupId: group.id, accountId: account.id, role })),
    ])
  return group.id
}

const navigation = (page: Page) => page.getByRole('navigation', { name: 'Navigation' })
const groupList = (page: Page) => page.getByRole('table', { name: 'Groups' })

/** Opens the group list screen from the navigation. */
async function openGroups(page: Page) {
  await navigation(page).getByRole('link', { name: 'Groups' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible()
}

/** Opens the screen `screen` of the group `name`, from the group list screen. */
async function openGroup(page: Page, name: string, screen: 'Members' | 'Projects') {
  await openGroups(page)
  const row = groupList(page).getByRole('row').filter({ hasText: name })
  await row.getByRole('link', { name: screen }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
}

const memberTable = (page: Page, group: string) =>
  page.getByRole('table', { name: `Members of ${group}` })

/** The usernames the members screen lists, in order. */
const memberNames = (page: Page, group: string) => memberTable(page, group).getByRole('rowheader')

/** The group's members and their roles, as the database holds them, by account id. */
async function rolesIn(deployment: Deployment, groupId: string) {
  const rows = await deployment.db
    .select()
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
  return Object.fromEntries(rows.map((row) => [row.accountId, row.role]))
}

/** The projects the group projects screen lists, by name. */
const groupProjectNames = (page: Page, group: string) =>
  page.getByRole('list', { name: `Projects of ${group}` }).getByRole('link')

test('TC-180: anyone logged in creates a group', async ({ browser, deployment }) => {
  const erin = await deployment.seedAccount('erin')
  const page = await signedIn(browser, deployment.url, erin)

  // Step 1: as erin, create Erin's group on the group list screen.
  await openGroups(page)
  await page.getByLabel('Group name').fill("Erin's group")
  await page.getByRole('button', { name: 'Create group' }).click()
  await expect(page.getByRole('status')).toHaveText(
    "Group Erin's group is created, and you are its admin.",
  )

  // Step 2: list the groups, afresh.
  await page.reload()
  await expect(groupList(page).getByRole('rowheader')).toHaveText(["Erin's group"])

  // Negative: no project is created or changed.
  expect(await deployment.db.select().from(projects)).toEqual([])
})

test('TC-181: a non-member sees every group', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const dave = await deployment.seedAccount('dave')
  await seedGroup(deployment, alice, 'Platform')

  // Step 1: as dave, list the groups.
  const page = await signedIn(browser, deployment.url, dave)
  await openGroups(page)
  await expect(groupList(page).getByRole('rowheader')).toHaveText(['Platform'])

  // Negative: seeing the group gives dave no role on any project, and does not make him a member.
  expect(
    (await deployment.db.select().from(projectMembers)).filter((m) => m.accountId === dave.id),
  ).toEqual([])
  await openGroup(page, 'Platform', 'Members')
  await expect(page.getByRole('alert')).toHaveText("Only the group's members can see its members")
})

test('TC-182: anyone adds a new project to a group', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const dave = await deployment.seedAccount('dave')
  const platform = await seedGroup(deployment, alice, 'Platform')

  // Step 1: as dave, create project Delta in Platform, on Platform's projects screen.
  const page = await signedIn(browser, deployment.url, dave)
  await openGroup(page, 'Platform', 'Projects')
  await page.getByLabel('Project name').fill('Delta')
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByRole('status')).toHaveText(
    'Project Delta is created in Platform, and you are its admin.',
  )

  // Step 2: list Platform's projects, afresh.
  await page.reload()
  await expect(groupProjectNames(page, 'Platform')).toHaveText(['Delta'])
  await expect(navigation(page).getByRole('link', { name: 'Delta' })).toBeVisible()

  // Negative: dave does not become a member of Platform.
  expect(await rolesIn(deployment, platform)).toEqual({ [alice.id]: 'admin' })
})

test("TC-183: a project's admin adds the existing project to a group", async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const platform = await seedGroup(deployment, bob, 'Platform')
  const apollo = await seedProject(deployment.db, alice, 'Apollo')

  // Step 1: as alice, add Apollo to Platform.
  const page = await signedIn(browser, deployment.url, alice)
  await openGroup(page, 'Platform', 'Projects')
  await page.getByLabel('Project', { exact: true }).selectOption({ label: 'Apollo' })
  await page.getByRole('button', { name: 'Add project' }).click()
  await expect(page.getByRole('status')).toHaveText('Apollo is now in Platform.')

  // Step 2: list Platform's projects, afresh.
  await page.reload()
  await expect(groupProjectNames(page, 'Platform')).toHaveText(['Apollo'])

  // Negative: alice's role in Apollo is unchanged, and she is not made a member of Platform.
  const apolloRoles = await deployment.db
    .select()
    .from(projectMembers)
    .where(eq(projectMembers.projectId, apollo))
  expect(apolloRoles.map((m) => [m.accountId, m.role])).toEqual([[alice.id, 'admin']])
  expect(await rolesIn(deployment, platform)).toEqual({ [bob.id]: 'admin' })
})

test('TC-184: someone who is not its admin cannot add an existing project to a group', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const platform = await seedGroup(deployment, bob, 'Platform')
  const apollo = await seedProject(deployment.db, alice, 'Apollo')
  await grantRole(deployment.db, bob, apollo, 'read-write')

  // Step 1: as bob, try to add Apollo to Platform; the screen says it is refused.
  const page = await signedIn(browser, deployment.url, bob)
  await openGroup(page, 'Platform', 'Projects')
  await page.getByLabel('Project', { exact: true }).selectOption({ label: 'Apollo' })
  await page.getByRole('button', { name: 'Add project' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    "Only the project's admins can manage its members, roles, repositories and settings",
  )

  // Step 2: list Platform's projects, afresh: Apollo is not in it.
  await page.reload()
  await expect(page.getByText('No project you can see is in this group.')).toBeVisible()

  // Negative: Apollo is not in Platform, and Platform's members get no role on it.
  expect(
    await deployment.db.select().from(groupProjects).where(eq(groupProjects.groupId, platform)),
  ).toEqual([])
  const apolloRoles = await deployment.db
    .select()
    .from(projectMembers)
    .where(eq(projectMembers.projectId, apollo))
  expect(Object.fromEntries(apolloRoles.map((m) => [m.accountId, m.role]))).toEqual({
    [alice.id]: 'admin',
    [bob.id]: 'read-write',
  })
})

test('TC-185: a group admin adds a member, changes their role and removes them', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  await deployment.seedAccount('bob')
  const platform = await seedGroup(deployment, alice, 'Platform')
  const page = await signedIn(browser, deployment.url, alice)
  await openGroup(page, 'Platform', 'Members')
  const roleOf = (username: string) => page.getByRole('combobox', { name: `Role of ${username}` })

  // Step 1: as alice, add bob to Platform with the read role; read Platform's members.
  const form = page.getByRole('form', { name: 'Add a member' })
  await form.getByLabel('Username').fill('bob')
  await form.getByLabel('Role').selectOption({ label: 'Read-only' })
  await form.getByRole('button', { name: 'Add member' }).click()
  await expect(page.getByRole('status')).toHaveText('bob is now read-only in Platform.')
  await page.reload()
  await expect(roleOf('bob')).toHaveValue('read-only')
  await expect(roleOf('alice')).toHaveValue('admin')

  // Step 2: change bob's role to contributor; read it.
  await roleOf('bob').selectOption({ label: 'Contributor' })
  await expect(page.getByRole('status')).toHaveText('bob is now contributor in Platform.')
  await page.reload()
  await expect(roleOf('bob')).toHaveValue('contributor')
  await expect(roleOf('alice')).toHaveValue('admin')

  // Step 3: remove bob; read the members.
  await page.getByRole('button', { name: 'Remove bob' }).click()
  await expect(page.getByRole('status')).toHaveText('bob is no longer a member of Platform.')
  await page.reload()
  await expect(memberNames(page, 'Platform')).toHaveText(['alice(you)'])

  // Negative: alice stays the group's admin throughout.
  expect(await rolesIn(deployment, platform)).toEqual({ [alice.id]: 'admin' })
})

test('TC-186: a member leaves a group', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const platform = await seedGroup(deployment, alice, 'Platform', [[bob, 'read-only']])

  // Step 1: as bob, leave Platform.
  const page = await signedIn(browser, deployment.url, bob)
  await openGroup(page, 'Platform', 'Members')
  await expect(page.getByLabel('Role of bob')).toHaveText('Read-only')
  await page.getByRole('button', { name: 'Leave Platform' }).click()
  await expect(page.getByRole('status')).toContainText('You have left Platform.')

  // Step 2: read Platform's members: bob is not one, and can no longer read them.
  await page.reload()
  await expect(page.getByRole('alert')).toHaveText("Only the group's members can see its members")
  const alicePage = await signedIn(browser, deployment.url, alice)
  await openGroup(alicePage, 'Platform', 'Members')
  await expect(memberNames(alicePage, 'Platform')).toHaveText(['alice(you)'])

  // Negative: alice is still a member and admin.
  expect(await rolesIn(deployment, platform)).toEqual({ [alice.id]: 'admin' })
})

test("TC-232: a group's last admin cannot leave it", async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const platform = await seedGroup(deployment, alice, 'Platform', [[bob, 'read-write']])

  // Step 1: as alice, try to leave Platform; the screen says it is refused.
  const page = await signedIn(browser, deployment.url, alice)
  await openGroup(page, 'Platform', 'Members')
  await page.getByRole('button', { name: 'Leave Platform' }).click()
  await expect(page.getByRole('alert')).toHaveText("The group's last admin cannot leave it")

  // Step 2: read Platform's members, afresh: alice is still a member and admin.
  await page.reload()
  await expect(memberNames(page, 'Platform')).toHaveText(['alice(you)', 'bob'])
  await expect(page.getByRole('combobox', { name: 'Role of alice' })).toHaveValue('admin')

  // Negative: bob's role is unchanged: he is not made admin as a side effect.
  await expect(page.getByRole('combobox', { name: 'Role of bob' })).toHaveValue('read-write')
  expect(await rolesIn(deployment, platform)).toEqual({
    [alice.id]: 'admin',
    [bob.id]: 'read-write',
  })
})

test('TC-187: a system admin deletes a group', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  const platform = await seedGroup(deployment, alice, 'Platform')
  const apollo = await seedProject(deployment.db, alice, 'Apollo')
  await deployment.db.insert(groupProjects).values({ groupId: platform, projectId: apollo })

  // Step 1: as root, delete Platform, confirming it.
  const page = await signedIn(browser, deployment.url, deployment.root)
  await openGroups(page)
  await page.getByRole('button', { name: 'Delete Platform' }).click()
  await page.getByRole('button', { name: 'Delete Platform for good' }).click()
  await expect(page.getByRole('status')).toHaveText('Group Platform is deleted. Its projects stay.')

  // Step 2: list the groups and the projects, afresh.
  await page.reload()
  await expect(page.getByText('No groups yet.')).toBeVisible()
  expect(await deployment.db.select().from(groups)).toEqual([])

  // Negative: Apollo still exists, with alice as admin.
  const apolloRoles = await deployment.db
    .select()
    .from(projectMembers)
    .where(eq(projectMembers.projectId, apollo))
  expect(apolloRoles.map((m) => [m.accountId, m.role])).toEqual([[alice.id, 'admin']])
  const alicePage = await signedIn(browser, deployment.url, alice)
  await expect(navigation(alicePage).getByRole('link', { name: 'Apollo' })).toBeVisible()
})

test('TC-188: a group admin who is not a system admin cannot delete the group', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const platform = await seedGroup(deployment, alice, 'Platform')

  // Step 1: as alice, Platform's admin, the group list screen offers no delete action.
  const page = await signedIn(browser, deployment.url, alice)
  await openGroups(page)
  await expect(groupList(page).getByRole('rowheader')).toHaveText(['Platform'])
  await expect(page.getByRole('button', { name: /Delete/ })).toHaveCount(0)

  // Step 2: list the groups: Platform still exists with its members.
  await page.reload()
  await expect(groupList(page).getByRole('rowheader')).toHaveText(['Platform'])
  expect(await rolesIn(deployment, platform)).toEqual({ [alice.id]: 'admin' })
})
