import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type FakeAnswer, fakeApi } from '../test/fetch.ts'
import { AccountsPage } from './AccountsPage.tsx'

const ROOT = { id: '6f1c2a5e-0000-4000-8000-000000000001', username: 'root', systemAdmin: true }
const ALICE = { id: '6f1c2a5e-0000-4000-8000-000000000002', username: 'alice', systemAdmin: false }
const ERIN = { id: '6f1c2a5e-0000-4000-8000-000000000003', username: 'erin', systemAdmin: false }

function renderAccounts() {
  render(
    <MemoryRouter>
      <AccountsPage />
    </MemoryRouter>,
  )
}

/** A system admin's API, with root and alice. */
const asRoot = (method: string, path: string): FakeAnswer => {
  if (method === 'GET' && path === '/api/accounts') return { status: 200, body: [ALICE, ROOT] }
  if (method === 'POST' && path === '/api/accounts') return { status: 201, body: ERIN }
  if (method === 'POST' && path === '/api/accounts/system-admins')
    return { status: 200, body: { ...ALICE, systemAdmin: true } }
  return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such route' } }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the account administration screen (SC-076)', () => {
  it('lists the accounts, marking the system admins, with a way to each GitHub account link', async () => {
    fakeApi(asRoot)
    renderAccounts()
    const table = await screen.findByRole('table', { name: 'Accounts' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'alice',
      'root',
    ])
    expect(rows[1]).toHaveTextContent('System admin')
    expect(screen.getByRole('link', { name: 'GitHub account of alice' })).toHaveAttribute(
      'href',
      `/accounts/${ALICE.id}/github`,
    )
    // root is a system admin already: there is nothing to make of root.
    expect(screen.queryByRole('button', { name: 'Make root a system admin' })).toBeNull()
  })

  it('creates an account (FR-117) and lists it', async () => {
    const requests = fakeApi(asRoot)
    renderAccounts()
    await screen.findByRole('table', { name: 'Accounts' })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'erin' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'erin-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Account erin created.')
    expect(requests).toContainEqual({
      method: 'POST',
      path: '/api/accounts',
      body: { username: 'erin', password: 'erin-password' },
    })
    expect(screen.getByRole('rowheader', { name: 'erin' })).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('makes another person a system admin (FR-140)', async () => {
    const requests = fakeApi(asRoot)
    renderAccounts()
    fireEvent.click(await screen.findByRole('button', { name: 'Make alice a system admin' }))
    expect(await screen.findByRole('status')).toHaveTextContent('alice is now a system admin.')
    expect(requests).toContainEqual({
      method: 'POST',
      path: '/api/accounts/system-admins',
      body: { accountId: ALICE.id },
    })
    expect(screen.queryByRole('button', { name: 'Make alice a system admin' })).toBeNull()
  })

  it('shows the API’s refusal of an account, such as a taken username', async () => {
    fakeApi((method, path) =>
      method === 'POST'
        ? {
            status: 409,
            body: { statusCode: 409, error: 'Conflict', message: 'That username is taken' },
          }
        : asRoot(method, path),
    )
    renderAccounts()
    await screen.findByRole('table', { name: 'Accounts' })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That username is taken')
  })

  it('offers someone who is not a system admin no way to create accounts', async () => {
    fakeApi(() => ({
      status: 403,
      body: {
        statusCode: 403,
        error: 'Forbidden',
        message: 'Only system admins can administer accounts',
      },
    }))
    renderAccounts()
    expect(
      await screen.findByText('Only system admins can administer accounts.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
