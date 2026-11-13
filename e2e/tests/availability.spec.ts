import type { Page } from '@playwright/test'
import { eq } from 'drizzle-orm'
import {
  absences,
  accounts,
  companyHolidays,
  globalCalendar,
  personalHolidays,
} from '../../backend/src/db/schema.ts'
import { type Account, type Deployment, expect, test } from '../fixtures.ts'

// The availability screens in the browser: capacity and absences (SC-088), where a person sets
// their own capacity (FR-037) and records their own absences in whole days (FR-038), and the
// personal working calendar (SC-089), where a person enters holidays in their own calendar but
// sets no weekend of their own (FR-039); a system admin does both for anyone (FR-150). The REST
// API side of these test cases is in backend/test/integration/calendars.test.ts.

async function signIn(page: Page, account: Pick<Account, 'username' | 'password'>) {
  await page.goto('/sign-in')
  await page.getByLabel('Username').fill(account.username)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('navigation', { name: 'Navigation' })).toBeVisible()
}

/** Opens one of the signed-in person's own screens from the navigation. */
async function openOwn(page: Page, link: string, heading: string) {
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: link })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
}

/** Opens one of `username`'s screens from account administration. */
async function openOf(page: Page, link: string, username: string) {
  await page
    .getByRole('navigation', { name: 'Navigation' })
    .getByRole('link', { name: 'Accounts' })
    .click()
  await page.getByRole('link', { name: `${link} of ${username}` }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: `${link} of ${username}` }),
  ).toBeVisible()
}

async function setCapacity(page: Page, percent: number) {
  await page.getByLabel('Capacity (% of full time)').fill(String(percent))
  await page.getByRole('button', { name: 'Set capacity' }).click()
  await expect(page.getByRole('status')).toHaveText(`Capacity set to ${percent}%.`)
}

async function recordAbsence(page: Page, from: string, to: string) {
  const form = page.getByRole('form', { name: 'Record an absence' })
  await form.getByLabel('First day').fill(from)
  await form.getByLabel('Last day').fill(to)
  await form.getByRole('button', { name: 'Record absence' }).click()
  await expect(page.getByRole('status')).toHaveText(`Absence from ${from} to ${to} recorded.`)
}

async function addHoliday(page: Page, day: string) {
  await page.getByLabel('Holiday', { exact: true }).fill(day)
  await page.getByRole('button', { name: 'Add holiday' }).click()
  await expect(page.getByRole('status')).toHaveText(`Holiday on ${day} added.`)
}

/** The rows of the screen's table named `name`, without the heading row. */
function rowsOf(page: Page, name: string) {
  return page
    .getByRole('table', { name })
    .getByRole('row')
    .filter({ hasNot: page.getByRole('columnheader') })
}

async function capacityOf(deployment: Deployment, accountId: string) {
  const [row] = await deployment.db
    .select({ capacity: accounts.capacity })
    .from(accounts)
    .where(eq(accounts.id, accountId))
  return row?.capacity
}

async function absencesOf(deployment: Deployment, accountId: string) {
  return (
    await deployment.db
      .select({ from: absences.startsOn, to: absences.endsOn })
      .from(absences)
      .where(eq(absences.accountId, accountId))
  ).toSorted((a, b) => a.from.localeCompare(b.from))
}

async function holidaysOf(deployment: Deployment, accountId: string) {
  return (
    await deployment.db
      .select({ date: personalHolidays.date })
      .from(personalHolidays)
      .where(eq(personalHolidays.accountId, accountId))
  )
    .map((row) => row.date)
    .toSorted()
}

/** Every day from `from` to `to`, both included, that is not a Saturday or a Sunday. */
function workingDays(from: string, to: string): string[] {
  const days: string[] = []
  for (let day = new Date(`${from}T00:00:00Z`); day <= new Date(`${to}T00:00:00Z`);) {
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) days.push(day.toISOString().slice(0, 10))
    day = new Date(day.getTime() + 24 * 60 * 60 * 1000)
  }
  return days
}

test('TC-049: a person records their own capacity (browser)', async ({ deployment, page }) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  // A witness whose capacity is not the default, so that a change to it would show.
  await deployment.db.update(accounts).set({ capacity: 70 }).where(eq(accounts.id, bob.id))

  // Step 1: as alice, set her own capacity to 80% on her capacity and absences screen.
  await signIn(page, alice)
  await openOwn(page, 'Capacity and absences', 'Your capacity and absences')
  await expect(page.getByTestId('capacity')).toHaveText('Capacity: 100% of full time.')
  await setCapacity(page, 80)

  // Step 2: read alice's capacity back, afresh.
  await page.reload()
  await expect(page.getByTestId('capacity')).toHaveText('Capacity: 80% of full time.')
  expect(await capacityOf(deployment, alice.id)).toBe(80)

  // Negative: no other person's capacity changes.
  expect(await capacityOf(deployment, bob.id)).toBe(70)
  expect(await capacityOf(deployment, deployment.root.id)).toBe(100)
})

test('TC-050: a person records their own absence in whole days (browser)', async ({
  deployment,
  page,
}) => {
  const alice = await deployment.seedAccount('alice')
  await deployment.seedAccount('bob')

  // Step 1: as alice, record her vacation from 2027-03-08 to 2027-03-12.
  await signIn(page, alice)
  await openOwn(page, 'Capacity and absences', 'Your capacity and absences')
  const form = page.getByRole('form', { name: 'Record an absence' })
  // Negative: the screen offers no part-day unit; an absence is a first and a last whole day.
  await expect(form.getByRole('textbox')).toHaveCount(0)
  await expect(form.locator('input')).toHaveCount(2)
  await expect(form.getByLabel('First day')).toHaveAttribute('type', 'date')
  await expect(form.getByLabel('Last day')).toHaveAttribute('type', 'date')
  await expect(form.getByRole('combobox')).toHaveCount(0)
  await expect(form.getByRole('checkbox')).toHaveCount(0)
  await recordAbsence(page, '2027-03-08', '2027-03-12')

  // Step 2: read alice's absences back, afresh.
  await page.reload()
  await expect(rowsOf(page, 'Absences')).toHaveText([/Mon 2027-03-08\s*Fri 2027-03-12/])
  expect(await absencesOf(deployment, alice.id)).toEqual([{ from: '2027-03-08', to: '2027-03-12' }])

  // Negative: no other person's absences change.
  expect(await deployment.db.select().from(absences)).toHaveLength(1)
})

test('TC-051: a person enters many holidays in their own calendar (browser)', async ({
  deployment,
  page,
}) => {
  const alice = await deployment.seedAccount('alice')
  const bob = await deployment.seedAccount('bob')
  const holidays = workingDays('2027-03-01', '2027-04-09')
  expect(holidays).toHaveLength(30)

  // Step 1: as alice, enter the 30 holidays in her own calendar.
  await signIn(page, alice)
  await openOwn(page, 'Working calendar', 'Your working calendar')
  // Negative: no entry is refused for exceeding a limit (each is confirmed as added).
  for (const day of holidays) await addHoliday(page, day)

  // Step 2: read alice's calendar, afresh, and bob's.
  await page.reload()
  await expect(rowsOf(page, 'Holidays')).toHaveText(holidays.map((day) => new RegExp(day)))
  expect(await holidaysOf(deployment, alice.id)).toEqual(holidays)
  // Negative: bob's calendar holds none of them, and the global calendar is unchanged.
  expect(await holidaysOf(deployment, bob.id)).toEqual([])
  expect(await deployment.db.select().from(companyHolidays)).toEqual([])
  expect(await deployment.db.select().from(globalCalendar)).toEqual([])
})

test('TC-052: a person cannot set a weekend of their own (browser)', async ({
  deployment,
  page,
}) => {
  const alice = await deployment.seedAccount('alice')
  // The global calendar's weekend is Saturday and Sunday: the fresh deployment's default.

  // Step 1: as alice, look for a weekend setting in her own calendar.
  await signIn(page, alice)
  await openOwn(page, 'Working calendar', 'Your working calendar')
  await expect(page.getByTestId('weekend')).toHaveText(
    'The weekend is Saturday and Sunday, as the global calendar sets it for everyone; it cannot be changed here.',
  )
  // No weekend setting is offered: the one field is the date of a holiday to add.
  const main = page.getByRole('main')
  await expect(main.locator('input, select, textarea')).toHaveCount(1)
  await expect(main.getByLabel('Holiday', { exact: true })).toHaveAttribute('type', 'date')
  await expect(main.getByLabel(/weekend/i)).toHaveCount(0)
  await expect(main.getByRole('checkbox')).toHaveCount(0)
  await expect(main.getByRole('combobox')).toHaveCount(0)
  await expect(main.getByRole('button')).toHaveText(['Add holiday'])

  // Step 2, sending the change through the REST API, is tested in
  // backend/test/integration/calendars.test.ts.

  // Negative: alice's calendar marks no day at all, so no Friday, and the global calendar's
  // weekend is still the default Saturday and Sunday.
  expect(await holidaysOf(deployment, alice.id)).toEqual([])
  expect(await deployment.db.select().from(globalCalendar)).toEqual([])
})

test("TC-222: a system admin changes another person's capacity, absences and calendar (browser)", async ({
  deployment,
  page,
}) => {
  const alice = await deployment.seedAccount('alice')

  // Step 1: as root, make each change on alice's screens, from account administration.
  await signIn(page, deployment.root)
  await openOf(page, 'Capacity and absences', 'alice')
  await setCapacity(page, 60)
  await recordAbsence(page, '2027-03-08', '2027-03-08')
  await openOf(page, 'Working calendar', 'alice')
  await addHoliday(page, '2027-03-15')

  // Step 2: as alice, read her capacity, absences and calendar.
  await page.evaluate(async () => {
    await fetch('/api/session', { method: 'DELETE' })
  })
  await signIn(page, alice)
  await openOwn(page, 'Capacity and absences', 'Your capacity and absences')
  await expect(page.getByTestId('capacity')).toHaveText('Capacity: 60% of full time.')
  await expect(rowsOf(page, 'Absences')).toHaveText([/Mon 2027-03-08\s*Mon 2027-03-08/])
  await openOwn(page, 'Working calendar', 'Your working calendar')
  await expect(rowsOf(page, 'Holidays')).toHaveText([/Mon 2027-03-15/])

  // Negative: root's own capacity, absences and calendar are unchanged.
  expect(await capacityOf(deployment, deployment.root.id)).toBe(100)
  expect(await absencesOf(deployment, deployment.root.id)).toEqual([])
  expect(await holidaysOf(deployment, deployment.root.id)).toEqual([])
})
