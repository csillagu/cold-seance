import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type SignedInAccount, SignedInContext } from '../signed-in.ts'
import { type FakeAnswer, type FakeRequest, fakeApi } from '../test/fetch.ts'
import { CompanyCalendarPage } from './CompanyCalendarPage.tsx'

const ROOT = { id: '6f1c2a5e-0000-4000-8000-000000000001', username: 'root', systemAdmin: true }
const ALICE = { id: '6f1c2a5e-0000-4000-8000-000000000002', username: 'alice', systemAdmin: false }

function renderAs(signedIn: SignedInAccount) {
  render(
    <SignedInContext value={signedIn}>
      <MemoryRouter initialEntries={['/company-calendar']}>
        <Routes>
          <Route path="/company-calendar" element={<CompanyCalendarPage />} />
        </Routes>
      </MemoryRouter>
    </SignedInContext>,
  )
}

/**
 * Fakes the API with a global calendar of a Saturday and Sunday weekend and one company holiday,
 * which a PATCH changes as it asks, and `answer` in front of it for anything a test wants
 * answered otherwise.
 */
function fakeCalendar(answer?: (method: string, path: string) => FakeAnswer | undefined) {
  let calendar = { weekendDays: ['saturday', 'sunday'], holidays: ['2027-01-04'] }
  const requests: FakeRequest[] = fakeApi((method, path) => {
    const given = answer?.(method, path)
    if (given !== undefined) return given
    if (path !== '/api/calendar') {
      return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such' } }
    }
    if (method === 'PATCH') {
      const body = (requests.at(-1)?.body ?? {}) as {
        weekendDays?: string[]
        addHolidays?: string[]
        removeHolidays?: string[]
      }
      calendar = {
        weekendDays: body.weekendDays ?? calendar.weekendDays,
        holidays: [...calendar.holidays, ...(body.addHolidays ?? [])]
          .filter((day) => !(body.removeHolidays ?? []).includes(day))
          .toSorted(),
      }
    }
    return { status: 200, body: calendar }
  })
  return requests
}

function holidayRows() {
  return within(screen.getByRole('table', { name: 'Company holidays' }))
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.textContent)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the company calendar screen (SC-090)', () => {
  it('shows the global calendar, its weekend and its company holidays (FR-040)', async () => {
    fakeCalendar()
    renderAs(ALICE)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Company calendar' }),
    ).toBeInTheDocument()
    expect(await screen.findByTestId('weekend')).toHaveTextContent(
      'The weekend is Saturday and Sunday, for everyone.',
    )
    expect(holidayRows()).toEqual(['Mon 4 Jan 2027'])
  })

  it('offers no change to anyone but a system admin (FR-041)', async () => {
    const requests = fakeCalendar()
    renderAs(ALICE)
    expect(await screen.findByTestId('admins-only')).toHaveTextContent(
      'Only system admins can change the company holidays and the weekend days.',
    )
    expect(document.querySelectorAll('input, select, textarea')).toHaveLength(0)
    expect(screen.queryByRole('button')).toBeNull()
    expect(requests.filter((r) => r.method !== 'GET')).toEqual([])
  })

  it('lets a system admin add and remove company holidays (FR-041)', async () => {
    const requests = fakeCalendar()
    renderAs(ROOT)
    fireEvent.change(await screen.findByLabelText('Company holiday'), {
      target: { value: '2027-03-03' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add holiday' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Company holiday on 2027-03-03 added.',
    )
    expect(holidayRows()).toEqual(['Mon 4 Jan 2027Remove', 'Wed 3 Mar 2027Remove'])

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove the company holiday on 2027-01-04' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Company holiday on 2027-01-04 removed.',
    )
    expect(holidayRows()).toEqual(['Wed 3 Mar 2027Remove'])
    expect(requests.filter((r) => r.method === 'PATCH')).toEqual([
      { method: 'PATCH', path: '/api/calendar', body: { addHolidays: ['2027-03-03'] } },
      { method: 'PATCH', path: '/api/calendar', body: { removeHolidays: ['2027-01-04'] } },
    ])
  })

  it('lets a system admin choose the weekend days, sent Monday first (FR-131)', async () => {
    const requests = fakeCalendar()
    renderAs(ROOT)
    const days = within(await screen.findByRole('form', { name: 'Weekend days' }))
    expect(days.getAllByRole('checkbox').map((box) => box.parentElement?.textContent)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ])
    fireEvent.click(days.getByLabelText('Sunday'))
    fireEvent.click(days.getByLabelText('Friday'))
    fireEvent.click(screen.getByRole('button', { name: 'Set weekend days' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Weekend set to Friday and Saturday.',
    )
    expect(screen.getByTestId('weekend')).toHaveTextContent(
      'The weekend is Friday and Saturday, for everyone.',
    )
    expect(requests.filter((r) => r.method === 'PATCH')).toEqual([
      { method: 'PATCH', path: '/api/calendar', body: { weekendDays: ['friday', 'saturday'] } },
    ])
  })

  it("shows the API's refusal of a change", async () => {
    fakeCalendar((method) =>
      method === 'PATCH'
        ? {
            status: 400,
            body: { statusCode: 400, error: 'Bad Request', message: 'Not all seven days' },
          }
        : undefined,
    )
    renderAs(ROOT)
    fireEvent.click(await screen.findByRole('button', { name: 'Set weekend days' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not all seven days')
  })

  it('says when the calendar could not be loaded', async () => {
    fakeCalendar(() => ({ status: 500, body: { statusCode: 500, error: 'x', message: 'x' } }))
    renderAs(ALICE)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The company calendar could not be loaded.',
    )
  })
})
