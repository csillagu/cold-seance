import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type SignedInAccount, SignedInContext } from '../signed-in.ts'
import { type FakeAnswer, fakeApi } from '../test/fetch.ts'
import { GitHubLinkPage } from './GitHubLinkPage.tsx'

const ROOT = { id: '6f1c2a5e-0000-4000-8000-000000000001', username: 'root', systemAdmin: true }
const ALICE = { id: '6f1c2a5e-0000-4000-8000-000000000002', username: 'alice', systemAdmin: false }

function renderAt(path: string, signedIn: SignedInAccount) {
  render(
    <SignedInContext value={signedIn}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings/github" element={<GitHubLinkPage />} />
          <Route path="/accounts/:accountId/github" element={<GitHubLinkPage />} />
        </Routes>
      </MemoryRouter>
    </SignedInContext>,
  )
}

/** The API with alice not yet linked; linking answers the name given. */
function api(): (method: string, path: string) => FakeAnswer {
  return (method, path) => {
    if (method === 'GET' && path === '/api/accounts') return { status: 200, body: [ALICE, ROOT] }
    const id = /^\/api\/accounts\/([^/]+)\/github$/.exec(path)?.[1]
    if (id !== undefined && method === 'GET')
      return { status: 200, body: { accountId: id, githubLogin: null } }
    if (id !== undefined && method === 'PUT')
      return { status: 200, body: { accountId: id, githubLogin: 'tc-alice' } }
    return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such route' } }
  }
}

function link(name: string) {
  fireEvent.change(screen.getByLabelText('GitHub account name'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Link' }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the GitHub account link setting (SC-077)', () => {
  it('lets a person link their own account (FR-135)', async () => {
    const requests = fakeApi(api())
    renderAt('/settings/github', ALICE)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your GitHub account' }),
    ).toBeInTheDocument()
    expect(await screen.findByText('Not linked to a GitHub account.')).toBeInTheDocument()
    link('tc-alice')
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Linked to the GitHub account tc-alice.',
    )
    expect(screen.getByTestId('github-link')).toHaveTextContent(
      'Linked to the GitHub account tc-alice.',
    )
    expect(requests).toContainEqual({
      method: 'PUT',
      path: `/api/accounts/${ALICE.id}/github`,
      body: { githubLogin: 'tc-alice' },
    })
  })

  it("lets a system admin link someone else's account, named by their username", async () => {
    const requests = fakeApi(api())
    renderAt(`/accounts/${ALICE.id}/github`, ROOT)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'GitHub account of alice' }),
    ).toBeInTheDocument()
    link('tc-alice')
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(requests).toContainEqual({
      method: 'PUT',
      path: `/api/accounts/${ALICE.id}/github`,
      body: { githubLogin: 'tc-alice' },
    })
  })

  it('shows the API’s refusal of a name', async () => {
    fakeApi((method, path) =>
      method === 'PUT'
        ? {
            status: 409,
            body: {
              statusCode: 409,
              error: 'Conflict',
              message: 'That GitHub account is linked to someone else',
            },
          }
        : api()(method, path),
    )
    renderAt('/settings/github', ALICE)
    await screen.findByText('Not linked to a GitHub account.')
    link('tc-bob')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That GitHub account is linked to someone else',
    )
  })

  it("tells someone refused another person's link so, and offers them nothing", async () => {
    fakeApi(() => ({
      status: 403,
      body: { statusCode: 403, error: 'Forbidden', message: 'You cannot see that link' },
    }))
    renderAt(`/accounts/${ROOT.id}/github`, ALICE)
    expect(await screen.findByText('You cannot see that link.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
