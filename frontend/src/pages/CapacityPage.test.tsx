import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type SignedInAccount, SignedInContext } from '../signed-in.ts'
import { type FakeAnswer, fakeApi } from '../test/fetch.ts'
import { CapacityPage } from './CapacityPage.tsx'

const ROOT = { id: '6f1c2a5e-0000-4000-8000-000000000001', username: 'root', systemAdmin: true }
const ALICE = { id: '6f1c2a5e-0000-4000-8000-000000000002', username: 'alice', systemAdmin: false }
const ABSENCE = '7a1c2a5e-0000-4000-8000-000000000001'

function renderAt(path: string, signedIn: SignedInAccount) {
  render(
    <SignedInContext value={signedIn}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings/capacity" element={<CapacityPage />} />
          <Route path="/accounts/:accountId/capacity" element={<CapacityPage />} />
        </Routes>
      </MemoryRouter>
    </SignedInContext>,
  )
}

/** The API with every person at 100% and one absence; changes answer what they were given. */
function api(): (method: string, path: string) => FakeAnswer {
  return (method, path) => {
    if (method === 'GET' && path === '/api/accounts') return { status: 200, body: [ALICE, ROOT] }
    const [, id, what, absenceId] =
      /^\/api\/accounts\/([^/]+)\/(capacity|absences)(?:\/([^/]+))?$/.exec(path) ?? []
    if (id === undefined) {
      return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such' } }
    }
    if (what === 'capacity' && method === 'GET')
      return { status: 200, body: { accountId: id, capacity: 100 } }
    if (what === 'capacity' && method === 'PUT')
      return { status: 200, body: { accountId: id, capacity: 80 } }
    if (method === 'GET')
      return {
        status: 200,
        body: [{ id: ABSENCE, accountId: id, from: '2027-01-04', to: '2027-01-05' }],
      }
    if (method === 'POST')
      return {
        status: 201,
        body: {
          id: '7a1c2a5e-0000-4000-8000-000000000002',
          accountId: id,
          from: '2027-03-08',
          to: '2027-03-12',
        },
      }
    if (method === 'DELETE' && absenceId === ABSENCE) return { status: 204 }
    return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such' } }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the capacity and absences screen (SC-088)', () => {
  it('lets a person set their own capacity (FR-037)', async () => {
    const requests = fakeApi(api())
    renderAt('/settings/capacity', ALICE)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your capacity and absences' }),
    ).toBeInTheDocument()
    expect(await screen.findByTestId('capacity')).toHaveTextContent('Capacity: 100% of full time.')
    fireEvent.change(screen.getByLabelText('Capacity (% of full time)'), {
      target: { value: '80' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set capacity' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Capacity set to 80%.')
    expect(screen.getByTestId('capacity')).toHaveTextContent('Capacity: 80% of full time.')
    expect(requests).toContainEqual({
      method: 'PUT',
      path: `/api/accounts/${ALICE.id}/capacity`,
      body: { capacity: 80 },
    })
  })

  it('records an absence in whole days, offering no part-day unit (FR-038)', async () => {
    const requests = fakeApi(api())
    renderAt('/settings/capacity', ALICE)
    const form = await screen.findByRole('form', { name: 'Record an absence' })
    // Only days: two date fields, no hours or half days.
    expect(within(form).getByLabelText('First day')).toHaveAttribute('type', 'date')
    expect(within(form).getByLabelText('Last day')).toHaveAttribute('type', 'date')
    expect(form.querySelectorAll('input')).toHaveLength(2)
    fireEvent.change(within(form).getByLabelText('First day'), {
      target: { value: '2027-03-08' },
    })
    fireEvent.change(within(form).getByLabelText('Last day'), { target: { value: '2027-03-12' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Record absence' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Absence from 2027-03-08 to 2027-03-12 recorded.',
    )
    const rows = within(screen.getByRole('table', { name: 'Absences' }))
      .getAllByRole('row')
      .slice(1)
    expect(rows.map((row) => row.textContent)).toEqual([
      'Mon 2027-01-04Tue 2027-01-05Remove',
      'Mon 2027-03-08Fri 2027-03-12Remove',
    ])
    expect(requests).toContainEqual({
      method: 'POST',
      path: `/api/accounts/${ALICE.id}/absences`,
      body: { from: '2027-03-08', to: '2027-03-12' },
    })
  })

  it('removes an absence', async () => {
    const requests = fakeApi(api())
    renderAt('/settings/capacity', ALICE)
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Remove the absence from 2027-01-04 to 2027-01-05',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Absence from 2027-01-04 to 2027-01-05 removed.',
    )
    expect(screen.getByText('No absences recorded.')).toBeInTheDocument()
    expect(requests).toContainEqual({
      method: 'DELETE',
      path: `/api/accounts/${ALICE.id}/absences/${ABSENCE}`,
      body: undefined,
    })
  })

  it('shows the API’s refusal of a change', async () => {
    fakeApi((method, path) =>
      method === 'PUT'
        ? {
            status: 404,
            body: { statusCode: 404, error: 'Not Found', message: 'There is no such account' },
          }
        : api()(method, path),
    )
    renderAt('/settings/capacity', ALICE)
    fireEvent.change(await screen.findByLabelText('Capacity (% of full time)'), {
      target: { value: '80' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set capacity' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('There is no such account')
    expect(screen.getByTestId('capacity')).toHaveTextContent('Capacity: 100% of full time.')
  })

  it('lets the browser hold back a capacity that is not a whole percentage from 0 to 100', async () => {
    fakeApi(api())
    renderAt('/settings/capacity', ALICE)
    const field = await screen.findByLabelText('Capacity (% of full time)')
    expect(field).toHaveAttribute('min', '0')
    expect(field).toHaveAttribute('max', '100')
    expect(field).toHaveAttribute('step', '1')
  })

  it("lets a system admin change someone else's, named by their username (FR-150)", async () => {
    const requests = fakeApi(api())
    renderAt(`/accounts/${ALICE.id}/capacity`, ROOT)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Capacity and absences of alice' }),
    ).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Capacity (% of full time)'), {
      target: { value: '80' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set capacity' }))
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(requests).toContainEqual({
      method: 'PUT',
      path: `/api/accounts/${ALICE.id}/capacity`,
      body: { capacity: 80 },
    })
  })

  it("tells someone refused another person's absences so, and offers them nothing", async () => {
    fakeApi(() => ({
      status: 403,
      body: {
        statusCode: 403,
        error: 'Forbidden',
        message: "Only the person themselves and system admins can see a person's absences",
      },
    }))
    renderAt(`/accounts/${ROOT.id}/capacity`, ALICE)
    expect(
      await screen.findByText(
        "Only the person themselves and system admins can see a person's absences.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
