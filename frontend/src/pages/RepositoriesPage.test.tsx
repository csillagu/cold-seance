import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type FakeAnswer, fakeApi } from '../test/fetch.ts'
import { RepositoriesPage } from './RepositoriesPage.tsx'

const ALICE = '00000000-0000-4000-8000-0000000000a1'
const ERIN = '00000000-0000-4000-8000-0000000000e1'
const ZETA = '00000000-0000-4000-8000-000000000001'
const TC_REPO = '00000000-0000-4000-8000-000000000002'

const zeta = {
  id: ZETA,
  githubId: 1,
  owner: 'octo',
  name: 'zeta',
  admins: [{ accountId: ALICE, username: 'alice' }],
}
const tcRepo = {
  id: TC_REPO,
  githubId: 2,
  owner: 'csillagu',
  name: 'tc-repo',
  admins: [{ accountId: ERIN, username: 'erin' }],
}

function fakeRegistry(answers: Record<string, FakeAnswer> = {}) {
  return fakeApi((method, path) => {
    const answer = answers[`${method} ${path}`]
    if (answer) return answer
    if (method === 'GET' && path === '/api/repositories') return { status: 200, body: [zeta] }
    if (method === 'POST' && path === '/api/repositories') return { status: 201, body: tcRepo }
    return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such route' } }
  })
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/repositories']}>
      <RepositoriesPage />
    </MemoryRouter>,
  )
}

/** The table's rows below its head, each as the text of its cells. */
const rows = (table: HTMLElement) =>
  within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the repository registration screen (SC-085)', () => {
  it('lists the registered repositories with their admins, each leading to its admins screen', async () => {
    fakeRegistry()
    renderPage()
    const table = await screen.findByRole('table', { name: 'Registered repositories' })
    expect(rows(table)).toEqual([['octo/zeta', 'alice']])
    expect(within(table).getByRole('link', { name: 'octo/zeta' })).toHaveAttribute(
      'href',
      `/repositories/${ZETA}`,
    )
  })

  it('says when no repository is registered', async () => {
    fakeRegistry({ 'GET /api/repositories': { status: 200, body: [] } })
    renderPage()
    expect(await screen.findByText('No repository is registered yet.')).toBeInTheDocument()
  })

  it('registers owner/name and lists it with the person as its admin (FR-167)', async () => {
    const requests = fakeRegistry()
    renderPage()
    await screen.findByRole('table', { name: 'Registered repositories' })
    fireEvent.change(screen.getByLabelText('Repository'), {
      target: { value: ' csillagu/tc-repo ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Register' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'csillagu/tc-repo is registered, and you are its admin.',
    )
    expect(requests).toContainEqual({
      method: 'POST',
      path: '/api/repositories',
      body: { owner: 'csillagu', name: 'tc-repo' },
    })
    expect(rows(screen.getByRole('table', { name: 'Registered repositories' }))).toEqual([
      ['csillagu/tc-repo', 'erin'],
      ['octo/zeta', 'alice'],
    ])
    expect(screen.getByLabelText('Repository')).toHaveValue('')
  })

  it('asks for owner/name without asking the API', async () => {
    const requests = fakeRegistry()
    renderPage()
    await screen.findByRole('table', { name: 'Registered repositories' })
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'tc-repo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Register' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Write the repository as owner/name.',
    )
    expect(requests.filter((r) => r.method === 'POST')).toEqual([])
  })

  it.each([
    [409, 'Conflict', 'csillagu/tc-repo is already registered'],
    [
      400,
      'Bad Request',
      'The tool cannot reach csillagu/tc-repo on GitHub: its GitHub App is not installed on it, its token is not given it, or it does not exist',
    ],
  ])(
    "shows the API's refusal (%i) in its own words and lists nothing new",
    async (status, error, message) => {
      fakeRegistry({
        'POST /api/repositories': { status, body: { statusCode: status, error, message } },
      })
      renderPage()
      await screen.findByRole('table', { name: 'Registered repositories' })
      fireEvent.change(screen.getByLabelText('Repository'), {
        target: { value: 'csillagu/tc-repo' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Register' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      await waitFor(() => expect(screen.getByRole('button', { name: 'Register' })).toBeEnabled())
      expect(rows(screen.getByRole('table', { name: 'Registered repositories' }))).toEqual([
        ['octo/zeta', 'alice'],
      ])
      expect(screen.getByLabelText('Repository')).toHaveValue('csillagu/tc-repo')
    },
  )

  it('says when the repositories could not be loaded', async () => {
    fakeRegistry({ 'GET /api/repositories': { status: 500, body: {} } })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The repositories could not be loaded.',
    )
  })
})
