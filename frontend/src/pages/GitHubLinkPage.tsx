import { type FormEvent, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { api, ApiError } from '../api.ts'
import { type SignedInAccount, useSignedIn } from '../signed-in.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { messageOf } from './accounts.ts'
import './accounts.css'
import './pages.css'

/** A GitHub account link, as `/api/accounts/<id>/github` gives it. */
interface Link {
  accountId: string
  githubLogin: string | null
}

type Loaded =
  | { state: 'loading' }
  | { state: 'loaded'; githubLogin: string | null; username: string | undefined }
  | { state: 'refused'; message: string }
  | { state: 'failed' }

/**
 * The GitHub account link setting (SC-077): a person links their own account in the tool to their
 * GitHub account, given by its name (FR-135, SRC-202), at `/settings/github`; a system admin does
 * the same for someone else at `/accounts/<id>/github`, which the account administration screen
 * (SC-076) leads to. The REST API decides who may read and set which link.
 */
export function GitHubLinkPage() {
  const { accountId: other } = useParams()
  const signedIn = useSignedIn()
  const accountId = other ?? signedIn?.id
  const own = accountId !== undefined && accountId === signedIn?.id
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [login, setLogin] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | undefined>()

  useEffect(() => {
    if (accountId === undefined) return undefined
    const abort = new AbortController()
    const signal = abort.signal
    setLoaded({ state: 'loading' })
    setOutcome(undefined)
    // Someone else's username comes from the account list, which only system admins can read.
    const username = own
      ? Promise.resolve(signedIn?.username)
      : api<SignedInAccount[]>('/accounts', { signal }).then(
          (accounts) => accounts.find((account) => account.id === accountId)?.username,
          () => undefined,
        )
    Promise.all([
      api<Link>(`/accounts/${encodeURIComponent(accountId)}/github`, { signal }),
      username,
    ]).then(
      ([link, name]) => {
        setLoaded({ state: 'loaded', githubLogin: link.githubLogin, username: name })
        setLogin(link.githubLogin ?? '')
      },
      (error: unknown) => {
        if (signal.aborted || toSignIn(error)) return
        if (error instanceof ApiError && error.status < 500) {
          setLoaded({ state: 'refused', message: error.message })
        } else {
          setLoaded({ state: 'failed' })
        }
      },
    )
    return () => abort.abort()
  }, [accountId, own, signedIn?.username, toSignIn])

  const save = async (id: string, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    try {
      const link = await api<Link>(`/accounts/${encodeURIComponent(id)}/github`, {
        method: 'PUT',
        body: { githubLogin: login },
      })
      setLoaded((current) =>
        current.state === 'loaded' ? { ...current, githubLogin: link.githubLogin } : current,
      )
      setLogin(link.githubLogin ?? '')
      setOutcome({ ok: true, text: `Linked to the GitHub account ${link.githubLogin ?? ''}.` })
    } catch (error) {
      if (!toSignIn(error)) setOutcome({ ok: false, text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const title = own
    ? 'Your GitHub account'
    : loaded.state === 'loaded' && loaded.username !== undefined
      ? `GitHub account of ${loaded.username}`
      : 'GitHub account'

  if (accountId === undefined || loaded.state === 'loading') {
    return (
      <section>
        <h1 className="page__title">{title}</h1>
        <p className="page__note">Loading…</p>
      </section>
    )
  }
  if (loaded.state === 'refused') {
    return (
      <section className="page__notice">
        <h1 className="page__notice-title">{title}</h1>
        <p className="page__note">{loaded.message}.</p>
      </section>
    )
  }
  if (loaded.state === 'failed') {
    return (
      <section>
        <h1 className="page__title">{title}</h1>
        <p role="alert" className="page__note">
          The GitHub account could not be loaded.
        </p>
      </section>
    )
  }

  return (
    <section>
      <h1 className="page__title">{title}</h1>
      <p className="page__note" data-testid="github-link">
        {loaded.githubLogin === null ? (
          'Not linked to a GitHub account.'
        ) : (
          <>
            Linked to the GitHub account <span className="account__mono">{loaded.githubLogin}</span>
            .
          </>
        )}
      </p>

      <form
        className="account__card account__form"
        onSubmit={(event) => void save(accountId, event)}
      >
        <div className="account__fields">
          <div className="account__field">
            <label htmlFor="github-login">GitHub account name</label>
            <input
              id="github-login"
              type="text"
              autoComplete="off"
              spellCheck={false}
              required
              value={login}
              onChange={(event) => setLogin(event.target.value)}
            />
          </div>
          <button type="submit" className="account__button" disabled={busy}>
            Link
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
    </section>
  )
}
