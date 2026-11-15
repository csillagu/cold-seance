import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useParams } from 'react-router'
import { api } from '../api.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import type { GroupContext } from './group-context.ts'
import './pages.css'

type Group =
  | { state: 'loading' }
  | { state: 'loaded'; group: GroupContext }
  | { state: 'missing' }
  | { state: 'failed' }

/**
 * A group's page, at `/groups/<id>`: the group's name, and its members screen (SC-083) at
 * `/groups/<id>/members` and projects screen (SC-084) at `/groups/<id>/projects`, with a link to
 * each. The group is found among every group, which everyone may see (FR-122), so a group that
 * does not exist, or has been deleted, is said to be missing.
 */
export function GroupPage() {
  const { groupId = '' } = useParams()
  const toSignIn = useSignInRedirect()
  const [group, setGroup] = useState<Group>({ state: 'loading' })

  useEffect(() => {
    const abort = new AbortController()
    setGroup({ state: 'loading' })
    api<GroupContext[]>('/groups', { signal: abort.signal }).then(
      (groups) => {
        const found = groups.find((g) => g.id === groupId)
        setGroup(found === undefined ? { state: 'missing' } : { state: 'loaded', group: found })
      },
      (error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        setGroup({ state: 'failed' })
      },
    )
    return () => abort.abort()
  }, [groupId, toSignIn])

  switch (group.state) {
    case 'loading':
      return <p className="page__note">Loading…</p>
    case 'failed':
      return (
        <p role="alert" className="page__note">
          The group could not be loaded.
        </p>
      )
    case 'missing':
      return (
        <section className="page__notice" role="alert">
          <h1 className="page__notice-title">There is no such group</h1>
          <p className="page__note">
            <Link to="/groups">See every group</Link>
          </p>
        </section>
      )
    case 'loaded':
      break
  }
  return (
    <section>
      <div className="page__head">
        <h1 className="page__title">{group.group.name}</h1>
      </div>
      <nav className="page__views" aria-label="Group screens">
        <NavLink to="members" className="page__view-link">
          Members
        </NavLink>
        <NavLink to="projects" className="page__view-link">
          Projects
        </NavLink>
      </nav>
      <Outlet context={group.group} />
    </section>
  )
}
