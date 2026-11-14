import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { type Subject, type Subscriptions, stateOf, subscriptionPath } from './subscriptions.ts'
import './notifications.css'

/**
 * The subscription control (SC-093, FR-133): subscribes the signed-in person to a project or to a
 * task's GitHub issue, and unsubscribes them. A project their read-write or admin role subscribes
 * them to is shown as such, with nothing to unsubscribe, as the REST API refuses it. Each change is
 * sent to the REST API and the subscriptions are read afresh; a refusal is shown in its words.
 */
export function SubscriptionControl({ subject }: { subject: Subject }) {
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Subscriptions | 'unknown' | 'failed'>('unknown')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const path = subscriptionPath(subject)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const subscriptions = await api<Subscriptions>('/subscriptions', { signal })
        setLoaded(subscriptions)
      } catch (failure) {
        if (signal?.aborted || toSignIn(failure)) return
        setLoaded('failed')
      }
    },
    [toSignIn],
  )

  useEffect(() => {
    const abort = new AbortController()
    void load(abort.signal)
    return () => abort.abort()
  }, [load])

  const change = async (method: 'PUT' | 'DELETE') => {
    setBusy(true)
    setError(null)
    try {
      await api(path, method === 'PUT' ? { method, body: {} } : { method })
    } catch (failure) {
      if (toSignIn(failure)) return
      setError(
        failure instanceof ApiError ? failure.message : 'The change could not be saved. Try again.',
      )
    } finally {
      await load()
      setBusy(false)
    }
  }

  const state = typeof loaded === 'string' ? loaded : stateOf(loaded, subject)
  const name = subject.kind === 'project' ? subject.name : `issue #${subject.number}`

  return (
    <div className="subscription">
      {state === 'unknown' ? null : state === 'failed' ? (
        <span className="subscription__note">The subscription could not be loaded.</span>
      ) : state === 'none' ? (
        <button
          type="button"
          className="subscription__button"
          disabled={busy}
          onClick={() => void change('PUT')}
        >
          Subscribe to {name}
        </button>
      ) : state === 'automatic' ? (
        <span className="subscription__note">Subscribed through your role</span>
      ) : (
        <>
          <span className="subscription__note">Subscribed</span>
          <button
            type="button"
            className="subscription__button subscription__button--quiet"
            disabled={busy}
            onClick={() => void change('DELETE')}
          >
            Unsubscribe from {name}
          </button>
        </>
      )}
      {error ? (
        <span role="alert" className="subscription__error">
          {error}
        </span>
      ) : null}
    </div>
  )
}
