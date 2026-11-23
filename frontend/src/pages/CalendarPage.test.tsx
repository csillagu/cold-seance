import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type SignedInAccount, SignedInContext } from '../signed-in.ts'
import { type FakeAnswer, type FakeRequest, fakeApi } from '../test/fetch.ts'
import { CalendarPage } from './CalendarPage.tsx'

const ROOT = { id: '6f1c2a5e-0000-4000-8000-000000000001', username: 'root', systemAdmin: true }
const ALICE = { id: '6f1c2a5e-0000-4000-8000-000000000002', username: 'alice', systemAdmin: false }

function renderAt(path: string, signedIn: SignedInAccount) {
  render(
    <SignedInContext value={signedIn}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings/calendar" element={<CalendarPage />} />
          <Route path="/accounts/:accountId/calendar" element={<CalendarPage />} />
        </Routes>
      </MemoryRouter>
    </SignedInContext>,
  )
}

/**
 * Fakes the API with one holiday in each person's calendar, which a PATCH changes as it asks, and
 * `answer` in front of it for anything a test wants answered otherwise.
 */
function fakeCalendars(answer?: (method: string, path: string) => FakeAnswer | undefined) {
  let holidays = ['2027-01-04']
  const requests: FakeRequest[] = fakeApi((method, path) => {
    const given = answer?.(method, path)
    if (given !== undefined) return given
    if (method === 'GET' && path === '/api/accounts') return { status: 200, body: [ALICE, ROOT] }
    if (method === 'GET' && path === '/api/calendar')
      return { status: 200, body: { weekendDays: ['saturday', 'sunday'], holidays: [] } }
    const id = /^\/api\/accounts\/([^/]+)\/calendar$/.exec(path)?.[1]
    if (id !== undefined && method === 'PATCH') {
      const body = (requests.at(-1)?.body ?? {}) as {
        addHolidays?: string[]
        removeHolidays?: string[]
      }
      holidays = [...holidays, ...(body.addHolidays ?? [])]
        .filter((day) => !(body.removeHolidays ?? []).includes(day))
        .toSorted()
    }
    if (id !== undefined) return { status: 200, body: { accountId: id, holidays } }
    return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such' } }
  })
  return requests
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the personal working calendar screen (SC-089)', () => {
  it('lets a person enter holidays in their own calendar (FR-039)', async () => {
    const requests = fakeCalendars()
    renderAt('/settings/calendar', ALICE)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your working calendar' }),
    ).toBeInTheDocument()
    for (const day of ['2027-03-02', '2027-03-01']) {
      fireEvent.change(await screen.findByLabelText('Holiday'), { target: { value: day } })
      fireEvent.click(screen.getByRole('button', { name: 'Add holiday' }))
      expect(await screen.findByRole('status')).toHaveTextContent(`Holiday on ${day} added.`)
    }
    const rows = within(screen.getByRole('table', { name: 'Holidays' }))
      .getAllByRole('row')
      .slice(1)
    expect(rows.map((row) => row.textContent)).toEqual([
      'Mon 4 Jan 2027Remove',
      'Mon 1 Mar 2027Remove',
      'Tue 2 Mar 2027Remove',
    ])
    expect(requests).toContainEqual({
      method: 'PATCH',
      path: `/api/accounts/${ALICE.id}/calendar`,
      body: { addHolidays: ['2027-03-02'] },
    })
  })

  it('removes a holiday', async () => {
    const requests = fakeCalendars()
    renderAt('/settings/calendar', ALICE)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove the holiday on 2027-01-04' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Holiday on 2027-01-04 removed.')
    expect(screen.getByText('No holidays entered.')).toBeInTheDocument()
    expect(requests).toContainEqual({
      method: 'PATCH',
      path: `/api/accounts/${ALICE.id}/calendar`,
      body: { removeHolidays: ['2027-01-04'] },
    })
  })

  it('offers no weekend setting, and says the global calendar sets the weekend (FR-039)', async () => {
    fakeCalendars()
    renderAt('/settings/calendar', ALICE)
    expect(await screen.findByTestId('weekend')).toHaveTextContent(
      'The weekend is Saturday and Sunday, as the global calendar sets it for everyone; it cannot be changed here.',
    )
    // The one field is the date of a holiday to add; nothing sets a weekend.
    const fields = document.querySelectorAll('input, select, textarea')
    expect(fields).toHaveLength(1)
    expect(screen.getByLabelText('Holiday')).toHaveAttribute('type', 'date')
    expect(screen.queryByLabelText(/weekend/i)).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it("lets a system admin change someone else's, named by their username (FR-150)", async () => {
    const requests = fakeCalendars()
    renderAt(`/accounts/${ALICE.id}/calendar`, ROOT)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Working calendar of alice' }),
    ).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Holiday'), { target: { value: '2027-03-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add holiday' }))
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(requests).toContainEqual({
      method: 'PATCH',
      path: `/api/accounts/${ALICE.id}/calendar`,
      body: { addHolidays: ['2027-03-15'] },
    })
  })

  it("tells someone refused another person's calendar so, and offers them nothing", async () => {
    fakeCalendars(() => ({
      status: 403,
      body: {
        statusCode: 403,
        error: 'Forbidden',
        message: "Only the person themselves and system admins can see a person's calendar",
      },
    }))
    renderAt(`/accounts/${ROOT.id}/calendar`, ALICE)
    expect(
      await screen.findByText(
        "Only the person themselves and system admins can see a person's calendar.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
