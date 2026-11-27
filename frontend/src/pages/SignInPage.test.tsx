import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeApi, UNAUTHENTICATED } from '../test/fetch.ts'
import { SIGN_IN_FAILED, SIGN_IN_TOO_MANY, SIGN_IN_UNAVAILABLE, SignInPage } from './SignInPage.tsx'

function renderSignIn(path = '/sign-in') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/" element={<h1>Start</h1>} />
        <Route path="/projects/:id" element={<h1>A project</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

function signIn(username: string, password: string) {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the sign-in page (SC-075)', () => {
  it('signs a person in with their account and goes on to the start page', async () => {
    const requests = fakeApi(() => ({ status: 204 }))
    renderSignIn()
    signIn('alice', 'alice-password')
    expect(await screen.findByRole('heading', { name: 'Start' })).toBeInTheDocument()
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/api/session',
        body: { username: 'alice', password: 'alice-password' },
      },
    ])
  })

  it('goes on to the page that sent the person to sign in', async () => {
    fakeApi(() => ({ status: 204 }))
    renderSignIn(`/sign-in?next=${encodeURIComponent('/projects/1')}`)
    signIn('alice', 'alice-password')
    expect(await screen.findByRole('heading', { name: 'A project' })).toBeInTheDocument()
  })

  it('tells the person when signing in failed, and empties the password', async () => {
    fakeApi(() => UNAUTHENTICATED)
    renderSignIn()
    signIn('alice', 'wrong')
    expect(await screen.findByRole('alert')).toHaveTextContent(SIGN_IN_FAILED)
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Username')).toHaveValue('alice')
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
  })

  it('tells the person when signing in was refused for too many attempts (SRC-298)', async () => {
    fakeApi(() => ({
      status: 429,
      body: { statusCode: 429, error: 'Too Many Requests', message: 'Too many sign-in attempts' },
    }))
    renderSignIn()
    signIn('alice', 'alice-password')
    expect(await screen.findByRole('alert')).toHaveTextContent(SIGN_IN_TOO_MANY)
    // Not a wrong password: the password field is not marked as the problem.
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'false')
  })

  it('tells the person when the tool could not be reached', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
    renderSignIn()
    signIn('alice', 'alice-password')
    expect(await screen.findByRole('alert')).toHaveTextContent(SIGN_IN_UNAVAILABLE)
  })

  it('offers no registration and no other way to sign in (FR-117, DD-027)', () => {
    renderSignIn()
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Sign in'])
    expect(screen.queryAllByRole('link')).toEqual([])
    expect(document.body).not.toHaveTextContent(/register|sign up/i)
    expect(screen.getByText('No account yet? A system admin creates accounts.')).toBeInTheDocument()
  })
})
