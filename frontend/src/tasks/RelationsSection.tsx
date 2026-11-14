import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import './task-relations.css'

/** A task as the relation editor names it: from a project's task list, or read on its own. */
interface NamedTask {
  id: string
  projectId: string
  title: string
  milestone: unknown
}

/** A task the relations name, as the REST API gives it. */
interface TaskRef {
  id: string
  projectId: string
}

/** A task's relations, as `GET /tasks/<id>/relations` gives them (SC-002). */
interface Relations {
  taskId: string
  parent: TaskRef | null
  subtasks: TaskRef[]
  blockedBy: TaskRef[]
}

interface Project {
  id: string
  name: string
}

interface Loaded {
  relations: Relations
  /** The tasks of the task's own project. */
  ownTasks: NamedTask[]
  /** The projects the viewer can read, the task's own among them. */
  projects: Project[]
  /** Every task the relations name, by id, those of other projects included. */
  named: Map<string, NamedTask>
}

type State = { state: 'loading' } | ({ state: 'loaded' } & Loaded) | { state: 'failed' }

/** How the editor tells the API's refusal, or that a change could not be sent. */
function refusalOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'The change could not be saved. Try again.'
}

/**
 * The task relation editor (SC-101): the task's parent, its subtasks and what it is blocked by,
 * a milestone of another project included (FR-015). Each change is saved on its own through the
 * REST API, which decides what is allowed; a rejected relation is shown with the API's reason,
 * a cycle (FR-014) or a project the viewer cannot read (FR-016, FR-017) among them, and the
 * relations stay as they were. A milestone of a project the viewer cannot pick from the list can
 * still be given by its identifier. After each change `onChanged` is called, as a relation can
 * move the task's dates.
 */
export function RelationsSection({
  task,
  projectName,
  onChanged,
}: {
  task: { id: string; projectId: string }
  projectName: string
  onChanged: () => Promise<void>
}) {
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<State>({ state: 'loading' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const get = <T,>(path: string) => api<T>(path, { signal })
      const [relations, ownTasks, projects] = await Promise.all([
        get<Relations>(`/tasks/${encodeURIComponent(task.id)}/relations`),
        get<NamedTask[]>(`/projects/${encodeURIComponent(task.projectId)}/tasks`),
        get<Project[]>('/projects'),
      ])
      const named = new Map(ownTasks.map((own) => [own.id, own]))
      const others = relations.blockedBy.filter((blocker) => !named.has(blocker.id))
      for (const other of await Promise.all(
        others.map((blocker) => get<NamedTask>(`/tasks/${encodeURIComponent(blocker.id)}`)),
      )) {
        named.set(other.id, other)
      }
      setLoaded({ state: 'loaded', relations, ownTasks, projects, named })
    },
    [task.id, task.projectId],
  )

  useEffect(() => {
    const abort = new AbortController()
    load(abort.signal).catch((failure: unknown) => {
      if (!abort.signal.aborted && !toSignIn(failure)) setLoaded({ state: 'failed' })
    })
    return () => abort.abort()
  }, [load, toSignIn])

  /** Sends one change, then reads the relations again; a refusal is kept to be shown. */
  const change = async (path: string, method: string, body?: unknown) => {
    setSaving(true)
    setError(null)
    try {
      await api(path, { method, body })
    } catch (refusal) {
      if (!toSignIn(refusal)) setError(refusalOf(refusal))
      setSaving(false)
      return
    }
    try {
      await load()
      await onChanged()
    } catch (failure) {
      if (!toSignIn(failure)) setLoaded({ state: 'failed' })
    } finally {
      setSaving(false)
    }
  }

  if (loaded.state !== 'loaded') {
    return (
      <section className="task-page__card" aria-labelledby="relations-heading">
        <h2 id="relations-heading" className="task-page__heading">
          Relations
        </h2>
        <p className="task-editor__muted">
          {loaded.state === 'loading' ? 'Loading…' : 'The relations could not be loaded.'}
        </p>
      </section>
    )
  }

  const { relations, ownTasks, projects, named } = loaded
  const projectNames = new Map(projects.map((project) => [project.id, project.name]))
  projectNames.set(task.projectId, projectName)
  const nameOf = (ref: TaskRef) => {
    const title = named.get(ref.id)?.title ?? 'Unknown task'
    if (ref.projectId === task.projectId) return title
    return `${title} (${projectNames.get(ref.projectId) ?? 'another project'})`
  }
  const taskPath = (id: string) => `/tasks/${encodeURIComponent(id)}`
  const others = ownTasks.filter((own) => own.id !== task.id)

  return (
    <section className="task-page__card" aria-labelledby="relations-heading">
      <h2 id="relations-heading" className="task-page__heading">
        Relations
      </h2>
      <ParentField
        key={relations.parent?.id ?? ''}
        current={relations.parent?.id ?? ''}
        choices={others}
        saving={saving}
        onSave={(parentId) =>
          void change(`${taskPath(task.id)}/parent`, 'PUT', { parentId: parentId || null })
        }
      />
      <RelationList
        label="Subtasks"
        empty="No subtasks."
        items={relations.subtasks}
        nameOf={nameOf}
        saving={saving}
        onRemove={(sub) => void change(`${taskPath(sub.id)}/parent`, 'PUT', { parentId: null })}
      />
      <AddFromList
        label="Add a subtask"
        button="Add subtask"
        choices={others.filter((own) => !relations.subtasks.some((sub) => sub.id === own.id))}
        saving={saving}
        onAdd={(id) => void change(`${taskPath(id)}/parent`, 'PUT', { parentId: task.id })}
      />
      <RelationList
        label="Blocked by"
        empty="Not blocked by anything."
        items={relations.blockedBy}
        nameOf={nameOf}
        saving={saving}
        onRemove={(blocker) =>
          void change(`${taskPath(task.id)}/blocked-by/${encodeURIComponent(blocker.id)}`, 'DELETE')
        }
      />
      <AddBlocker
        task={task}
        projects={projects}
        ownTasks={others.filter(
          (own) => !relations.blockedBy.some((blocker) => blocker.id === own.id),
        )}
        saving={saving}
        onAdd={(blockerId) => void change(`${taskPath(task.id)}/blocked-by`, 'POST', { blockerId })}
      />
      {error ? (
        <p role="alert" className="task-page__error">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function ParentField({
  current,
  choices,
  saving,
  onSave,
}: {
  current: string
  choices: NamedTask[]
  saving: boolean
  onSave: (parentId: string) => void
}) {
  const [chosen, setChosen] = useState(current)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (chosen !== current) onSave(chosen)
  }
  return (
    <form className="task-editor__row" onSubmit={submit}>
      <label className="task-editor__field">
        Parent
        <select
          className="task-editor__add"
          value={chosen}
          onChange={(event) => setChosen(event.target.value)}
        >
          <option value="">None</option>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.title}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="task-editor__button" disabled={saving}>
        Save parent
      </button>
    </form>
  )
}

function RelationList({
  label,
  empty,
  items,
  nameOf,
  saving,
  onRemove,
}: {
  label: string
  empty: string
  items: TaskRef[]
  nameOf: (ref: TaskRef) => string
  saving: boolean
  onRemove: (ref: TaskRef) => void
}) {
  return (
    <div className="task-relations__list" role="group" aria-label={label}>
      <h3 className="task-relations__label">{label}</h3>
      {items.length === 0 ? (
        <p className="task-editor__empty">{empty}</p>
      ) : (
        <ul className="task-editor__items">
          {items.map((item) => (
            <li key={item.id} className="task-editor__person" aria-label={nameOf(item)}>
              <span className="task-editor__name">{nameOf(item)}</span>
              <button
                type="button"
                className="task-editor__remove"
                aria-label={`Remove ${nameOf(item)}`}
                disabled={saving}
                onClick={() => onRemove(item)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AddFromList({
  label,
  button,
  choices,
  saving,
  onAdd,
}: {
  label: string
  button: string
  choices: NamedTask[]
  saving: boolean
  onAdd: (id: string) => void
}) {
  const [chosen, setChosen] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (chosen === '') return
    onAdd(chosen)
    setChosen('')
  }
  return (
    <form className="task-editor__row" onSubmit={submit}>
      <label className="task-editor__field">
        {label}
        <select
          className="task-editor__add"
          value={chosen}
          onChange={(event) => setChosen(event.target.value)}
        >
          <option value="">Choose a task</option>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.title}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="task-editor__button" disabled={saving || chosen === ''}>
        {button}
      </button>
    </form>
  )
}

/**
 * Adds a blocker: a task of the task's own project, or a milestone of another project the viewer
 * can read, picked from that project's list (FR-015), or any milestone given by its identifier,
 * whose project the API checks the viewer can read (FR-016).
 */
function AddBlocker({
  task,
  projects,
  ownTasks,
  saving,
  onAdd,
}: {
  task: { id: string; projectId: string }
  projects: Project[]
  ownTasks: NamedTask[]
  saving: boolean
  onAdd: (blockerId: string) => void
}) {
  const toSignIn = useSignInRedirect()
  const [projectId, setProjectId] = useState(task.projectId)
  const [milestones, setMilestones] = useState<NamedTask[] | 'failed' | null>(null)
  const [chosen, setChosen] = useState('')
  const [identifier, setIdentifier] = useState('')
  const own = projectId === task.projectId

  useEffect(() => {
    // The task's own project's tasks are given; only another project's milestones are read.
    if (projectId === task.projectId) return undefined
    const abort = new AbortController()
    setMilestones(null)
    api<NamedTask[]>(`/projects/${encodeURIComponent(projectId)}/tasks`, {
      signal: abort.signal,
    }).then(
      (found) => setMilestones(found.filter((other) => other.milestone)),
      (failure: unknown) => {
        if (!abort.signal.aborted && !toSignIn(failure)) setMilestones('failed')
      },
    )
    return () => abort.abort()
  }, [projectId, task.projectId, toSignIn])

  const choices = own ? ownTasks : Array.isArray(milestones) ? milestones : []
  const submitChosen = (event: FormEvent) => {
    event.preventDefault()
    if (chosen === '') return
    onAdd(chosen)
    setChosen('')
  }
  const submitIdentifier = (event: FormEvent) => {
    event.preventDefault()
    const typed = identifier.trim()
    if (typed === '') return
    onAdd(typed)
    setIdentifier('')
  }

  return (
    <>
      <form className="task-editor__row" onSubmit={submitChosen}>
        <label className="task-editor__field">
          Blocker's project
          <select
            className="task-editor__add"
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value)
              setChosen('')
            }}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="task-editor__field">
          {own ? 'Add a blocker' : 'Add a milestone as blocker'}
          <select
            className="task-editor__add"
            value={chosen}
            onChange={(event) => setChosen(event.target.value)}
          >
            <option value="">{own ? 'Choose a task' : 'Choose a milestone'}</option>
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.title}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="task-editor__button" disabled={saving || chosen === ''}>
          Add blocker
        </button>
      </form>
      {milestones === 'failed' && !own ? (
        <p className="task-editor__muted">The project's milestones could not be loaded.</p>
      ) : null}
      <form className="task-editor__row" onSubmit={submitIdentifier}>
        <label className="task-editor__field task-relations__identifier">
          Or a milestone's identifier
          <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
        </label>
        <button
          type="submit"
          className="task-editor__button"
          disabled={saving || identifier.trim() === ''}
        >
          Add by identifier
        </button>
      </form>
    </>
  )
}
