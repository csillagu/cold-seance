import { type FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api.ts'
import { fullName, parseFullName, type Repository } from '../repositories/repository.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { messageOf } from './accounts.ts'
import './accounts.css'
import './pages.css'
import './repositories.css'

type Loaded =
  | { state: 'loading' }
  | { state: 'loaded'; repositories: Repository[] }
  | { state: 'failed'; message: string }

/** Sorts repositories by owner and name, as the API lists them, for one registered on the screen. */
function byFullName(repositories: Repository[]): Repository[] {
  return repositories.toSorted((a, b) =>
    fullName(a).toLowerCase().localeCompare(fullName(b).toLowerCase()),
  )
}

/**
 * The repository registration screen (SC-085), at `/repositories`: anyone with an account
 * registers a repository the tool reaches on GitHub, through a GitHub App or a personal access
 * token, and that nobody has registered yet, and becomes its admin (FR-167). The person names the
 * repository as GitHub writes it, `owner/name`; the REST API refuses one that is already
 * registered or that the tool cannot reach, and the screen shows each refusal in the API's own
 * words. Below the form, every registered repository is listed with its admins, each leading to
 * its admins screen (SC-086).
 */
export function RepositoriesPage() {
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | undefined>()

  useEffect(() => {
    const abort = new AbortController()
    api<Repository[]>('/repositories', { signal: abort.signal }).then(
      (repositories) => setLoaded({ state: 'loaded', repositories }),
      (error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        setLoaded({ state: 'failed', message: messageOf(error) })
      },
    )
    return () => abort.abort()
  }, [toSignIn])

  const register = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const repository = parseFullName(name)
    if (repository === undefined) {
      setOutcome({ ok: false, text: 'Write the repository as owner/name.' })
      return
    }
    setBusy(true)
    try {
      const created = await api<Repository>('/repositories', {
        method: 'POST',
        body: repository,
      })
      setLoaded((current) =>
        current.state === 'loaded'
          ? { state: 'loaded', repositories: byFullName([...current.repositories, created]) }
          : current,
      )
      setOutcome({
        ok: true,
        text: `${fullName(created)} is registered, and you are its admin.`,
      })
      setName('')
    } catch (error) {
      if (!toSignIn(error)) setOutcome({ ok: false, text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h1 className="page__title">Repositories</h1>
      <p className="page__note">
        Register a GitHub repository the tool can reach, through its GitHub App or a personal access
        token, to become its admin. A repository is registered only once.
      </p>

      <form
        className="account__card account__form"
        aria-labelledby="register-repository"
        onSubmit={(event) => void register(event)}
      >
        <h2 className="account__card-title" id="register-repository">
          Register a repository
        </h2>
        <div className="account__fields">
          <div className="account__field">
            <label htmlFor="repository-name">Repository</label>
            <input
              id="repository-name"
              type="text"
              autoComplete="off"
              placeholder="owner/name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <button type="submit" className="account__button" disabled={busy}>
            Register
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

      <RepositoryList loaded={loaded} />
    </section>
  )
}

function RepositoryList({ loaded }: { loaded: Loaded }) {
  switch (loaded.state) {
    case 'loading':
      return <p className="page__note">Loading…</p>
    case 'failed':
      return (
        <p role="alert" className="page__note">
          The repositories could not be loaded. {loaded.message}
        </p>
      )
    case 'loaded':
      break
  }
  if (loaded.repositories.length === 0) {
    return <p className="page__note">No repository is registered yet.</p>
  }
  return (
    <div className="account__scroll">
      <table className="account__table" aria-label="Registered repositories">
        <thead>
          <tr>
            <th scope="col">Repository</th>
            <th scope="col">Admins</th>
          </tr>
        </thead>
        <tbody>
          {loaded.repositories.map((repository) => (
            <tr key={repository.id}>
              <th scope="row" className="account__name">
                <Link
                  to={`/repositories/${encodeURIComponent(repository.id)}`}
                  className="repositories__link"
                >
                  {fullName(repository)}
                </Link>
              </th>
              <td>{repository.admins.map((admin) => admin.username).join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
