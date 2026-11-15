import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api.ts'
import { useProjectsChanged } from '../projects-changed.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { messageOf } from './accounts.ts'
import { useGroup } from './group-context.ts'
import './accounts.css'
import './groups.css'
import './members.css'
import './pages.css'

/** A project as the API lists it. */
interface Project {
  id: string
  name: string
}

type Loaded =
  | { state: 'loading' }
  | { state: 'loaded'; inGroup: Project[]; visible: Project[] }
  | { state: 'failed' }

/**
 * The group projects screen (SC-084), at `/groups/<id>/projects`, inside the group's page: the
 * group's projects, among those the person can see, and the two ways a project is added to the
 * group (FR-123). Anyone creates a new project in the group. An existing project is picked from
 * the projects the person can see; only its admin may add it, so the REST API refuses anyone else,
 * and the screen shows the refusal in the API's own words. A project added to a group gives the
 * group's members their group role on it.
 */
export function GroupProjectsPage() {
  const group = useGroup()
  const toSignIn = useSignInRedirect()
  const projectsChanged = useProjectsChanged()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [name, setName] = useState('')
  const [existing, setExisting] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | undefined>()
  const base = `/groups/${encodeURIComponent(group.id)}/projects`

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [inGroup, visible] = await Promise.all([
          api<Project[]>(base, { signal }),
          api<Project[]>('/projects', { signal }),
        ])
        setLoaded({ state: 'loaded', inGroup, visible })
      } catch (error) {
        if (signal?.aborted || toSignIn(error)) return
        setLoaded({ state: 'failed' })
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

  /** Runs one change, then lists the projects afresh and says how it went. */
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
    const created = await change(async () => {
      await api<Project>('/projects', { method: 'POST', body: { name, groupIds: [group.id] } })
      projectsChanged()
    }, `Project ${name.trim()} is created in ${group.name}, and you are its admin.`)
    if (created) setName('')
  }

  const addExisting = async (event: FormEvent<HTMLFormElement>, candidates: Project[]) => {
    event.preventDefault()
    const project = candidates.find((p) => p.id === existing)
    if (project === undefined) return
    const added = await change(
      () => api<Project>(`${base}/${encodeURIComponent(project.id)}`, { method: 'PUT' }),
      `${project.name} is now in ${group.name}.`,
    )
    if (added) setExisting('')
  }

  if (loaded.state === 'loading') return <p className="page__note">Loading…</p>
  if (loaded.state === 'failed') {
    return (
      <p role="alert" className="page__note">
        The projects could not be loaded.
      </p>
    )
  }

  const inGroup = new Set(loaded.inGroup.map((p) => p.id))
  const candidates = loaded.visible.filter((p) => !inGroup.has(p.id))

  return (
    <section>
      <form
        className="account__card account__form"
        aria-labelledby="new-group-project"
        onSubmit={(event) => void create(event)}
      >
        <h2 className="account__card-title" id="new-group-project">
          Create a project in this group
        </h2>
        <div className="account__fields">
          <div className="account__field">
            <label htmlFor="group-project-name">Project name</label>
            <input
              id="group-project-name"
              type="text"
              autoComplete="off"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <button type="submit" className="account__button" disabled={busy}>
            Create project
          </button>
        </div>
      </form>

      <form
        className="account__card account__form"
        aria-labelledby="add-group-project"
        onSubmit={(event) => void addExisting(event, candidates)}
      >
        <h2 className="account__card-title" id="add-group-project">
          Add an existing project
        </h2>
        {candidates.length === 0 ? (
          <p className="page__note">Every project you can see is in this group already.</p>
        ) : (
          <div className="account__fields">
            <div className="account__field">
              <label htmlFor="group-project-existing">Project</label>
              <select
                id="group-project-existing"
                required
                value={existing}
                onChange={(event) => setExisting(event.target.value)}
              >
                <option value="">Choose a project</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="account__button" disabled={busy}>
              Add project
            </button>
          </div>
        )}
      </form>

      {outcome !== undefined && (
        <p
          role={outcome.ok ? 'status' : 'alert'}
          className={outcome.ok ? 'account__done' : 'account__failed'}
        >
          {outcome.text}
        </p>
      )}

      {loaded.inGroup.length === 0 ? (
        <p className="page__note">No project you can see is in this group.</p>
      ) : (
        <ul className="groups__projects" aria-label={`Projects of ${group.name}`}>
          {loaded.inGroup.map((p) => (
            <li key={p.id}>
              <Link to={`/projects/${p.id}`}>{p.name}</Link>
            </li>
          ))}
        </ul>
      )}
      <p className="page__note members__note">
        Anyone can create a project in a group. Only a project’s admins can add an existing project
        to a group. Projects you cannot see are not listed.
      </p>
    </section>
  )
}
