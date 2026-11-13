import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api.ts'
import { useProjectsChanged } from '../projects-changed.ts'
import { useSignedIn } from '../signed-in.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { messageOf } from './accounts.ts'
import { useProject } from './project-context.ts'
import { isRole, type Role, ROLE_WORDS, ROLES } from './roles.ts'
import './accounts.css'
import './members.css'
import './pages.css'

/** A member as `GET /api/projects/<id>/members` lists them. */
interface Member {
  accountId: string
  username: string
  role: Role
}

type Loaded =
  | { state: 'loading' }
  | { state: 'loaded'; members: Member[] }
  | { state: 'failed'; message: string }

/**
 * The project members and roles screen (SC-080), at `/projects/<id>/members`, inside the project's
 * page: the people who hold a role in the project directly, each with their role, one of four
 * (FR-105). The project's admin adds people by username, changes their roles and removes them
 * (FR-109); the REST API refuses anyone else, and refuses to remove or demote the project's last
 * admin (FR-110), and the screen shows each refusal in the API's own words. The controls are shown
 * to everyone who can read the members, as someone may be the project's admin through a group
 * (FR-111) without being listed here as one.
 */
export function MembersPage() {
  const project = useProject()
  const signedIn = useSignedIn()
  const toSignIn = useSignInRedirect()
  const projectsChanged = useProjectsChanged()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<Role>('read-only')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | undefined>()
  const base = `/projects/${encodeURIComponent(project.id)}/members`

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const members = await api<Member[]>(base, { signal })
        setLoaded({ state: 'loaded', members })
      } catch (error) {
        if (signal?.aborted || toSignIn(error)) return
        setLoaded({
          state: 'failed',
          message:
            error instanceof ApiError && error.status === 403
              ? error.message
              : 'The members could not be loaded.',
        })
      }
    },
    [base, toSignIn],
  )

  useEffect(() => {
    const abort = new AbortController()
    setLoaded({ state: 'loading' })
    void load(abort.signal)
    return () => abort.abort()
  }, [load])

  /** Runs one change, then shows the members afresh and says how it went. */
  const change = async (request: () => Promise<unknown>, done: string, leaving = false) => {
    setBusy(true)
    try {
      await request()
      setOutcome({ ok: true, text: done })
      if (leaving) projectsChanged()
      await load()
      return true
    } catch (error) {
      if (!toSignIn(error)) setOutcome({ ok: false, text: messageOf(error) })
      return false
    } finally {
      setBusy(false)
    }
  }

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const added = await change(
      () => api<Member>(base, { method: 'POST', body: { username, role } }),
      `${username.trim()} is now ${ROLE_WORDS[role].toLowerCase()} in ${project.name}.`,
    )
    if (added) setUsername('')
  }

  const setRoleOf = (member: Member, next: Role) =>
    change(
      () =>
        api<Member>(`${base}/${encodeURIComponent(member.accountId)}`, {
          method: 'PUT',
          body: { role: next },
        }),
      `${member.username} is now ${ROLE_WORDS[next].toLowerCase()} in ${project.name}.`,
      member.accountId === signedIn?.id,
    )

  const remove = (member: Member) =>
    change(
      () => api(`${base}/${encodeURIComponent(member.accountId)}`, { method: 'DELETE' }),
      `${member.username} is no longer a member of ${project.name}.`,
      member.accountId === signedIn?.id,
    )

  if (loaded.state === 'loading') return <p className="page__note">Loading…</p>

  return (
    <section>
      {loaded.state === 'loaded' && (
        <form
          className="account__card account__form"
          aria-labelledby="add-member"
          onSubmit={(event) => void add(event)}
        >
          <h2 className="account__card-title" id="add-member">
            Add a member
          </h2>
          <div className="account__fields">
            <div className="account__field">
              <label htmlFor="member-username">Username</label>
              <input
                id="member-username"
                type="text"
                autoComplete="off"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="account__field">
              <label htmlFor="member-role">Role</label>
              <select
                id="member-role"
                value={role}
                onChange={(event) => {
                  if (isRole(event.target.value)) setRole(event.target.value)
                }}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_WORDS[r]}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="account__button" disabled={busy}>
              Add member
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

      {loaded.state === 'failed' ? (
        <p role="alert" className="page__note">
          {loaded.message}
        </p>
      ) : (
        <>
          <div className="account__scroll">
            <table className="account__table" aria-label={`Members of ${project.name}`}>
              <thead>
                <tr>
                  <th scope="col">Username</th>
                  <th scope="col">Role</th>
                  <th scope="col" className="account__end">
                    <span className="account__hidden">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loaded.members.map((member) => (
                  <tr key={member.accountId}>
                    <th scope="row" className="account__name">
                      {member.username}
                      {member.accountId === signedIn?.id && (
                        <span className="members__you">(you)</span>
                      )}
                    </th>
                    <td>
                      <select
                        className="members__select"
                        aria-label={`Role of ${member.username}`}
                        value={member.role}
                        disabled={busy}
                        onChange={(event) => {
                          if (isRole(event.target.value)) void setRoleOf(member, event.target.value)
                        }}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_WORDS[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="account__end">
                      <button
                        type="button"
                        className="account__button account__button--danger"
                        disabled={busy}
                        aria-label={`Remove ${member.username}`}
                        onClick={() => void remove(member)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="page__note members__note">
            Only the project’s admins can add, change and remove members. A project always keeps at
            least one admin. Roles held through groups are not listed here.
          </p>
        </>
      )}
    </section>
  )
}
