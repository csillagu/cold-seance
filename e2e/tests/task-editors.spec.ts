import type { Browser, Locator, Page } from '@playwright/test'
import { type Account, type Deployment, expect, test } from '../fixtures.ts'

// The eligibility expression editor (SC-099) and the assignment editor (SC-100), on a task's page:
// the browser steps of the test cases they make pass, in full or in part. The inputs are put in
// place through the REST API, in the browser's own session, until the screen that creates tasks is
// built (task creation, F12); the changes the test cases make are made in the editors. The REST
// sides of these test cases are in backend/test/integration/assignment.test.ts and
// person-load.test.ts.
//
// Pending: TC-221 starts "creating a task" in the browser; no screen creates tasks yet (SC-098,
// F12). Here 1% is offered where an existing task's AI share is set to 100% on the Kanban, with
// the same field (PersonLoadField) the creation screen is to use.

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

function idOf(created: unknown): string {
  if (typeof created !== 'object' || created === null || !('id' in created)) {
    throw new Error('The answer holds no id')
  }
  return String(created.id)
}

/** Reads a task through the REST API. */
async function readTask(page: Page, task: string): Promise<Record<string, unknown>> {
  const read = await call(page, 'GET', `/tasks/${task}`)
  if (typeof read !== 'object' || read === null) throw new Error('The answer is not a task')
  return { ...read }
}

/**
 * The deployment of most of these test cases: accounts `alice` and those in `others`, project
 * `Apollo` created by `alice`, where each of the others has the read-only role. Gives alice's page.
 */
async function apolloWith(browser: Browser, deployment: Deployment, others: string[]) {
  const alice = await deployment.seedAccount('alice')
  const people: Record<string, Account> = { alice }
  for (const name of others) people[name] = await deployment.seedAccount(name)
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = idOf(await call(page, 'POST', '/projects', { name: 'Apollo' }))
  for (const name of others) {
    await call(page, 'PUT', `/projects/${apollo}/members/${people[name]!.id}`, {
      role: 'read-only',
    })
  }
  const id = (name: string) => people[name]!.id
  const createTask = async (fields: Record<string, unknown>) =>
    idOf(await call(page, 'POST', `/projects/${apollo}/tasks`, fields))
  return { page, apollo, id, createTask }
}

/** Opens the page of the task `task`, and waits for its editors. */
async function openTask(page: Page, task: string, title: string) {
  await page.goto(`/tasks/${task}`)
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
}

const eligibility = (page: Page) => page.getByRole('group', { name: 'Eligibility' })
const assigned = (page: Page) => page.getByRole('group', { name: 'Assigned people' })
const person = (editor: Locator, name: string) =>
  editor.getByRole('listitem', { name, exact: true })

test('TC-038: two-level AND/OR eligibility expressions are stored as given', async ({
  browser,
  deployment,
}) => {
  const { page, id, createTask } = await apolloWith(browser, deployment, ['bob', 'carol', 'dave'])
  const t1 = await createTask({ title: 'T1' })
  const t2 = await createTask({ title: 'T2' })

  // Step 1, T1: alice AND (bob OR carol OR dave), built in the editor and saved.
  await openTask(page, t1, 'T1')
  const e1 = eligibility(page)
  await e1.getByLabel('Top level', { exact: true }).selectOption('All of (AND)')
  await e1.getByLabel('Add a person to the top level').selectOption('alice')
  await e1.getByRole('button', { name: 'Add a group' }).click()
  for (const name of ['bob', 'carol', 'dave']) {
    await e1.getByLabel('Add a person to group 1').selectOption(name)
  }
  await expect(e1.getByRole('status', { name: 'Expression' })).toHaveText(
    'alice AND (bob OR carol OR dave)',
  )
  await page.getByRole('button', { name: 'Save eligibility' }).click()
  await expect.poll(async () => (await readTask(page, t1))['eligibility']).not.toBeNull()
  await expect(page.getByRole('alert')).toHaveCount(0)

  // T2: (alice AND bob) OR carol.
  await openTask(page, t2, 'T2')
  const e2 = eligibility(page)
  await e2.getByRole('button', { name: 'Add a group' }).click()
  await e2.getByRole('combobox', { name: 'Group 1', exact: true }).selectOption('All of (AND)')
  await e2.getByLabel('Add a person to group 1').selectOption('alice')
  await e2.getByLabel('Add a person to group 1').selectOption('bob')
  await e2.getByLabel('Add a person to the top level').selectOption('carol')
  await expect(e2.getByRole('status', { name: 'Expression' })).toHaveText(
    '(alice AND bob) OR carol',
  )
  await page.getByRole('button', { name: 'Save eligibility' }).click()

  // Step 2: both read back as given, not flattened or regrouped, and with no one assigned.
  await expect
    .poll(async () => (await readTask(page, t2))['eligibility'])
    .toEqual({ any: [{ all: [id('alice'), id('bob')] }, id('carol')] })
  const read1 = await readTask(page, t1)
  expect(read1['eligibility']).toEqual({
    all: [id('alice'), { any: [id('bob'), id('carol'), id('dave')] }],
  })
  expect(read1['assignees']).toEqual([])
  expect((await readTask(page, t2))['assignees']).toEqual([])

  // The page shows them back as they were built.
  await openTask(page, t1, 'T1')
  await expect(eligibility(page).getByRole('status', { name: 'Expression' })).toHaveText(
    'alice AND (bob OR carol OR dave)',
  )

  await page.context().close()
})

test('TC-272: an eligibility expression three levels deep cannot be built', async ({
  browser,
  deployment,
}) => {
  const { page, id, createTask } = await apolloWith(browser, deployment, ['bob', 'carol', 'dave'])
  const t = await createTask({ title: 'T', eligibility: { any: [id('alice'), id('bob')] } })

  // The change would be alice AND (bob OR (carol AND dave)): a group in a group. The editor builds
  // alice AND (bob OR …) but offers no group inside the group, only people.
  await openTask(page, t, 'T')
  const editor = eligibility(page)
  await editor.getByLabel('Top level', { exact: true }).selectOption('All of (AND)')
  await person(editor, 'bob').getByRole('button', { name: 'Remove bob' }).click()
  await editor.getByRole('button', { name: 'Add a group' }).click()
  const group = editor.getByRole('listitem', { name: 'Group 1' })
  await group.getByLabel('Add a person to group 1').selectOption('bob')
  await expect(group.getByRole('button', { name: /add a group/i })).toHaveCount(0)
  await expect(group.getByRole('combobox', { name: 'Add a person to group 1' })).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Add a group' })).toHaveCount(1)

  // Nothing was saved: T's eligibility is still alice OR bob.
  expect((await readTask(page, t))['eligibility']).toEqual({ any: [id('alice'), id('bob')] })

  await page.context().close()
})

test('TC-274: people on a task who cannot read its project are marked', async ({
  browser,
  deployment,
}) => {
  const { page, apollo, id, createTask } = await apolloWith(browser, deployment, ['bob', 'carol'])
  const t = await createTask({
    title: 'T',
    eligibility: { any: [id('alice'), id('bob'), id('carol')] },
    assignees: [id('bob'), id('carol')],
  })

  // Step 1: no one in T's eligibility or assignment is marked.
  await openTask(page, t, 'T')
  for (const editor of [eligibility(page), assigned(page)]) {
    await expect(editor.getByText('Cannot read Apollo')).toHaveCount(0)
  }

  // Step 2: alice removes bob's role in Apollo.
  await call(page, 'DELETE', `/projects/${apollo}/members/${id('bob')}`)

  // Step 3: bob is marked, in the eligibility and in the assigned people; alice and carol are not.
  await openTask(page, t, 'T')
  for (const editor of [eligibility(page), assigned(page)]) {
    await expect(person(editor, 'bob')).toContainText('Cannot read Apollo')
    await expect(person(editor, 'carol')).not.toContainText('Cannot read')
    await expect(editor.getByText('Cannot read Apollo')).toHaveCount(1)
  }
  await expect(person(eligibility(page), 'alice')).not.toContainText('Cannot read')

  // Negative: bob is not removed from T's eligibility or assignment.
  const read = await readTask(page, t)
  expect(read['eligibility']).toEqual({ any: [id('alice'), id('bob'), id('carol')] })
  expect(read['assignees']).toEqual([id('bob'), id('carol')])

  await page.context().close()
})

test('TC-039: assignment is stored as a list separate from eligibility', async ({
  browser,
  deployment,
}) => {
  const { page, id, createTask } = await apolloWith(browser, deployment, ['bob'])
  const t = await createTask({
    title: 'T',
    eligibility: { any: [id('alice'), id('bob')] },
    assignees: [id('bob')],
  })

  // Step 2: set T's assigned people to [alice], in the assignment editor.
  await openTask(page, t, 'T')
  await expect(eligibility(page).getByRole('status', { name: 'Expression' })).toHaveText(
    'alice OR bob',
  )
  const editor = assigned(page)
  await person(editor, 'bob').getByRole('button', { name: 'Remove bob' }).click()
  await editor.getByLabel('Assign a person').selectOption('alice')
  await page.getByRole('button', { name: 'Save assignment' }).click()
  await expect(person(assigned(page), 'alice')).toBeVisible()

  // Eligibility alice OR bob, assigned people [alice]: the assignment did not change it.
  const read = await readTask(page, t)
  expect(read['assignees']).toEqual([id('alice')])
  expect(read['eligibility']).toEqual({ any: [id('alice'), id('bob')] })
  await expect(eligibility(page).getByRole('status', { name: 'Expression' })).toHaveText(
    'alice OR bob',
  )

  await page.context().close()
})

test('TC-040: an assignment outside the eligibility is accepted without a warning', async ({
  browser,
  deployment,
}) => {
  const { page, id, createTask } = await apolloWith(browser, deployment, ['bob', 'carol'])
  const t = await createTask({ title: 'T', eligibility: { any: [id('alice'), id('bob')] } })
  let dialogs = 0
  page.on('dialog', (dialog) => {
    dialogs += 1
    void dialog.dismiss()
  })

  // Step 1: set T's assigned people to [carol], and save.
  await openTask(page, t, 'T')
  await assigned(page).getByLabel('Assign a person').selectOption('carol')
  await page.getByRole('button', { name: 'Save assignment' }).click()

  // The save succeeds, with no warning, confirmation or error.
  await expect(person(assigned(page), 'carol')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(dialogs).toBe(0)

  // Step 2: assigned people [carol]; eligibility still alice OR bob.
  const read = await readTask(page, t)
  expect(read['assignees']).toEqual([id('carol')])
  expect(read['eligibility']).toEqual({ any: [id('alice'), id('bob')] })
  // No notification is raised about it.
  expect(await call(page, 'GET', '/notifications')).toEqual([])

  await page.context().close()
})

test("TC-045: one assignment's load override replaces the task default for that person only", async ({
  browser,
  deployment,
}) => {
  const { page, id, createTask } = await apolloWith(browser, deployment, ['bob'])
  const t = await createTask({
    title: 'T',
    aiShare: 0,
    assignees: [id('alice'), id('bob')],
    plannedStart: '2027-03-01',
    durationWorkingDays: 10,
  })

  // Step 1: override alice's assignment on T to 30%.
  await openTask(page, t, 'T')
  const editor = assigned(page)
  await expect(editor.getByLabel('Load of bob in percent')).toHaveAttribute('placeholder', '100')
  await editor.getByLabel('Load of alice in percent').fill('30')
  await page.getByRole('button', { name: 'Save assignment' }).click()
  await expect
    .poll(async () => (await readTask(page, t))['loadOverrides'])
    .toEqual({ [id('alice')]: 30 })

  // Step 2: alice's load on 2027-03-01 is 30%, bob's 100%.
  const loadOn = async (name: string) => {
    const read = await call(page, 'GET', `/accounts/${id(name)}/load?from=2027-03-01&to=2027-03-01`)
    // The whole load of each day, as the answer gives it.
    if (typeof read !== 'object' || read === null || !('days' in read)) return []
    const days: unknown = read.days
    if (!Array.isArray(days)) return []
    return days.map((day: unknown) =>
      typeof day === 'object' && day !== null && 'load' in day ? day.load : undefined,
    )
  }
  expect(await loadOn('alice')).toEqual([30])
  expect(await loadOn('bob')).toEqual([100])

  // Negative: T's own person load is still 100%, its AI share still 0%.
  const read = await readTask(page, t)
  expect(read['personLoad']).toBe(100)
  expect(read['aiShare']).toBe(0)

  await page.context().close()
})

test('TC-220: an AI-only task accepts a load of 0%, a fraction or over 100%', async ({
  browser,
  deployment,
}) => {
  const { page, id, createTask } = await apolloWith(browser, deployment, [])
  const t = await createTask({ title: 'T', aiShare: 100, assignees: [id('alice')] })

  // Step 1: set each value in the browser, reading T back after each.
  await openTask(page, t, 'T')
  for (const value of [0, 0.5, 150]) {
    await openTask(page, t, 'T')
    await page.getByLabel('Person load in percent').fill(String(value))
    await page.getByRole('button', { name: 'Save assignment' }).click()
    await expect.poll(async () => (await readTask(page, t))['personLoad']).toBe(value)
  }
  // The page shows the last back as it was read.
  await openTask(page, t, 'T')
  await expect(page.getByLabel('Person load in percent')).toHaveValue('150')

  await page.context().close()
})

test("TC-221: the UI offers 1% as an AI-only task's default load", async ({
  browser,
  deployment,
}) => {
  const { page, createTask } = await apolloWith(browser, deployment, [])
  const t = await createTask({ title: 'T' })

  // Step 1: set the task's AI share to 100%, on its Kanban card (see the note at the top).
  await page.goto('/')
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Apollo' })
    .click()
  await page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('link', { name: 'Kanban' })
    .click()
  await page.getByRole('button', { name: 'Edit T' }).click()
  await page.getByLabel('AI share in percent').fill('100')

  // Step 2: the person-load field, before typing in it, offers 1%; not 0% or 100%.
  const load = page.getByLabel('Person load in percent')
  await expect(load).toHaveValue('1')

  // Saved as offered.
  await page.getByRole('button', { name: 'Save' }).click()
  await expect.poll(async () => (await readTask(page, t))['personLoad']).toBe(1)

  await page.context().close()
})

test('TC-275: a person cannot be chosen twice in an assignment', async ({
  browser,
  deployment,
}) => {
  const { page, id, createTask } = await apolloWith(browser, deployment, ['bob'])
  const t = await createTask({ title: 'T', assignees: [id('alice')] })

  // The change [bob, alice, bob] cannot be built: someone on the list is not offered again.
  await openTask(page, t, 'T')
  const add = assigned(page).getByLabel('Assign a person')
  await expect(add.getByRole('option')).toHaveText(['Add a person…', 'bob'])
  await add.selectOption('bob')
  // Everyone is now assigned, so no one is left to offer.
  await expect(assigned(page).getByLabel('Assign a person')).toHaveCount(0)
  await expect(assigned(page).getByRole('listitem')).toHaveCount(2)

  // Nothing was saved: T's assigned people are still [alice].
  expect((await readTask(page, t))['assignees']).toEqual([id('alice')])

  await page.context().close()
})
