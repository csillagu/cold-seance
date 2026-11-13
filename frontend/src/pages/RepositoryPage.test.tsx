import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type SignedInAccount, SignedInContext } from '../signed-in.ts'
import { type FakeAnswer, fakeApi } from '../test/fetch.ts'
import { RepositoryPage } from './RepositoryPage.tsx'

const TC_REPO = '00000000-0000-4000-8000-000000000002'
const ROOT = '00000000-0000-4000-8000-0000000000f1'
const ALICE = '00000000-0000-4000-8000-0000000000a1'
const BOB = '00000000-0000-4000-8000-0000000000b1'
const BASE = `/api/repositories/${TC_REPO}`

const alice = { accountId: ALICE, username: 'alice' }
const bob = { accountId: BOB, username: 'bob' }

const asAlice: SignedInAccount = { id: ALICE, username: 'alice', systemAdmin: false }
const asBob: SignedInAccount = { id: BOB, username: 'bob', systemAdmin: false }
const asRoot: SignedInAccount = { id: ROOT, username: 'root', systemAdmin: true }

const LAST_ADMIN: FakeAnswer = {
  status: 409,
  body: {
    statusCode: 409,
    error: 'Conflict',
    message: 'csillagu/tc-repo cannot be left without an admin: make someone else its admin first',
  },
}

/** tc-repo's API, its admins held as the server would hold them. */
function fakeTcRepo(initial: (typeof alice)[], refusals: Record<string, FakeAnswer> = {}) {
  let admins = initial
  const repository = () => ({
    id: TC_REPO,
    githubId: 2,
    owner: 'csillagu',
    name: 'tc-repo',
    admins,
  })
  const requests = fakeApi((method, path) => {
    const refusal = refusals[`${method} ${path}`]
    if (refusal) return refusal
    if (method === 'GET' && path === BASE) return { status: 200, body: repository() }
    if (method === 'POST' && path === `${BASE}/admins`) {
      admins = [...admins.filter((a) => a.accountId !== BOB), bob]
      return { status: 200, body: repository() }
    }
    const removed = new RegExp(`^${BASE}/admins/(.+)$`).exec(path)
    if (method === 'DELETE' && removed) {
      admins = admins.filter((a) => a.accountId !== removed[1])
      return { status: 204 }
    }
    return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such route' } }
  })
  return requests
}

function renderPage(signedIn: SignedInAccount, id = TC_REPO) {
  render(
    <SignedInContext value={signedIn}>
      <MemoryRouter initialEntries={[`/repositories/${id}`]}>
        <Routes>
          <Route path="repositories/:repositoryId" element={<RepositoryPage />} />
        </Routes>
      </MemoryRouter>
    </SignedInContext>,
  )
}

const admins = () =>
  within(screen.getByRole('table', { name: 'Admins of csillagu/tc-repo' }))
    .getAllByRole('rowheader')
    .map((cell) => cell.textContent)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the repository admins screen (SC-086)', () => {
  it('lists the admins under the repository’s name, marking the signed-in person', async () => {
    fakeTcRepo([alice, bob])
    renderPage(asAlice)
    expect(await screen.findByRole('heading', { level: 1, name: 'csillagu/tc-repo' })).toBeVisible()
    expect(admins()).toEqual(['alice(you)', 'bob'])
    expect(screen.getByRole('link', { name: 'Repositories' })).toHaveAttribute(
      'href',
      '/repositories',
    )
  })

  it('lets an admin add another admin by username (FR-174)', async () => {
    const requests = fakeTcRepo([alice])
    renderPage(asAlice)
    await screen.findByRole('table', { name: 'Admins of csillagu/tc-repo' })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'bob' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add admin' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'bob is now an admin of csillagu/tc-repo.',
    )
    expect(requests).toContainEqual({
      method: 'POST',
      path: `${BASE}/admins`,
      body: { username: 'bob' },
    })
    await waitFor(() => expect(admins()).toEqual(['alice(you)', 'bob']))
    expect(screen.getByLabelText('Username')).toHaveValue('')
  })

  it('lets an admin remove another admin (FR-176)', async () => {
    fakeTcRepo([alice, bob])
    renderPage(asBob)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove alice' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'alice is no longer an admin of csillagu/tc-repo.',
    )
    await waitFor(() => expect(admins()).toEqual(['bob(you)']))
  })

  it('lets an admin step down while another admin remains (FR-176)', async () => {
    const requests = fakeTcRepo([alice, bob])
    renderPage(asAlice)
    fireEvent.click(await screen.findByRole('button', { name: 'Step down' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'You are no longer an admin of csillagu/tc-repo.',
    )
    expect(requests).toContainEqual({
      method: 'DELETE',
      path: `${BASE}/admins/${ALICE}`,
      body: undefined,
    })
    await waitFor(() => expect(admins()).toEqual(['bob']))
    // No longer an admin, alice is offered no controls.
    expect(screen.queryByRole('button', { name: 'Remove bob' })).toBeNull()
    expect(screen.queryByRole('form', { name: 'Add an admin' })).toBeNull()
  })

  it("shows the API's refusal to leave the repository without an admin (FR-175)", async () => {
    fakeTcRepo([alice], { [`DELETE ${BASE}/admins/${ALICE}`]: LAST_ADMIN })
    renderPage(asAlice)
    fireEvent.click(await screen.findByRole('button', { name: 'Step down' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'csillagu/tc-repo cannot be left without an admin',
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Step down' })).toBeEnabled())
    expect(admins()).toEqual(['alice(you)'])
  })

  it('lets a system admin who is not an admin change the admins (FR-169)', async () => {
    const requests = fakeTcRepo([alice])
    renderPage(asRoot)
    await screen.findByRole('table', { name: 'Admins of csillagu/tc-repo' })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'bob' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add admin' }))
    await waitFor(() => expect(admins()).toEqual(['alice', 'bob']))
    fireEvent.click(screen.getByRole('button', { name: 'Remove alice' }))
    await waitFor(() => expect(admins()).toEqual(['bob']))
    expect(requests.filter((r) => r.method !== 'GET').map((r) => r.method)).toEqual([
      'POST',
      'DELETE',
    ])
  })

  it('offers no controls to someone who is neither an admin nor a system admin', async () => {
    fakeTcRepo([alice])
    renderPage(asBob)
    await screen.findByRole('table', { name: 'Admins of csillagu/tc-repo' })
    expect(screen.queryByRole('form', { name: 'Add an admin' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove alice' })).toBeNull()
    expect(
      screen.getByText('Only its admins and system admins can change its admins.'),
    ).toBeVisible()
  })

  it('shows a refusal of a username no account has', async () => {
    fakeTcRepo([alice], {
      [`POST ${BASE}/admins`]: {
        status: 404,
        body: { statusCode: 404, error: 'Not Found', message: 'There is no such account' },
      },
    })
    renderPage(asAlice)
    await screen.findByRole('table', { name: 'Admins of csillagu/tc-repo' })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'nobody' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add admin' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('There is no such account')
    expect(screen.getByLabelText('Username')).toHaveValue('nobody')
  })

  it('says when there is no such repository', async () => {
    fakeTcRepo([alice], {
      [`GET ${BASE}`]: {
        status: 404,
        body: { statusCode: 404, error: 'Not Found', message: 'There is no such repository' },
      },
    })
    renderPage(asAlice)
    expect(await screen.findByText('There is no such repository.')).toBeVisible()
  })
})
