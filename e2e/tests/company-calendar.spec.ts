import type { Browser, Page } from '@playwright/test'
import { auditLog, companyHolidays, personalHolidays } from '../../backend/src/db/schema.ts'
import { type Account, type Deployment, expect, test } from '../fixtures.ts'

// The company calendar screen (SC-090): the one global calendar, the same for everyone (FR-040),
// whose company holidays (FR-041) and weekend days (FR-131) a system admin sets, and no one else.
// The REST API side of these test cases is in backend/test/integration/calendars.test.ts.

/** A browser of its own for `account`, signed in on the sign-in page. */
async function signedIn(browser: Browser, baseURL: string, account: Account): Promise<Page> {
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()
  await page.goto('/sign-in')
  await page.getByLabel('Username').fill(account.username)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('navigation', { name: 'Navigation' })).toBeVisible()
  return page
}

/** Opens the company calendar from the navigation. */
async function openCompanyCalendar(page: Page) {
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Company calendar' })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: 'Company calendar' })).toBeVisible()
}

async function addCompanyHoliday(page: Page, day: string) {
  await page.getByLabel('Company holiday', { exact: true }).fill(day)
  await page.getByRole('button', { name: 'Add holiday' }).click()
  await expect(page.getByRole('status')).toHaveText(`Company holiday on ${day} added.`)
}

/** Ticks exactly the weekend days `days` on the screen and sets them. */
async function setWeekend(page: Page, days: string[], inWords: string) {
  const form = page.getByRole('form', { name: 'Weekend days' })
  for (const day of [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ]) {
    await form.getByLabel(day, { exact: true }).setChecked(days.includes(day))
  }
  await form.getByRole('button', { name: 'Set weekend days' }).click()
  await expect(page.getByRole('status')).toHaveText(`Weekend set to ${inWords}.`)
}

/** The rows of the company holidays table, without the heading row. */
function holidayRows(page: Page) {
  return page
    .getByRole('table', { name: 'Company holidays' })
    .getByRole('row')
    .filter({ hasNot: page.getByRole('columnheader') })
}

async function companyHolidaysOf(deployment: Deployment) {
  return (await deployment.db.select({ date: companyHolidays.date }).from(companyHolidays))
    .map((row) => row.date)
    .toSorted()
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
  const parsed: unknown = JSON.parse(answer.text)
  return parsed
}

/** The id of what the REST API created, from its answer. */
function idOf(created: unknown): string {
  if (typeof created !== 'object' || created === null || !('id' in created)) {
    throw new Error('The answer holds no id')
  }
  return String(created.id)
}

test('TC-053: one global calendar holds the company holidays and the weekend (browser)', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')

  // Step 1: as root, set the weekend to Saturday and Sunday and add a company holiday on
  // 2027-03-03, on the company calendar screen.
  const root = await signedIn(browser, deployment.url, deployment.root)
  await openCompanyCalendar(root)
  await setWeekend(root, ['Saturday', 'Sunday'], 'Saturday and Sunday')
  await addCompanyHoliday(root, '2027-03-03')

  // Step 2: read the global calendar on the screen as alice, then as bob: the same calendar.
  for (const account of [alice, bob]) {
    const page = await signedIn(browser, deployment.url, account)
    await openCompanyCalendar(page)
    await expect(page.getByTestId('weekend')).toHaveText(
      'The weekend is Saturday and Sunday, for everyone.',
    )
    // Negative: there is no second calendar: the one holiday is the one root added.
    await expect(holidayRows(page)).toHaveText(['Wed 3 Mar 2027'])
  }
})

test('TC-054: a system admin adds a company holiday (browser)', async ({ browser, deployment }) => {
  const alice = await deployment.seedAccount('alice')
  // A witness with a holiday of her own, so that a change to a person's calendar would show.
  await deployment.db.insert(personalHolidays).values({ accountId: alice.id, date: '2027-03-03' })

  const page = await signedIn(browser, deployment.url, deployment.root)
  await openCompanyCalendar(page)
  await expect(page.getByText('No company holidays.')).toBeVisible()

  // Step 1: as root, add the holiday and read the global calendar, afresh.
  await addCompanyHoliday(page, '2027-03-03')
  await page.reload()
  await expect(holidayRows(page)).toHaveText([/Wed 3 Mar 2027/])
  expect(await companyHolidaysOf(deployment)).toEqual(['2027-03-03'])

  // Step 2: as root, remove it and read the global calendar, afresh.
  await page.getByRole('button', { name: 'Remove the company holiday on 2027-03-03' }).click()
  await expect(page.getByRole('status')).toHaveText('Company holiday on 2027-03-03 removed.')
  await page.reload()
  await expect(page.getByText('No company holidays.')).toBeVisible()
  expect(await companyHolidaysOf(deployment)).toEqual([])

  // Negative: no person's own calendar changes.
  expect(await deployment.db.select().from(personalHolidays)).toEqual([
    { accountId: alice.id, date: '2027-03-03' },
  ])
})

test("TC-055: a non-admin's change to the company holidays is rejected (browser)", async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')
  const page = await signedIn(browser, deployment.url, alice)
  await call(page, 'POST', '/projects', { name: 'Apollo' })

  // Step 1: as alice, a project admin but not a system admin, look for a way to add the holiday:
  // the screen offers none, and says only system admins can change the calendar.
  await openCompanyCalendar(page)
  await expect(page.getByTestId('admins-only')).toHaveText(
    'Only system admins can change the company holidays and the weekend days.',
  )
  const main = page.getByRole('main')
  await expect(main.locator('input, select, textarea')).toHaveCount(0)
  await expect(main.getByRole('button')).toHaveCount(0)
  // Sending the change through the REST API, and its rejection, is tested in
  // backend/test/integration/calendars.test.ts.

  // Step 2: the global calendar holds no company holidays.
  await expect(page.getByText('No company holidays.')).toBeVisible()
  expect(await companyHolidaysOf(deployment)).toEqual([])

  // Negative: no audit log entry records a change to the global calendar.
  const entries = await deployment.db.select().from(auditLog)
  expect(entries.filter((entry) => entry.subjectType === 'global-calendar')).toEqual([])
})

test('TC-194: the weekend days set in the global calendar drive scheduling (browser)', async ({
  browser,
  deployment,
}) => {
  const alice = await deployment.seedAccount('alice')

  // Step 1: as root, set the weekend to Friday and Saturday on the company calendar screen.
  const root = await signedIn(browser, deployment.url, deployment.root)
  await openCompanyCalendar(root)
  await setWeekend(root, ['Friday', 'Saturday'], 'Friday and Saturday')
  await root.reload()
  await expect(root.getByTestId('weekend')).toHaveText(
    'The weekend is Friday and Saturday, for everyone.',
  )

  // Step 2: as alice, create A and B in Apollo, B blocked by A, then read them. They are put in
  // place through the REST API, in her browser's session: the task screens are not this SC's.
  const page = await signedIn(browser, deployment.url, alice)
  const apollo = idOf(await call(page, 'POST', '/projects', { name: 'Apollo' }))
  const a = idOf(
    await call(page, 'POST', `/projects/${apollo}/tasks`, {
      title: 'A',
      plannedStart: '2027-03-03',
      durationWorkingDays: 2,
    }),
  )
  const b = idOf(
    await call(page, 'POST', `/projects/${apollo}/tasks`, {
      title: 'B',
      durationWorkingDays: 1,
    }),
  )
  await call(page, 'POST', `/tasks/${b}/blocked-by`, { blockerId: a })

  expect(await call(page, 'GET', `/tasks/${a}`)).toMatchObject({
    plannedStart: '2027-03-03',
    plannedFinish: '2027-03-04',
  })
  // B is on Sunday 2027-03-07: no work falls on Friday 2027-03-05 or Saturday 2027-03-06.
  expect(await call(page, 'GET', `/tasks/${b}`)).toMatchObject({
    plannedStart: '2027-03-07',
    plannedFinish: '2027-03-07',
  })
})
