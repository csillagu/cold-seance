import { type FormEvent, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { api, ApiError } from '../api.ts'
import { afterSignIn } from '../sign-in-redirect.ts'
import './sign-in.css'

/** What the page says when the username or the password is wrong, as the design words it. */
export const SIGN_IN_FAILED = 'Signing in failed. The username or the password is wrong.'

/** What the page says when the backend refused the sign-in for too many attempts (SRC-298). */
export const SIGN_IN_TOO_MANY = 'Signing in failed: too many attempts. Wait a minute and try again.'

/** What the page says when the tool could not be reached or answered with an error of its own. */
export const SIGN_IN_UNAVAILABLE = 'Signing in failed: the tool could not be reached. Try again.'

/**
 * The sign-in page (SC-075): a person signs in with their account held in the tool (FR-118,
 * DD-027), and on success the backend sets the session cookie (DD-054) and the page goes on to the
 * page that sent them here, or the start page. It is shown outside the layout (SRC-223), and looks
 * as the approved design shows (SRC-249, `design/frontend/SignIn.dc.html`): no registration, since
 * only system admins create accounts, and no way to reset a password.
 */
function failureMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return SIGN_IN_UNAVAILABLE
  if (error.status === 401) return SIGN_IN_FAILED
  if (error.status === 429) return SIGN_IN_TOO_MANY
  return SIGN_IN_UNAVAILABLE
}

export function SignInPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [failure, setFailure] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api('/session', { method: 'POST', body: { username, password } })
      void navigate(afterSignIn(searchParams.get('next')), { replace: true })
    } catch (error) {
      setFailure(failureMessage(error))
      setPassword('')
      setBusy(false)
    }
  }

  return (
    <main className="sign-in">
      <div className="sign-in__glow" aria-hidden="true" />
      <div className="sign-in__column">
        <div className="sign-in__brand">
          <span className="sign-in__mark" aria-hidden="true" />
          <span className="sign-in__name">cold-seance</span>
        </div>
        <h1 className="sign-in__title">Sign in</h1>
        <p className="sign-in__lead">With the account your system admin gave you.</p>

        <form className="sign-in__form" onSubmit={(event) => void submit(event)}>
          {failure !== undefined && (
            <div role="alert" className="sign-in__alert">
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7.5v5.5M12 16.5v.5" />
              </svg>
              <span>{failure}</span>
            </div>
          )}

          <div className="sign-in__field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="sign-in__field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={failure === SIGN_IN_FAILED}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <button type="submit" className="sign-in__submit" disabled={busy}>
            Sign in
          </button>
        </form>

        <p className="sign-in__note">No account yet? A system admin creates accounts.</p>
      </div>
    </main>
  )
}
