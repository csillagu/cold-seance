import { type FormEvent, useEffect, useState } from 'react'
import { api } from '../api.ts'
import { formatWhen } from '../proposals/proposal.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { endOfDay, messageOf } from './accounts.ts'
import './accounts.css'
import './pages.css'

/** A personal access token as `/api/tokens` lists it: never its secret. */
export interface ApiToken {
  id: string
  createdAt: string
  expiresAt: string | null
}

type Loaded = { state: 'loading' } | { state: 'loaded'; tokens: ApiToken[] } | { state: 'failed' }

/**
 * The personal access token page (SC-078), at `/tokens`: the signed-in person creates, lists and
 * revokes their own API tokens (DD-048). A token's secret is shown once, when it is created; the
 * list shows only when each was created and when it expires.
 */
export function TokensPage() {
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [expiry, setExpiry] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string | undefined>()
  const [copied, setCopied] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | undefined>()

  useEffect(() => {
    const abort = new AbortController()
    api<ApiToken[]>('/tokens', { signal: abort.signal }).then(
      (tokens) => setLoaded({ state: 'loaded', tokens }),
      (error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        setLoaded({ state: 'failed' })
      },
    )
    return () => abort.abort()
  }, [toSignIn])

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setCreated(undefined)
    setCopied(false)
    setOutcome(undefined)
    try {
      const body = expiry === '' ? {} : { expiresAt: endOfDay(expiry).toISOString() }
      const answer = await api<{ token: ApiToken; secret: string }>('/tokens', {
        method: 'POST',
        body,
      })
      setLoaded((current) =>
        current.state === 'loaded'
          ? { state: 'loaded', tokens: [...current.tokens, answer.token] }
          : current,
      )
      setCreated(answer.secret)
      setExpiry('')
    } catch (error) {
      if (!toSignIn(error)) setOutcome({ ok: false, text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (token: ApiToken) => {
    setBusy(true)
    setOutcome(undefined)
    try {
      await api(`/tokens/${encodeURIComponent(token.id)}`, { method: 'DELETE' })
      setLoaded((current) =>
        current.state === 'loaded'
          ? { state: 'loaded', tokens: current.tokens.filter((t) => t.id !== token.id) }
          : current,
      )
      setOutcome({ ok: true, text: `The token created ${formatWhen(token.createdAt)} is revoked.` })
    } catch (error) {
      if (!toSignIn(error)) setOutcome({ ok: false, text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const copy = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
    } catch {
      // The browser refused; the token is still there to select and copy by hand.
    }
  }

  return (
    <section>
      <h1 className="page__title">API tokens</h1>
      <p className="page__note">
        A token lets a program use the REST API or the MCP server as you, with your role in each
        project.
      </p>

      <form
        className="account__card account__form"
        aria-labelledby="create-token"
        onSubmit={(event) => void create(event)}
      >
        <h2 className="account__card-title" id="create-token">
          Create a token
        </h2>
        <div className="account__fields">
          <div className="account__field">
            <label htmlFor="token-expiry">Expires at the end of (optional)</label>
            <input
              id="token-expiry"
              type="date"
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
            />
          </div>
          <button type="submit" className="account__button" disabled={busy}>
            Create token
          </button>
        </div>
      </form>

      {created !== undefined && (
        <div className="account__card account__secret" role="status" aria-label="New token">
          <p className="account__secret-note">
            Copy the new token now. It is shown only this once, and cannot be read again.
          </p>
          <div className="account__secret-row">
            <code className="account__mono account__secret-value" data-testid="token-secret">
              {created}
            </code>
            <button
              type="button"
              className="account__button account__button--quiet"
              onClick={() => void copy(created)}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {outcome !== undefined && (
        <p
          role={outcome.ok ? 'status' : 'alert'}
          className={outcome.ok ? 'account__done' : 'account__failed'}
        >
          {outcome.text}
        </p>
      )}

      <TokenList loaded={loaded} busy={busy} revoke={(token) => void revoke(token)} />
    </section>
  )
}

function TokenList({
  loaded,
  busy,
  revoke,
}: {
  loaded: Loaded
  busy: boolean
  revoke: (token: ApiToken) => void
}) {
  switch (loaded.state) {
    case 'loading':
      return <p className="page__note">Loading…</p>
    case 'failed':
      return (
        <p role="alert" className="page__note">
          The tokens could not be loaded.
        </p>
      )
    case 'loaded':
      break
  }
  if (loaded.tokens.length === 0) {
    return <p className="page__note">You have no tokens.</p>
  }
  return (
    <div className="account__scroll">
      <table className="account__table" aria-label="Your tokens">
        <thead>
          <tr>
            <th scope="col">Created</th>
            <th scope="col">Expires</th>
            <th scope="col">
              <span className="account__hidden">Revoke</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {loaded.tokens.map((token) => (
            <tr key={token.id}>
              <th scope="row" className="account__name">
                {formatWhen(token.createdAt)}
              </th>
              <td>{token.expiresAt === null ? 'Never' : formatWhen(token.expiresAt)}</td>
              <td className="account__end">
                <button
                  type="button"
                  className="account__button account__button--danger"
                  disabled={busy}
                  aria-label={`Revoke the token created ${formatWhen(token.createdAt)}`}
                  onClick={() => revoke(token)}
                >
                  Revoke
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
