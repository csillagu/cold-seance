import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.tsx'
import { type FakeAnswer, fakeApi, UNAUTHENTICATED } from './test/fetch.ts'

const APOLLO = { id: '6f1c2d4e-0000-4000-8000-000000000001', name: 'Apollo' }
const BOREALIS = '6f1c2d4e-0000-4000-8000-000000000002'
const ALICE = { id: '6f1c2a5e-0000-4000-8000-000000000001', username: 'alice', systemAdmin: false }

/** Where the router is, so a test can see where a page sent the browser. */
function Where() {
  const location = useLocation()
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Where />
    </MemoryRouter>,
  )
}

/** A signed-in person's API: `Apollo` is visible to them, `Borealis` is not. */
const signedIn = (method: string, path: string): FakeAnswer => {
  if (method === 'GET' && path === '/api/session') return { status: 200, body: ALICE }
  if (method === 'GET' && path === '/api/projects') return { status: 200, body: [APOLLO] }
  if (method === 'GET' && path === `/api/projects/${APOLLO.id}`)
    return { status: 200, body: APOLLO }
  if (method === 'GET' && path.startsWith('/api/projects/')) {
    return {
      status: 403,
      body: {
        statusCode: 403,
        error: 'Not Visible',
        message: 'This project is not visible to you',
      },
    }
  }
  return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such route' } }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the layout (SC-113)', () => {
  it('shows a page inside a header and navigation', async () => {
    fakeApi(signedIn)
    renderAt('/')
    expect(screen.getByRole('banner')).toHaveTextContent('cold-seance')
    const navigation = screen.getByRole('navigation', { name: 'Navigation' })
    expect(within(navigation).getByRole('link', { name: 'Start' })).toHaveAttribute('href', '/')
    expect(await within(navigation).findByRole('link', { name: 'Apollo' })).toHaveAttribute(
      'href',
      `/projects/${APOLLO.id}`,
    )
    expect(screen.getByRole('main')).toHaveTextContent('Open a project from the navigation.')
  })

  it('leads from the navigation to a project the person can read', async () => {
    fakeApi(signedIn)
    renderAt('/')
    fireEvent.click(await screen.findByRole('link', { name: 'Apollo' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Apollo' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Apollo' })).toHaveAttribute('aria-current', 'page')
  })

  it('says when a person can read no project', async () => {
    fakeApi((method, path) =>
      path === '/api/session' ? signedIn(method, path) : { status: 200, body: [] },
    )
    renderAt('/')
    expect(await screen.findByText('No projects yet.')).toBeInTheDocument()
  })

  it('says when the projects could not be loaded', async () => {
    fakeApi(() => ({ status: 500, body: { statusCode: 500, error: 'Internal', message: 'x' } }))
    renderAt('/')
    expect(await screen.findByText('The projects could not be loaded.')).toBeInTheDocument()
  })

  it('sends someone who is not signed in to the sign-in page, to come back afterwards', async () => {
    fakeApi(() => UNAUTHENTICATED)
    renderAt(`/projects/${APOLLO.id}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent(
      `/sign-in?next=${encodeURIComponent(`/projects/${APOLLO.id}`)}`,
    )
  })

  it('shows an address it has no page for inside the layout', async () => {
    fakeApi(signedIn)
    renderAt('/no-such-page')
    expect(screen.getByRole('navigation', { name: 'Navigation' })).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This page does not exist' }),
    ).toBeInTheDocument()
  })
})

describe('the navigation to the account screens', () => {
  it('leads a person to their own GitHub account link, capacity and absences, working calendar and API tokens, but not to account administration', async () => {
    fakeApi(signedIn)
    renderAt('/')
    const navigation = screen.getByRole('navigation', { name: 'Navigation' })
    expect(await within(navigation).findByRole('link', { name: 'GitHub account' })).toHaveAttribute(
      'href',
      '/settings/github',
    )
    expect(within(navigation).getByRole('link', { name: 'Capacity and absences' })).toHaveAttribute(
      'href',
      '/settings/capacity',
    )
    expect(within(navigation).getByRole('link', { name: 'Working calendar' })).toHaveAttribute(
      'href',
      '/settings/calendar',
    )
    expect(within(navigation).getByRole('link', { name: 'API tokens' })).toHaveAttribute(
      'href',
      '/tokens',
    )
    expect(within(navigation).queryByRole('link', { name: 'Accounts' })).toBeNull()
  })

  it('leads a system admin to account administration (SC-076)', async () => {
    fakeApi((method, path) =>
      method === 'GET' && path === '/api/session'
        ? { status: 200, body: { ...ALICE, systemAdmin: true } }
        : signedIn(method, path),
    )
    renderAt('/')
    const navigation = screen.getByRole('navigation', { name: 'Navigation' })
    expect(await within(navigation).findByRole('link', { name: 'Accounts' })).toHaveAttribute(
      'href',
      '/accounts',
    )
  })
})

describe('the sign-in page is outside the layout (SRC-223)', () => {
  it('has no header or navigation', () => {
    fakeApi(signedIn)
    renderAt('/sign-in')
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
})

describe('a project page', () => {
  it('tells someone a project is not visible to them, and shows nothing of it (FR-017)', async () => {
    fakeApi(signedIn)
    renderAt(`/projects/${BOREALIS}`)
    const main = screen.getByRole('main')
    expect(
      await within(main).findByRole('heading', { name: 'This project is not visible to you' }),
    ).toBeInTheDocument()
    expect(main).not.toHaveTextContent(/not found|deleted|no permission/i)
  })

  it('says the same of an address whose project id is malformed', async () => {
    fakeApi((method, path) =>
      path === '/api/projects/not-an-id'
        ? { status: 400, body: { statusCode: 400, error: 'Bad Request', message: 'format uuid' } }
        : signedIn(method, path),
    )
    renderAt('/projects/not-an-id')
    expect(
      await screen.findByRole('heading', { name: 'This project is not visible to you' }),
    ).toBeInTheDocument()
  })
})
