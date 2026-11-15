import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { SavedViewList } from '../views/SavedViewList.tsx'
import { loadNames, type SavedView } from '../views/saved-view.ts'
import '../views/saved-views.css'
import './accounts.css'
import './pages.css'

type Loaded =
  | { state: 'loading' }
  | {
      state: 'loaded'
      views: SavedView[]
      projects: Map<string, string>
      groups: Map<string, string>
    }
  | { state: 'failed' }

/**
 * The saved views, at `/views`: every saved view the person sees (FR-055), those kept in the
 * projects they can read, in the groups they are a member of and personally by them, each a link
 * that opens it; and the way to the saved view editor (SC-091), which saves a new one.
 */
export function SavedViewsPage() {
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })

  useEffect(() => {
    const abort = new AbortController()
    Promise.all([
      api<SavedView[]>('/saved-views', { signal: abort.signal }),
      loadNames(abort.signal),
    ])
      .then(([views, names]) => setLoaded({ state: 'loaded', views, ...names }))
      .catch((error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        setLoaded({ state: 'failed' })
      })
    return () => abort.abort()
  }, [toSignIn])

  return (
    <section>
      <div className="page__head">
        <h1 className="page__title">Saved views</h1>
        <Link to="/views/new" className="account__button views__link-button">
          New view
        </Link>
      </div>
      <p className="page__note">
        The Kanban and Gantt views kept in your projects, in your groups and personally by you.
      </p>
      {loaded.state === 'loading' && <p className="page__note">Loading…</p>}
      {loaded.state === 'failed' && (
        <p role="alert" className="page__note">
          The saved views could not be loaded.
        </p>
      )}
      {loaded.state === 'loaded' && (
        <SavedViewList
          name="Your saved views"
          views={loaded.views}
          projects={loaded.projects}
          groups={loaded.groups}
        />
      )}
    </section>
  )
}
