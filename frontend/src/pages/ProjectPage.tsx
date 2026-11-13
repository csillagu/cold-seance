import { useEffect, useState } from 'react'
import { NavLink, Outlet, useParams } from 'react-router'
import { api, ApiError } from '../api.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import type { ProjectContext } from './project-context.ts'
import './pages.css'

/**
 * What the page says of a project that is not visible to the person (FR-017): the API's own words
 * for it (SC-051), so the two cannot drift apart. Also said for an address whose project id is
 * malformed, as the API answers a project that does not exist the same as one that is not visible.
 */
export const NOT_VISIBLE = 'This project is not visible to you'

type Project =
  | { state: 'loading' }
  | { state: 'loaded'; id: string; name: string }
  | { state: 'not-visible'; message: string }
  | { state: 'failed' }

/**
 * A project's page, at the address `/projects/<id>`: the place the project's views are shown in,
 * each at an address of its own below it, such as `/projects/<id>/kanban`, `/projects/<id>/gantt`, `/projects/<id>/load`, `/projects/<id>/variance` or `/projects/<id>/proposals`, with a
 * link to each, its members and roles screen (SC-080) at `/projects/<id>/members`, and the screen
 * that creates a task in it (SC-098) at `/projects/<id>/tasks/new`.
 * Someone the project is not visible to is told so explicitly, and shown nothing of it (FR-017).
 */
export function ProjectPage() {
  const { projectId = '' } = useParams()
  const toSignIn = useSignInRedirect()
  const [project, setProject] = useState<Project>({ state: 'loading' })

  useEffect(() => {
    const abort = new AbortController()
    setProject({ state: 'loading' })
    api<{ id: string; name: string }>(`/projects/${encodeURIComponent(projectId)}`, {
      signal: abort.signal,
    }).then(
      (found) => setProject({ state: 'loaded', ...found }),
      (error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        if (error instanceof ApiError && error.status === 403 && error.error === 'Not Visible') {
          setProject({ state: 'not-visible', message: error.message })
        } else if (error instanceof ApiError && error.status === 400) {
          setProject({ state: 'not-visible', message: NOT_VISIBLE })
        } else {
          setProject({ state: 'failed' })
        }
      },
    )
    return () => abort.abort()
  }, [projectId, toSignIn])

  switch (project.state) {
    case 'loading':
      return <p className="page__note">Loading…</p>
    case 'failed':
      return (
        <p role="alert" className="page__note">
          The project could not be loaded.
        </p>
      )
    case 'not-visible':
      return (
        <section className="page__notice" role="alert">
          <h1 className="page__notice-title">{project.message}</h1>
        </section>
      )
    case 'loaded':
      break
  }
  const context: ProjectContext = { id: project.id, name: project.name }
  return (
    <section>
      <h1 className="page__title">{project.name}</h1>
      <nav className="page__views" aria-label="Views">
        <NavLink to="kanban" className="page__view-link">
          Kanban
        </NavLink>
        <NavLink to="gantt" className="page__view-link">
          Gantt
        </NavLink>
        <NavLink to="load" className="page__view-link">
          Person load
        </NavLink>
        <NavLink to="variance" className="page__view-link">
          Baseline variance
        </NavLink>
        <NavLink to="proposals" className="page__view-link">
          Proposals
        </NavLink>
        <NavLink to="members" className="page__view-link">
          Members
        </NavLink>
        <NavLink to="tasks/new" className="page__view-link">
          New task
        </NavLink>
      </nav>
      <Outlet context={context} />
    </section>
  )
}
