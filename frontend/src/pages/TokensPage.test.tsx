import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatWhen } from '../proposals/proposal.ts'
import { type FakeAnswer, fakeApi } from '../test/fetch.ts'
import { endOfDay } from './accounts.ts'
import { TokensPage } from './TokensPage.tsx'

const OLD = {
  id: '6f1c2a5e-0000-4000-8000-0000000000a1',
  createdAt: '2026-11-01T09:00:00.000Z',
  expiresAt: null,
}
const NEW = {
  id: '6f1c2a5e-0000-4000-8000-0000000000a2',
  createdAt: '2026-11-13T10:00:00.000Z',
  expiresAt: '2027-03-31T22:00:00.000Z',
}

function renderTokens() {
  render(
    <MemoryRouter>
      <TokensPage />
    </MemoryRouter>,
  )
}

const tokensApi = (method: string, path: string): FakeAnswer => {
  if (method === 'GET' && path === '/api/tokens') return { status: 200, body: [OLD] }
  if (method === 'POST' && path === '/api/tokens')
    return { status: 201, body: { token: NEW, secret: 'cst_the-secret' } }
  if (method === 'DELETE' && path === `/api/tokens/${OLD.id}`) return { status: 204 }
  return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such route' } }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the personal access token page (SC-078)', () => {
  it('lists the person’s tokens, without their secrets', async () => {
    fakeApi(tokensApi)
    renderTokens()
    const table = await screen.findByRole('table', { name: 'Your tokens' })
    const row = within(table).getAllByRole('row')[1]
    expect(row).toHaveTextContent(formatWhen(OLD.createdAt))
    expect(row).toHaveTextContent('Never')
  })

  it('creates a token, showing its secret once, with the expiry at the end of the day given', async () => {
    const requests = fakeApi(tokensApi)
    renderTokens()
    await screen.findByRole('table', { name: 'Your tokens' })
    fireEvent.change(screen.getByLabelText('Expires at the end of (optional)'), {
      target: { value: '2027-03-31' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
    expect(await screen.findByTestId('token-secret')).toHaveTextContent('cst_the-secret')
    expect(screen.getByRole('status', { name: 'New token' })).toHaveTextContent(
      'It is shown only this once',
    )
    expect(requests).toContainEqual({
      method: 'POST',
      path: '/api/tokens',
      body: { expiresAt: endOfDay('2027-03-31').toISOString() },
    })
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('creates a token that never expires when no date is given', async () => {
    const requests = fakeApi(tokensApi)
    renderTokens()
    await screen.findByRole('table', { name: 'Your tokens' })
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
    await screen.findByTestId('token-secret')
    expect(requests).toContainEqual({ method: 'POST', path: '/api/tokens', body: {} })
  })

  it('revokes a token', async () => {
    const requests = fakeApi(tokensApi)
    renderTokens()
    fireEvent.click(
      await screen.findByRole('button', {
        name: `Revoke the token created ${formatWhen(OLD.createdAt)}`,
      }),
    )
    expect(await screen.findByText('You have no tokens.')).toBeInTheDocument()
    expect(requests).toContainEqual({
      method: 'DELETE',
      path: `/api/tokens/${OLD.id}`,
      body: undefined,
    })
  })

  it('shows the API’s refusal of an expiry date', async () => {
    fakeApi((method, path) =>
      method === 'POST'
        ? {
            status: 400,
            body: {
              statusCode: 400,
              error: 'Bad Request',
              message: 'The expiry date must be in the future',
            },
          }
        : tokensApi(method, path),
    )
    renderTokens()
    await screen.findByRole('table', { name: 'Your tokens' })
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The expiry date must be in the future',
    )
    expect(screen.queryByTestId('token-secret')).toBeNull()
  })
})
