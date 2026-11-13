import { type FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, ApiError } from '../api.ts'
import type { SignedInAccount } from '../signed-in.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { messageOf } from './accounts.ts'
import './accounts.css'
import './pages.css'

/** An account as `GET /api/accounts` lists it. */
type Account = SignedInAccount

type Loaded =
  | { state: 'loading' }
  | { state: 'loaded'; accounts: Account[] }
  | { state: 'refused'; message: string }
  | { state: 'failed' }

/** Sorts accounts by username, as the API lists them, for an account added on the screen. */
function byUsername(accounts: Account[]): Account[] {
  return accounts.toSorted((a, b) => a.username.localeCompare(b.username))
}

/**
 * The account administration screen (SC-076), at `/accounts`: a system admin creates accounts
 * (FR-117) and makes other people system admins (FR-140), and opens each person's GitHub account
 * link (SC-077). There is no other way to create an account (DD-027). Someone who is not a system
 * admin is not led here, and if they open it, is told that only system admins administer accounts
 * and offered nothing: the REST API refuses them the list.
 */
export function AccountsPage() {
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | undefined>()

  useEffect(() => {
    const abort = new AbortController()
    api<Account[]>('/accounts', { signal: abort.signal }).then(
      (accounts) => setLoaded({ state: 'loaded', accounts }),
      (error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        if (error instanceof ApiError && error.status === 403) {
          setLoaded({ state: 'refused', message: error.message })
        } else {
          setLoaded({ state: 'failed' })
        }
      },
    )
    return () => abort.abort()
  }, [toSignIn])

  const replace = (account: Account) =>
    setLoaded((current) =>
      current.state === 'loaded'
        ? {
            state: 'loaded',
            accounts: byUsername([...current.accounts.filter((a) => a.id !== account.id), account]),
          }
        : current,
    )

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    try {
      const created = await api<Account>('/accounts', {
        method: 'POST',
        body: { username, password },
      })
      replace(created)
      setOutcome({ ok: true, text: `Account ${created.username} created.` })
      setUsername('')
      setPassword('')
    } catch (error) {
      if (!toSignIn(error)) setOutcome({ ok: false, text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const makeSystemAdmin = async (account: Account) => {
    setBusy(true)
    try {
      const made = await api<Account>('/accounts/system-admins', {
        method: 'POST',
        body: { accountId: account.id },
      })
      replace(made)
      setOutcome({ ok: true, text: `${made.username} is now a system admin.` })
    } catch (error) {
      if (!toSignIn(error)) setOutcome({ ok: false, text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const title = <h1 className="page__title">Accounts</h1>
  switch (loaded.state) {
    case 'loading':
      return (
        <section>
          {title}
          <p className="page__note">Loading…</p>
        </section>
      )
    case 'refused':
      return (
        <section className="page__notice">
          <h1 className="page__notice-title">Accounts</h1>
          <p className="page__note">{loaded.message}.</p>
        </section>
      )
    case 'failed':
      return (
        <section>
          {title}
          <p role="alert" className="page__note">
            The accounts could not be loaded.
          </p>
        </section>
      )
    case 'loaded':
      break
  }

  return (
    <section>
      {title}
      <p className="page__note">
        Only system admins create accounts and make other people system admins.
      </p>

      <form
        className="account__card account__form"
        aria-labelledby="create-account"
        onSubmit={(event) => void create(event)}
      >
        <h2 className="account__card-title" id="create-account">
          Create an account
        </h2>
        <div className="account__fields">
          <div className="account__field">
            <label htmlFor="new-username">Username</label>
            <input
              id="new-username"
              type="text"
              autoComplete="off"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="account__field">
            <label htmlFor="new-password">Password</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <button type="submit" className="account__button" disabled={busy}>
            Create account
          </button>
        </div>
      </form>

      {outcome !== undefined && (
        <p
          role={outcome.ok ? 'status' : 'alert'}
          className={outcome.ok ? 'account__done' : 'account__failed'}
        >
          {outcome.text}
        </p>
      )}

      <div className="account__scroll">
        <table className="account__table" aria-label="Accounts">
          <thead>
            <tr>
              <th scope="col">Username</th>
              <th scope="col">Role</th>
              <th scope="col">GitHub account</th>
            </tr>
          </thead>
          <tbody>
            {loaded.accounts.map((account) => (
              <tr key={account.id}>
                <th scope="row" className="account__name">
                  {account.username}
                </th>
                <td>
                  {account.systemAdmin ? (
                    <span className="account__tag">System admin</span>
                  ) : (
                    <button
                      type="button"
                      className="account__button account__button--quiet"
                      disabled={busy}
                      aria-label={`Make ${account.username} a system admin`}
                      onClick={() => void makeSystemAdmin(account)}
                    >
                      Make system admin
                    </button>
                  )}
                </td>
                <td>
                  <Link
                    to={`/accounts/${account.id}/github`}
                    aria-label={`GitHub account of ${account.username}`}
                  >
                    GitHub account
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
