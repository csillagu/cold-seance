import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api.ts'
import { fullName } from '../repositories/repository.ts'
import { closedBy, inboxOf, type RepositoryRequest, requestName } from '../repositories/request.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { messageOf } from './accounts.ts'
import './accounts.css'
import './pages.css'
import './repositories.css'
import './repository-requests.css'

type Loaded =
  | { state: 'loading' }
  | { state: 'loaded'; requests: RepositoryRequest[] }
  | { state: 'failed'; message: string }

/** A decision the inbox sends, as the REST API names it, and how its outcome is told. */
const DECISIONS = {
  approve: (request: RepositoryRequest) =>
    `${fullName(request.repository)} is added to ${request.project.name}.`,
  reject: (request: RepositoryRequest) =>
    `${request.project.name}'s request for ${fullName(request.repository)} is rejected.`,
  withdraw: (request: RepositoryRequest) =>
    `${request.project.name} no longer pulls issues from ${fullName(request.repository)}.`,
} as const

type Decision = keyof typeof DECISIONS

/**
 * The repository request inbox (SC-087), at `/repository-requests`: the requests of projects to
 * add a repository the signed-in person is an admin of. They approve a waiting request, which adds
 * the repository to the project, one admin's approval being enough (FR-168); reject it, which
 * leaves the repository out of the project (FR-171); or withdraw an approval given earlier, after
 * which the project no longer pulls the repository's issues (FR-172). The rejected and withdrawn
 * requests are listed below, with who closed them. The REST API lists only the requests for the
 * repositories the caller administers and decides what is allowed; the screen shows each refusal
 * in the API's own words.
 */
export function RepositoryRequestsPage() {
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | undefined>()

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const requests = await api<RepositoryRequest[]>('/repository-requests', { signal })
        setLoaded({ state: 'loaded', requests })
      } catch (error) {
        if (signal?.aborted || toSignIn(error)) return
        setLoaded({ state: 'failed', message: messageOf(error) })
      }
    },
    [toSignIn],
  )

  useEffect(() => {
    const abort = new AbortController()
    void load(abort.signal)
    return () => abort.abort()
  }, [load])

  /** Sends one decision, then lists the requests afresh and says how it went. */
  const decide = async (request: RepositoryRequest, decision: Decision) => {
    setBusy(true)
    try {
      await api<RepositoryRequest>(
        `/repository-requests/${encodeURIComponent(request.id)}/${decision}`,
        { method: 'POST', body: {} },
      )
      setOutcome({ ok: true, text: DECISIONS[decision](request) })
    } catch (error) {
      if (toSignIn(error)) return
      setOutcome({ ok: false, text: messageOf(error) })
    } finally {
      // Listed afresh either way: a refusal may mean another admin has decided meanwhile.
      await load()
      setBusy(false)
    }
  }

  const title = <h1 className="page__title">Repository requests</h1>

  switch (loaded.state) {
    case 'loading':
      return (
        <section>
          {title}
          <p className="page__note">Loading…</p>
        </section>
      )
    case 'failed':
      return (
        <section>
          {title}
          <p role="alert" className="page__note">
            The requests could not be loaded: {loaded.message}
          </p>
        </section>
      )
    case 'loaded':
      break
  }

  const inbox = inboxOf(loaded.requests)

  return (
    <section>
      {title}
      <p className="page__note">
        Projects ask here to add a repository you are an admin of, to pull its issues and be seeded
        from it. One admin&apos;s approval is enough.
      </p>

      {outcome !== undefined && (
        <p
          role={outcome.ok ? 'status' : 'alert'}
          className={outcome.ok ? 'account__done' : 'account__failed'}
        >
          {outcome.text}
        </p>
      )}

      {loaded.requests.length === 0 ? (
        <p className="page__note requests__empty">
          No project has asked for a repository you are an admin of.
        </p>
      ) : (
        <>
          <RequestTable
            title="Waiting for approval"
            empty="No request is waiting."
            requests={inbox.waiting}
            by={(request) => `Asked by ${request.requestedBy.username}`}
            actions={(request) => (
              <>
                <button
                  type="button"
                  className="account__button"
                  disabled={busy}
                  aria-label={`Approve ${requestName(request)}`}
                  onClick={() => void decide(request, 'approve')}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="account__button account__button--danger"
                  disabled={busy}
                  aria-label={`Reject ${requestName(request)}`}
                  onClick={() => void decide(request, 'reject')}
                >
                  Reject
                </button>
              </>
            )}
          />
          <RequestTable
            title="Approved"
            empty="No approval is in force."
            requests={inbox.approved}
            by={(request) => `Approved by ${request.decidedBy?.username ?? 'an admin'}`}
            actions={(request) => (
              <button
                type="button"
                className="account__button account__button--danger"
                disabled={busy}
                aria-label={`Withdraw the approval of ${requestName(request)}`}
                onClick={() => void decide(request, 'withdraw')}
              >
                Withdraw approval
              </button>
            )}
          />
          {inbox.closed.length > 0 && (
            <RequestTable title="Rejected and withdrawn" requests={inbox.closed} by={closedBy} />
          )}
        </>
      )}
    </section>
  )
}

/** One table of the inbox: each request's project, repository and who did what last. */
function RequestTable({
  title,
  empty,
  requests,
  by,
  actions,
}: {
  title: string
  empty?: string
  requests: RepositoryRequest[]
  by: (request: RepositoryRequest) => string
  actions?: (request: RepositoryRequest) => ReactNode
}) {
  const id = `requests-${title.toLowerCase().replaceAll(' ', '-')}`
  return (
    <div className="requests__group">
      <h2 className="requests__heading" id={id}>
        {title}
      </h2>
      {requests.length === 0 ? (
        <p className="page__note">{empty}</p>
      ) : (
        <div className="account__scroll">
          <table className="account__table" aria-labelledby={id}>
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Repository</th>
                <th scope="col">By</th>
                {actions !== undefined && (
                  <th scope="col" className="account__end">
                    <span className="account__hidden">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <th scope="row" className="account__name">
                    {request.project.name}
                  </th>
                  <td>
                    <Link
                      className="repositories__link"
                      to={`/repositories/${encodeURIComponent(request.repository.id)}`}
                    >
                      {fullName(request.repository)}
                    </Link>
                  </td>
                  <td>{by(request)}</td>
                  {actions !== undefined && (
                    <td className="account__end">
                      <span className="requests__actions">{actions(request)}</span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
