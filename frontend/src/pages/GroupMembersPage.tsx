import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, ApiError } from '../api.ts'
import { useSignedIn } from '../signed-in.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { messageOf } from './accounts.ts'
import { useGroup } from './group-context.ts'
import { isRole, type Role, ROLE_WORDS, ROLES } from './roles.ts'
import './accounts.css'
import './groups.css'
import './members.css'
import './pages.css'

/** A member as `GET /api/groups/<id>/members` lists them. */
interface Member {
  accountId: string
  username: string
  role: Role
}

type Loaded =
  | { state: 'loading' }
  | { state: 'loaded'; members: Member[] }
  | { state: 'failed'; message: string }
  | { state: 'left' }

/**
 * The group members screen (SC-083), at `/groups/<id>/members`, inside the group's page: the
 * group's members, each with their role, one of the four a project has (SRC-139). A member who
 * holds the admin role in the group adds people by username with a role, changes their roles and
 * removes them (FR-124); the others see the members without those controls. Any member leaves the
 * group (FR-125), except its last admin, whom the REST API refuses (FR-160); the screen shows each
 * refusal in the API's own words. Someone who is not a member is told, in the API's words, that
 * only members see the members.
 */
export function GroupMembersPage() {
  const group = useGroup()
  const signedIn = useSignedIn()
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<Role>('read-only')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | undefined>()
  const base = `/groups/${encodeURIComponent(group.id)}/members`

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setLoaded({ state: 'loaded', members: await api<Member[]>(base, { signal }) })
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

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const added = await change(
      () => api<Member>(base, { method: 'POST', body: { username, role } }),
      `${username.trim()} is now ${ROLE_WORDS[role].toLowerCase()} in ${group.name}.`,
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
      `${member.username} is now ${ROLE_WORDS[next].toLowerCase()} in ${group.name}.`,
    )

  const remove = (member: Member) =>
    change(
      () => api(`${base}/${encodeURIComponent(member.accountId)}`, { method: 'DELETE' }),
      `${member.username} is no longer a member of ${group.name}.`,
    )

  const leave = async () => {
    setBusy(true)
    try {
      await api(`/groups/${encodeURIComponent(group.id)}/leave`, { method: 'POST' })
      setOutcome(undefined)
      setLoaded({ state: 'left' })
    } catch (error) {
      if (!toSignIn(error)) setOutcome({ ok: false, text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }

  if (loaded.state === 'loading') return <p className="page__note">Loading…</p>
  if (loaded.state === 'left') {
    return (
      <p role="status" className="account__done">
        You have left {group.name}. <Link to="/groups">See every group</Link>
      </p>
    )
  }

  const own =
    loaded.state === 'loaded' ? loaded.members.find((m) => m.accountId === signedIn?.id) : undefined
  const admin = own?.role === 'admin'

  return (
    <section>
      {admin && (
        <form
          className="account__card account__form"
          aria-labelledby="add-group-member"
          onSubmit={(event) => void add(event)}
        >
          <h2 className="account__card-title" id="add-group-member">
            Add a member
          </h2>
          <div className="account__fields">
            <div className="account__field">
              <label htmlFor="group-member-username">Username</label>
              <input
                id="group-member-username"
                type="text"
                autoComplete="off"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="account__field">
              <label htmlFor="group-member-role">Role</label>
              <select
                id="group-member-role"
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
            <table className="account__table" aria-label={`Members of ${group.name}`}>
              <thead>
                <tr>
                  <th scope="col">Username</th>
                  <th scope="col">Role</th>
                  {admin && (
                    <th scope="col" className="account__end">
                      <span className="account__hidden">Remove</span>
                    </th>
                  )}
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
                      {admin ? (
                        <select
                          className="members__select"
                          aria-label={`Role of ${member.username}`}
                          value={member.role}
                          disabled={busy}
                          onChange={(event) => {
                            if (isRole(event.target.value)) {
                              void setRoleOf(member, event.target.value)
                            }
                          }}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_WORDS[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span aria-label={`Role of ${member.username}`}>
                          {ROLE_WORDS[member.role]}
                        </span>
                      )}
                    </td>
                    {admin && (
                      <td className="account__end">
                        {member.accountId !== signedIn?.id && (
                          <button
                            type="button"
                            className="account__button account__button--danger"
                            disabled={busy}
                            aria-label={`Remove ${member.username}`}
                            onClick={() => void remove(member)}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {own !== undefined && (
            <div className="groups__leave">
              <button
                type="button"
                className="account__button account__button--quiet"
                disabled={busy}
                onClick={() => void leave()}
              >
                Leave {group.name}
              </button>
            </div>
          )}
          <p className="page__note members__note">
            Only the group’s admins can add, change and remove members. Each member holds their
            group role on every project of the group. A group always keeps at least one admin.
          </p>
        </>
      )}
    </section>
  )
}
