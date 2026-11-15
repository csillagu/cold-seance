import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { api } from '../api.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { type Choice, FilterBuilder } from '../views/FilterBuilder.tsx'
import { type DraftCondition, problemOf, toCondition } from '../views/filter.ts'
import {
  KIND_NAMES,
  type Named,
  type SavedView,
  type SavedViewKind,
  type SavedViewPlace,
  viewPath,
} from '../views/saved-view.ts'
import '../views/saved-views.css'
import { messageOf } from './accounts.ts'
import './accounts.css'
import './pages.css'

/** A repository as the REST API lists it, the fields the editor reads. */
interface Repository {
  id: string
  owner: string
  name: string
}

interface Options {
  projects: Named[]
  groups: Named[]
  repositories: Choice[]
}

type Loaded = { state: 'loading' } | ({ state: 'loaded' } & Options) | { state: 'failed' }

const PLACES: { value: SavedViewPlace; label: string }[] = [
  { value: 'personal', label: 'Personally' },
  { value: 'project', label: 'In a project' },
  { value: 'group', label: 'In a group' },
]

const KINDS: SavedViewKind[] = ['kanban', 'gantt']

/**
 * The saved view editor (SC-091), at `/views/new`: a person saves a Kanban or Gantt view under a
 * name (FR-054), kept in a project, a group or personally (FR-055), choosing the projects it covers
 * (FR-056): a view kept in a project covers that project, one kept in a group some of the group's
 * projects, and a personal one some of the projects its owner can read. Its filter is built in the
 * filter builder (SC-092). Only the Kanban and Gantt kinds are offered, as the other view kinds
 * have no saved views.
 *
 * `?project=<id>` starts it with the view kept in that project. Who may keep a view where is the
 * REST API's to decide; a refusal is shown in its own words. Once saved, the view is opened.
 */
export function SavedViewEditorPage() {
  const toSignIn = useSignInRedirect()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const startProject = search.get('project')
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [name, setName] = useState('')
  const [kind, setKind] = useState<SavedViewKind>('kanban')
  const [keptIn, setKeptIn] = useState<SavedViewPlace>(
    startProject === null ? 'personal' : 'project',
  )
  const [projectId, setProjectId] = useState(startProject ?? '')
  const [groupId, setGroupId] = useState('')
  const [covered, setCovered] = useState<ReadonlySet<string>>(new Set())
  const [conditions, setConditions] = useState<DraftCondition[]>([])
  /** The projects of the chosen group, once read. */
  const [groupProjects, setGroupProjects] = useState<Named[] | null>(null)
  const [people, setPeople] = useState<Choice[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>()

  useEffect(() => {
    const abort = new AbortController()
    const get = <T,>(path: string) => api<T>(path, { signal: abort.signal })
    Promise.all([
      get<Named[]>('/projects'),
      get<Named[]>('/groups'),
      get<Repository[]>('/repositories'),
    ])
      .then(([projects, groups, repositories]) =>
        setLoaded({
          state: 'loaded',
          projects,
          groups,
          repositories: repositories.map((repository) => ({
            id: repository.id,
            name: `${repository.owner}/${repository.name}`,
          })),
        }),
      )
      .catch((error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        setLoaded({ state: 'failed' })
      })
    return () => abort.abort()
  }, [toSignIn])

  useEffect(() => {
    setGroupProjects(null)
    if (keptIn !== 'group' || groupId === '') return undefined
    const abort = new AbortController()
    api<Named[]>(`/groups/${encodeURIComponent(groupId)}/projects`, { signal: abort.signal }).then(
      setGroupProjects,
      (error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        setGroupProjects([])
      },
    )
    return () => abort.abort()
  }, [keptIn, groupId, toSignIn])

  /** The projects the view can cover, kept where it is. */
  const candidates = useMemo((): Named[] => {
    if (loaded.state !== 'loaded') return []
    if (keptIn === 'personal') return loaded.projects
    if (keptIn === 'group') return groupProjects ?? []
    return loaded.projects.filter((project) => project.id === projectId)
  }, [loaded, keptIn, groupProjects, projectId])

  /** The projects the view covers: for one kept in a project, that project. */
  const covers = useMemo(
    () =>
      keptIn === 'project' ? candidates : candidates.filter((project) => covered.has(project.id)),
    [keptIn, candidates, covered],
  )
  const coverIds = covers.map((project) => project.id).join(',')

  // The people a condition can name: the members of the projects the view covers.
  useEffect(() => {
    const ids = coverIds === '' ? [] : coverIds.split(',')
    const abort = new AbortController()
    Promise.all(
      ids.map((id) =>
        api<{ accountId: string; username: string }[]>(
          `/projects/${encodeURIComponent(id)}/members`,
          { signal: abort.signal },
        ),
      ),
    )
      .then((lists) => {
        const byId = new Map<string, string>()
        for (const member of lists.flat()) byId.set(member.accountId, member.username)
        setPeople([...byId].map(([id, username]) => ({ id, name: username })).sort(byName))
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        setPeople([])
      })
    return () => abort.abort()
  }, [coverIds, toSignIn])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const problem = conditions.map(problemOf).find((found) => found !== null)
    if (problem !== undefined && problem !== null) {
      setFailure(problem)
      return
    }
    setBusy(true)
    setFailure(undefined)
    try {
      const saved = await api<SavedView>('/saved-views', {
        method: 'POST',
        body: {
          name,
          kind,
          keptIn,
          ...(keptIn === 'project' ? { projectId } : {}),
          ...(keptIn === 'group' ? { groupId } : {}),
          projects: covers.map((project) => project.id),
          filter: conditions.map(toCondition),
        },
      })
      void navigate(viewPath(saved))
    } catch (error) {
      if (!toSignIn(error)) setFailure(messageOf(error))
      setBusy(false)
    }
  }

  if (loaded.state === 'loading') return <p className="page__note">Loading…</p>
  if (loaded.state === 'failed') {
    return (
      <p role="alert" className="page__note">
        The saved view editor could not be loaded.
      </p>
    )
  }

  const toggle = (id: string, on: boolean) => {
    const next = new Set(covered)
    if (on) next.add(id)
    else next.delete(id)
    setCovered(next)
  }

  return (
    <section>
      <h1 className="page__title">New saved view</h1>
      <p className="page__note">
        Save a Kanban or Gantt view under a name, with the projects it covers and a filter.
      </p>

      <form
        className="account__card views__editor"
        aria-labelledby="saved-view-editor"
        onSubmit={(event) => void save(event)}
      >
        <h2 className="account__card-title" id="saved-view-editor">
          Save a view
        </h2>
        <div className="account__fields">
          <div className="account__field">
            <label htmlFor="saved-view-name">Name</label>
            <input
              id="saved-view-name"
              type="text"
              autoComplete="off"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="account__field">
            <label htmlFor="saved-view-kind">Kind</label>
            <select
              id="saved-view-kind"
              className="views__select"
              value={kind}
              onChange={(event) => setKind(event.target.value === 'gantt' ? 'gantt' : 'kanban')}
            >
              {KINDS.map((value) => (
                <option key={value} value={value}>
                  {KIND_NAMES[value]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className="views__fieldset">
          <legend className="views__legend">Kept</legend>
          <div className="views__choices">
            {PLACES.map((place) => (
              <label key={place.value} className="views__choice">
                <input
                  type="radio"
                  name="kept-in"
                  value={place.value}
                  checked={keptIn === place.value}
                  onChange={() => setKeptIn(place.value)}
                />
                {place.label}
              </label>
            ))}
          </div>
          {keptIn === 'project' && (
            <div className="account__field views__place">
              <label htmlFor="saved-view-project">Project</label>
              <select
                id="saved-view-project"
                className="views__select"
                required
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">Choose a project</option>
                {loaded.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {keptIn === 'group' && (
            <div className="account__field views__place">
              <label htmlFor="saved-view-group">Group</label>
              <select
                id="saved-view-group"
                className="views__select"
                required
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
              >
                <option value="">Choose a group</option>
                {loaded.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </fieldset>

        {keptIn !== 'project' && (
          <fieldset className="views__fieldset">
            <legend className="views__legend">Projects it covers</legend>
            {candidates.length === 0 ? (
              <p className="views__hint">
                {keptIn === 'group'
                  ? groupId === ''
                    ? 'Choose a group first.'
                    : groupProjects === null
                      ? 'Loading…'
                      : 'The group has no projects.'
                  : 'You cannot read any project.'}
              </p>
            ) : (
              <div className="views__choices">
                {candidates.map((project) => (
                  <label key={project.id} className="views__choice">
                    <input
                      type="checkbox"
                      checked={covered.has(project.id)}
                      onChange={(event) => toggle(project.id, event.target.checked)}
                    />
                    {project.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}

        <FilterBuilder
          conditions={conditions}
          onChange={setConditions}
          people={people}
          projects={covers}
          repositories={loaded.repositories}
        />

        <div className="views__actions">
          <button type="submit" className="account__button" disabled={busy}>
            Save view
          </button>
        </div>
      </form>

      {failure !== undefined && (
        <p role="alert" className="account__failed">
          {failure}
        </p>
      )}
    </section>
  )
}

function byName(a: Choice, b: Choice): number {
  return a.name.localeCompare(b.name)
}
