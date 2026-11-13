import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, ApiError } from '../api.ts'
import { fullName, type Repository, type RepositoryAdmin } from '../repositories/repository.ts'
import { useSignedIn } from '../signed-in.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { messageOf } from './accounts.ts'
import './accounts.css'
import './members.css'
import './pages.css'
import './repositories.css'

type Loaded =
  | { state: 'loading' }
  | { state: 'loaded'; repository: Repository }
  | { state: 'missing' }
  | { state: 'failed' }

/**
 * The repository admins screen (SC-086), at `/repositories/<id>`: a registered repository's
 * admins. Its admins add other admins by username (FR-174) and remove other admins or step down
 * (FR-176); a system admin changes them without becoming one (FR-169). The REST API refuses any
 * change that would leave the repository without an admin, a system admin's included (FR-175), and
 * the screen shows that refusal in the API's own words. Everyone with an account reads the admins,
 * so that they know whom to ask about the repository; the controls are offered only to its admins
 * and to system admins, whom the REST API allows.
 */
export function RepositoryPage() {
  const { repositoryId = '' } = useParams()
  const signedIn = useSignedIn()
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | undefined>()
  const base = `/repositories/${encodeURIComponent(repositoryId)}`

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const repository = await api<Repository>(base, { signal })
        setLoaded({ state: 'loaded', repository })
      } catch (error) {
        if (signal?.aborted || toSignIn(error)) return
        // An address that is not a repository's id is refused with 400 before it is looked up.
        setLoaded(
          error instanceof ApiError && (error.status === 404 || error.status === 400)
            ? { state: 'missing' }
            : { state: 'failed' },
        )
      }
    },
    [base, toSignIn],
  )

  useEffect(() => {
    const abort = new AbortController()
    setLoaded({ state: 'loading' })
    setOutcome(undefined)
    void load(abort.signal)
    return () => abort.abort()
  }, [load])

  /** Runs one change, then shows the admins afresh and says how it went. */
  const change = async (request: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try {
      await request()
      setOutcome({ ok: true, text: done })
      await load()
      return true
    } catch (error) {
      if (!toSignIn(error)) setOutcome({ ok: false, text: messageOf(error) })
      return false
    } finally {
      setBusy(false)
    }
  }

  switch (loaded.state) {
    case 'loading':
      return (
        <section>
          <h1 className="page__title">Repository</h1>
          <p className="page__note">Loading…</p>
        </section>
      )
    case 'missing':
      return (
        <section className="page__notice">
          <h1 className="page__notice-title">Repository</h1>
          <p className="page__note">There is no such repository.</p>
          <p className="page__note">
            <Link to="/repositories">All repositories</Link>
          </p>
        </section>
      )
    case 'failed':
      return (
        <section>
          <h1 className="page__title">Repository</h1>
          <p role="alert" className="page__note">
            The repository could not be loaded.
          </p>
        </section>
      )
    case 'loaded':
      break
  }

  const { repository } = loaded
  const name = fullName(repository)
  const own = (admin: RepositoryAdmin) => admin.accountId === signedIn?.id
  const mayChange = signedIn !== undefined && (signedIn.systemAdmin || repository.admins.some(own))

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const added = await change(
      () => api<Repository>(`${base}/admins`, { method: 'POST', body: { username } }),
      `${username.trim()} is now an admin of ${name}.`,
    )
    if (added) setUsername('')
  }

  const remove = (admin: RepositoryAdmin) =>
    change(
      () => api(`${base}/admins/${encodeURIComponent(admin.accountId)}`, { method: 'DELETE' }),
      own(admin)
        ? `You are no longer an admin of ${name}.`
        : `${admin.username} is no longer an admin of ${name}.`,
    )

  return (
    <section>
      <p className="repositories__back">
        <Link to="/repositories">Repositories</Link>
      </p>
      <h1 className="page__title">{name}</h1>

      {mayChange && (
        <form
          className="account__card account__form"
          aria-labelledby="add-admin"
          onSubmit={(event) => void add(event)}
        >
          <h2 className="account__card-title" id="add-admin">
            Add an admin
          </h2>
          <div className="account__fields">
            <div className="account__field">
              <label htmlFor="admin-username">Username</label>
              <input
                id="admin-username"
                type="text"
                autoComplete="off"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <button type="submit" className="account__button" disabled={busy}>
              Add admin
            </button>
          </div>
        </form>
      )}

      {outcome !== undefined && (
        <p
          role={outcome.ok ? 'status' : 'alert'}
          className={outcome.ok ? 'account__done' : 'account__failed'}
        >
          {outcome.text}
        </p>
      )}

      <div className="account__scroll">
        <table className="account__table" aria-label={`Admins of ${name}`}>
          <thead>
            <tr>
              <th scope="col">Admin</th>
              {mayChange && (
                <th scope="col" className="account__end">
                  <span className="account__hidden">Remove</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {repository.admins.map((admin) => (
              <tr key={admin.accountId}>
                <th scope="row" className="account__name">
                  {admin.username}
                  {own(admin) && <span className="members__you">(you)</span>}
                </th>
                {mayChange && (
                  <td className="account__end">
                    <button
                      type="button"
                      className="account__button account__button--danger"
                      disabled={busy}
                      aria-label={own(admin) ? 'Step down' : `Remove ${admin.username}`}
                      onClick={() => void remove(admin)}
                    >
                      {own(admin) ? 'Step down' : 'Remove'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="page__note members__note">
        {mayChange
          ? 'A repository always keeps at least one admin: make someone else its admin before the last one steps down.'
          : 'Only its admins and system admins can change its admins.'}
      </p>
    </section>
  )
}
