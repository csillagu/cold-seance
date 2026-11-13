import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { api } from '../api.ts'
import { ProjectsChangedContext } from '../projects-changed.ts'
import { type SignedInAccount, SignedInContext } from '../signed-in.ts'
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
 * Below the projects, the navigation leads to the project creation form (SC-079), which anyone
 * signed in may use; it and the members screen (SC-080) tell the layout, through
 * `useProjectsChanged()`, when the projects listed may have changed.
 *
 * Below them, the navigation leads to the registered repositories (SC-085), which anyone signed in
 * may register, and from there to each one's admins (SC-086).
 *
 * The navigation also leads to the signed-in person's own GitHub account link (SC-077) and API
 * tokens (SC-078), and, for a system admin only, to account administration (SC-076). The pages
 * inside read who is signed in with `useSignedIn()`.
 *
 * Someone who is not signed in is sent to the sign-in page, and comes back here once signed in.
 */
export function Layout() {
  const toSignIn = useSignInRedirect()
  const [projects, setProjects] = useState<Projects>({ state: 'loading' })
  const [signedIn, setSignedIn] = useState<SignedInAccount | undefined>()
  // Counts the changes the pages report to the projects, so that each lists them afresh.
  const [projectsVersion, setProjectsVersion] = useState(0)
  const projectsChanged = useCallback(() => setProjectsVersion((version) => version + 1), [])

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
  }, [toSignIn, projectsVersion])

  useEffect(() => {
    const abort = new AbortController()
    api<SignedInAccount>('/session', { signal: abort.signal }).then(
      setSignedIn,
      (error: unknown) => {
        if (abort.signal.aborted) return
        // Without it, the navigation leaves out what depends on who is signed in.
        toSignIn(error)
      },
    )
    return () => abort.abort()
  }, [toSignIn])

  return (
    <SignedInContext value={signedIn}>
      <ProjectsChangedContext value={projectsChanged}>
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
              <NavLink to="/projects/new" className="layout__link">
                New project
              </NavLink>
              <h2 className="layout__nav-heading">GitHub</h2>
              <NavLink to="/repositories" className="layout__link">
                Repositories
              </NavLink>
              {signedIn !== undefined && (
                <>
                  <h2 className="layout__nav-heading">Your account</h2>
                  <NavLink to="/settings/github" className="layout__link">
                    GitHub account
                  </NavLink>
                  <NavLink to="/tokens" className="layout__link">
                    API tokens
                  </NavLink>
                </>
              )}
              {signedIn?.systemAdmin === true && (
                <>
                  <h2 className="layout__nav-heading">Administration</h2>
                  <NavLink to="/accounts" className="layout__link">
                    Accounts
                  </NavLink>
                </>
              )}
            </nav>
            <main className="layout__content">
              <Outlet />
            </main>
          </div>
        </div>
      </ProjectsChangedContext>
    </SignedInContext>
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
