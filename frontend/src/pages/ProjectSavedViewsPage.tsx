import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { SavedViewList } from '../views/SavedViewList.tsx'
import type { SavedView } from '../views/saved-view.ts'
import '../views/saved-views.css'
import './accounts.css'
import { useProject } from './project-context.ts'

type Loaded = { state: 'loading' } | { state: 'loaded'; views: SavedView[] } | { state: 'failed' }

/**
 * The saved views kept in a project, at `/projects/<id>/views`, inside the project's page: seen by
 * anyone who can read the project (FR-055), each a link that opens it; and the way to the saved
 * view editor (SC-091) with the view kept in this project.
 */
export function ProjectSavedViewsPage() {
  const project = useProject()
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })

  useEffect(() => {
    const abort = new AbortController()
    setLoaded({ state: 'loading' })
    api<SavedView[]>(`/projects/${encodeURIComponent(project.id)}/saved-views`, {
      signal: abort.signal,
    }).then(
      (views) => setLoaded({ state: 'loaded', views }),
      (error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        setLoaded({ state: 'failed' })
      },
    )
    return () => abort.abort()
  }, [project.id, toSignIn])

  return (
    <section className="views__section">
      <div className="page__head">
        <p className="page__note">The views kept in {project.name}, for anyone who can read it.</p>
        <Link
          to={`/views/new?project=${encodeURIComponent(project.id)}`}
          className="account__button views__link-button"
        >
          New view in {project.name}
        </Link>
      </div>
      {loaded.state === 'loading' && <p className="page__note">Loading…</p>}
      {loaded.state === 'failed' && (
        <p role="alert" className="page__note">
          The saved views could not be loaded.
        </p>
      )}
      {loaded.state === 'loaded' && (
        <SavedViewList
          name={`Saved views of ${project.name}`}
          views={loaded.views}
          projects={new Map([[project.id, project.name]])}
          groups={new Map()}
        />
      )}
    </section>
  )
}
