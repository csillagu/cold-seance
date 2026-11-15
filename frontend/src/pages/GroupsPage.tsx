import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api.ts'
import { useSignedIn } from '../signed-in.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { messageOf } from './accounts.ts'
import type { GroupContext as Group } from './group-context.ts'
import './accounts.css'
import './groups.css'
import './pages.css'

type Loaded =
  { state: 'loading' } | { state: 'loaded'; groups: Group[] } | { state: 'failed'; message: string }

/**
 * The group list screen (SC-082), at `/groups`: every group, shown to everyone signed in whether
 * or not they are a member of it (FR-122), each leading to its members and projects screens
 * (SC-083, SC-084). Anyone signed in creates a group on it (FR-121), and becomes its admin. A
 * system admin, and no one else, is offered a delete action on each group (FR-126); it asks to be
 * confirmed before the group is deleted, as a deletion cannot be undone. The REST API's refusals
 * are shown in its own words.
 */
export function GroupsPage() {
  const signedIn = useSignedIn()
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<string | undefined>()
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | undefined>()

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setLoaded({ state: 'loaded', groups: await api<Group[]>('/groups', { signal }) })
      } catch (error) {
        if (signal?.aborted || toSignIn(error)) return
        setLoaded({ state: 'failed', message: 'The groups could not be loaded.' })
      }
    },
    [toSignIn],
  )

  useEffect(() => {
    const abort = new AbortController()
    void load(abort.signal)
    return () => abort.abort()
  }, [load])

  /** Runs one change, then lists the groups afresh and says how it went. */
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

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const created = await change(
      () => api<Group>('/groups', { method: 'POST', body: { name } }),
      `Group ${name.trim()} is created, and you are its admin.`,
    )
    if (created) setName('')
  }

  const remove = async (group: Group) => {
    setConfirming(undefined)
    await change(
      () => api(`/groups/${encodeURIComponent(group.id)}`, { method: 'DELETE' }),
      `Group ${group.name} is deleted. Its projects stay.`,
    )
  }

  const systemAdmin = signedIn?.systemAdmin === true

  return (
    <section>
      <h1 className="page__title">Groups</h1>
      <p className="page__note">
        Every group is listed for everyone. A group gives its members their group role on each of
        its projects.
      </p>

      <form
        className="account__card account__form"
        aria-labelledby="create-group"
        onSubmit={(event) => void create(event)}
      >
        <h2 className="account__card-title" id="create-group">
          Create a group
        </h2>
        <div className="account__fields">
          <div className="account__field">
            <label htmlFor="new-group-name">Group name</label>
            <input
              id="new-group-name"
              type="text"
              autoComplete="off"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <button type="submit" className="account__button" disabled={busy}>
            Create group
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

      {loaded.state === 'loading' && <p className="page__note">Loading…</p>}
      {loaded.state === 'failed' && (
        <p role="alert" className="page__note">
          {loaded.message}
        </p>
      )}
      {loaded.state === 'loaded' &&
        (loaded.groups.length === 0 ? (
          <p className="page__note">No groups yet.</p>
        ) : (
          <div className="account__scroll">
            <table className="account__table" aria-label="Groups">
              <thead>
                <tr>
                  <th scope="col">Group</th>
                  <th scope="col">Screens</th>
                  {systemAdmin && (
                    <th scope="col" className="account__end">
                      <span className="account__hidden">Delete</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {loaded.groups.map((group) => (
                  <tr key={group.id}>
                    <th scope="row" className="account__name">
                      <Link to={`/groups/${group.id}/members`}>{group.name}</Link>
                    </th>
                    <td>
                      <span className="groups__links">
                        <Link to={`/groups/${group.id}/members`}>Members</Link>
                        <Link to={`/groups/${group.id}/projects`}>Projects</Link>
                      </span>
                    </td>
                    {systemAdmin && (
                      <td className="account__end">
                        {confirming === group.id ? (
                          <span className="groups__confirm">
                            <button
                              type="button"
                              className="account__button account__button--danger"
                              disabled={busy}
                              onClick={() => void remove(group)}
                            >
                              Delete {group.name} for good
                            </button>
                            <button
                              type="button"
                              className="account__button account__button--quiet"
                              onClick={() => setConfirming(undefined)}
                            >
                              Keep it
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="account__button account__button--danger"
                            disabled={busy}
                            aria-label={`Delete ${group.name}`}
                            onClick={() => setConfirming(group.id)}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  )
}
