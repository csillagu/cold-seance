import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App.tsx'
import { type FakeAnswer, fakeApi, UNAUTHENTICATED } from '../test/fetch.ts'

const APOLLO = { id: '6f1c2d4e-0000-4000-8000-000000000001', name: 'Apollo' }
const APOLLO_GROUND = { id: '6f1c2d4e-0000-4000-8000-000000000003', name: 'Apollo ground' }
const ALICE = { id: '6f1c2a5e-0000-4000-8000-000000000001', username: 'alice', systemAdmin: false }

/** Where the router is, so a test can see where the header sent the browser. */
function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname}</output>
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Where />
    </MemoryRouter>,
  )
}

/**
 * alice's API. The search answers as the service layer does (SC-116): the projects alice can read
 * whose names hold the text, ignoring case.
 */
const signedIn = (method: string, path: string): FakeAnswer => {
  if (method === 'GET' && path === '/api/session') return { status: 200, body: ALICE }
  if (method === 'GET' && path === '/api/projects')
    return { status: 200, body: [APOLLO, APOLLO_GROUND] }
  if (method === 'GET' && path.startsWith('/api/projects/search?text=')) {
    const text = decodeURIComponent(path.slice('/api/projects/search?text='.length)).toLowerCase()
    return {
      status: 200,
      body: [APOLLO, APOLLO_GROUND].filter((project) => project.name.toLowerCase().includes(text)),
    }
  }
  if (method === 'GET' && path === `/api/projects/${APOLLO.id}`)
    return { status: 200, body: APOLLO }
  return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such route' } }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function searchBox() {
  return within(screen.getByRole('banner')).getByRole('searchbox', { name: 'Search projects' })
}

describe('the project search bar (SC-114)', () => {
  it('is in the header', () => {
    fakeApi(signedIn)
    renderAt('/')
    expect(searchBox()).toBeInTheDocument()
  })

  it('shows the projects the service finds for part of a name, in any case, as links (FR-183, FR-184)', async () => {
    const requests = fakeApi(signedIn)
    renderAt('/')
    fireEvent.change(searchBox(), { target: { value: 'GROUND' } })
    const matches = await screen.findByRole('list', { name: 'Matching projects' })
    expect(within(matches).getAllByRole('link')).toHaveLength(1)
    expect(within(matches).getByRole('link', { name: 'Apollo ground' })).toHaveAttribute(
      'href',
      `/projects/${APOLLO_GROUND.id}`,
    )
    expect(requests.map((request) => request.path)).toContain('/api/projects/search?text=GROUND')
  })

  it('sends the text without the spaces around it, and searches for nothing when it is only spaces', async () => {
    const requests = fakeApi(signedIn)
    renderAt('/')
    fireEvent.change(searchBox(), { target: { value: '   ' } })
    fireEvent.change(searchBox(), { target: { value: '  pol ' } })
    await screen.findByRole('list', { name: 'Matching projects' })
    const searches = requests.filter((request) => request.path.startsWith('/api/projects/search'))
    expect(searches.map((request) => request.path)).toEqual(['/api/projects/search?text=pol'])
  })

  it('says when no project the person can open matches', async () => {
    fakeApi(signedIn)
    renderAt('/')
    fireEvent.change(searchBox(), { target: { value: 'Borealis' } })
    expect(await screen.findByText('No project you can open matches.')).toBeInTheDocument()
  })

  it('says when the search failed', async () => {
    fakeApi((method, path) =>
      path.startsWith('/api/projects/search')
        ? { status: 500, body: { statusCode: 500, error: 'Internal', message: 'x' } }
        : signedIn(method, path),
    )
    renderAt('/')
    fireEvent.change(searchBox(), { target: { value: 'Apollo' } })
    expect(await screen.findByText('The search failed. Try again.')).toBeInTheDocument()
  })

  it('sends someone whose session has ended to the sign-in page', async () => {
    fakeApi((method, path) =>
      path.startsWith('/api/projects/search') ? UNAUTHENTICATED : signedIn(method, path),
    )
    renderAt('/')
    fireEvent.change(searchBox(), { target: { value: 'Apollo' } })
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
  })

  it('opens a found project, and then closes and clears the search', async () => {
    fakeApi(signedIn)
    renderAt('/')
    fireEvent.change(searchBox(), { target: { value: 'apollo' } })
    const matches = await screen.findByRole('list', { name: 'Matching projects' })
    fireEvent.click(within(matches).getByRole('link', { name: 'Apollo' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Apollo' })).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent(`/projects/${APOLLO.id}`)
    expect(screen.queryByRole('list', { name: 'Matching projects' })).toBeNull()
    expect(searchBox()).toHaveValue('')
  })

  it('closes the results on Escape', async () => {
    fakeApi(signedIn)
    renderAt('/')
    fireEvent.change(searchBox(), { target: { value: 'apollo' } })
    await screen.findByRole('list', { name: 'Matching projects' })
    fireEvent.keyDown(searchBox(), { key: 'Escape' })
    expect(screen.queryByRole('list', { name: 'Matching projects' })).toBeNull()
  })
})

describe('the signed-in person menu (SC-115)', () => {
  async function personButton() {
    return within(screen.getByRole('banner')).findByRole('button', { name: /alice/ })
  }

  it('shows who is signed in in the header, with the entries closed', async () => {
    fakeApi(signedIn)
    renderAt('/')
    const button = await personButton()
    expect(button).toHaveTextContent('AL')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('navigation', { name: 'Your account' })).toBeNull()
  })

  it('brings up settings, calendar and API tokens when clicked, each leading to its screen (SRC-221, SRC-226, SRC-227)', async () => {
    fakeApi(signedIn)
    renderAt('/')
    fireEvent.click(await personButton())
    const entries = screen.getByRole('navigation', { name: 'Your account' })
    const settings = within(entries).getByRole('list', { name: 'Settings' })
    expect(within(settings).getByRole('link', { name: 'GitHub account' })).toHaveAttribute(
      'href',
      '/settings/github',
    )
    expect(within(settings).getByRole('link', { name: 'Capacity and absences' })).toHaveAttribute(
      'href',
      '/settings/capacity',
    )
    expect(within(entries).getByRole('link', { name: 'Calendar' })).toHaveAttribute(
      'href',
      '/settings/calendar',
    )
    expect(within(entries).getByRole('link', { name: 'API tokens' })).toHaveAttribute(
      'href',
      '/tokens',
    )
  })

  it('opens an entry and closes', async () => {
    fakeApi(signedIn)
    renderAt('/')
    fireEvent.click(await personButton())
    const entries = screen.getByRole('navigation', { name: 'Your account' })
    fireEvent.click(within(entries).getByRole('link', { name: 'API tokens' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/tokens')
    expect(screen.queryByRole('navigation', { name: 'Your account' })).toBeNull()
  })

  it('closes on a second click, on Escape and on a click outside', async () => {
    fakeApi(signedIn)
    renderAt('/')
    const button = await personButton()
    fireEvent.click(button)
    fireEvent.click(button)
    expect(screen.queryByRole('navigation', { name: 'Your account' })).toBeNull()
    fireEvent.click(button)
    fireEvent.keyDown(button, { key: 'Escape' })
    expect(screen.queryByRole('navigation', { name: 'Your account' })).toBeNull()
    fireEvent.click(button)
    act(() => {
      fireEvent.mouseDown(screen.getByRole('main'))
    })
    expect(screen.queryByRole('navigation', { name: 'Your account' })).toBeNull()
  })

  it('is not shown while who is signed in is not known', () => {
    fakeApi(signedIn)
    renderAt('/')
    expect(within(screen.getByRole('banner')).queryByRole('button')).toBeNull()
  })
})
