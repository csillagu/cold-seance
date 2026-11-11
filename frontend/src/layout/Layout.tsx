import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { api } from '../api.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import './layout.css'

/** A project as the API lists it. */
interface ProjectSummary {
  id: string
  name: string
}

type Projects =
  { state: 'loading' } | { state: 'loaded'; projects: ProjectSummary[] } | { state: 'failed' }

/**
 * The frontend's layout (SC-113): a header and navigation around the area in which the pages,
 * screens and views are shown (SRC-219). Every page, screen and view but the sign-in page is shown
 * inside it (SRC-223), and each can be reached from the navigation (SRC-222). The header's project
 * search bar (SC-114) and signed-in person menu (SC-115) are components of their own.
 *
 * Someone who is not signed in is sent to the sign-in page, and comes back here once signed in.
 */
export function Layout() {
  const toSignIn = useSignInRedirect()
  const [projects, setProjects] = useState<Projects>({ state: 'loading' })

  useEffect(() => {
    const abort = new AbortController()
    api<ProjectSummary[]>('/projects', { signal: abort.signal }).then(
      (list) => setProjects({ state: 'loaded', projects: list }),
      (error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        setProjects({ state: 'failed' })
      },
    )
    return () => abort.abort()
  }, [toSignIn])

  return (
    <div className="layout">
      <header className="layout__header">
        <Link to="/" className="layout__brand">
          <span className="layout__mark" aria-hidden="true" />
          cold-seance
        </Link>
        <div className="layout__header-end" />
      </header>
      <div className="layout__body">
        <nav className="layout__nav" aria-label="Navigation">
          <NavLink to="/" end className="layout__link">
            Start
          </NavLink>
          <h2 className="layout__nav-heading" id="nav-projects">
            Projects
          </h2>
          <ProjectLinks projects={projects} />
        </nav>
        <main className="layout__content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function ProjectLinks({ projects }: { projects: Projects }) {
  switch (projects.state) {
    case 'loading':
      return <p className="layout__nav-note">Loading…</p>
    case 'failed':
      return <p className="layout__nav-note">The projects could not be loaded.</p>
    case 'loaded':
      break
  }
  if (projects.projects.length === 0) {
    return <p className="layout__nav-note">No projects yet.</p>
  }
  return (
    <ul className="layout__nav-list" aria-labelledby="nav-projects">
      {projects.projects.map((project) => (
        <li key={project.id}>
          <NavLink to={`/projects/${project.id}`} className="layout__link">
            {project.name}
          </NavLink>
        </li>
      ))}
    </ul>
  )
}
