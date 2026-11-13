import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, ApiError } from '../api.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { AssignmentEditor, PersonLoadField } from '../tasks/AssignmentEditor.tsx'
import { EligibilityEditor } from '../tasks/EligibilityEditor.tsx'
import type { PeopleOnTask, Person } from '../tasks/PersonChip.tsx'
import {
  AI_ONLY_SHARE,
  type AssignmentChanges,
  type AssignmentDraft,
  assignmentChanges,
  assignmentDraftOf,
  percentageOf,
} from '../tasks/assignment.ts'
import {
  draftOf,
  draftProblem,
  type Eligibility,
  type EligibilityDraft,
  expressionOf,
  sameExpression,
} from '../tasks/eligibility.ts'
import { NOT_VISIBLE } from './ProjectPage.tsx'
import '../tasks/task-editors.css'
import './pages.css'

/** A task as the REST API gives it, the fields this page reads. */
interface Task {
  id: string
  projectId: string
  title: string
  aiShare: number | null
  personLoad: number | null
  milestone: unknown
  eligibility: Eligibility | null
  assignees: string[]
  loadOverrides: Record<string, number>
  withoutReadAccess: string[]
}

interface Loaded {
  task: Task
  project: { id: string; name: string }
  members: Person[]
  /** The people on the task, by username; it names those the members no longer list. */
  onTask: Person[]
}

type State =
  | { state: 'loading' }
  | ({ state: 'loaded' } & Loaded)
  | { state: 'not-visible'; message: string }
  | { state: 'failed' }

/**
 * A task's page, at `/tasks/<id>`: who can do the task, in the eligibility expression editor
 * (SC-099), and who will do it, in the assignment editor (SC-100), each saved on its own through
 * the REST API, which decides by the viewer's role in the task's project what may be changed. The
 * Kanban's cards lead here. Someone the task's project is not visible to is told so, in the API's
 * words, and shown nothing of it (FR-017).
 */
export function TaskPage() {
  const { taskId = '' } = useParams()
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<State>({ state: 'loading' })

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const get = <T,>(path: string) => api<T>(path, { signal })
      const id = encodeURIComponent(taskId)
      const task = await get<Task>(`/tasks/${id}`)
      const project = encodeURIComponent(task.projectId)
      const [found, members, onTask] = await Promise.all([
        get<{ id: string; name: string }>(`/projects/${project}`),
        get<Person[]>(`/projects/${project}/members`),
        get<Person[]>(`/tasks/${id}/people`),
      ])
      setLoaded({ state: 'loaded', task, project: found, members, onTask })
    },
    [taskId],
  )

  useEffect(() => {
    const abort = new AbortController()
    setLoaded({ state: 'loading' })
    load(abort.signal).catch((error: unknown) => {
      if (abort.signal.aborted || toSignIn(error)) return
      if (error instanceof ApiError && error.status === 403 && error.error === 'Not Visible') {
        setLoaded({ state: 'not-visible', message: error.message })
      } else if (error instanceof ApiError && (error.status === 400 || error.status === 404)) {
        setLoaded({ state: 'not-visible', message: NOT_VISIBLE })
      } else {
        setLoaded({ state: 'failed' })
      }
    })
    return () => abort.abort()
  }, [load, toSignIn])

  /** Saves changes to the task, then reads it again; rejects with the API's refusal. */
  const save = useCallback(
    async (changes: Record<string, unknown>) => {
      try {
        await api(`/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: changes })
      } catch (error) {
        if (toSignIn(error)) return
        throw error
      }
      await load().catch((error: unknown) => {
        if (!toSignIn(error)) setLoaded({ state: 'failed' })
      })
    },
    [load, taskId, toSignIn],
  )

  switch (loaded.state) {
    case 'loading':
      return <p className="page__note">Loading…</p>
    case 'failed':
      return (
        <p role="alert" className="page__note">
          The task could not be loaded.
        </p>
      )
    case 'not-visible':
      return (
        <section className="page__notice" role="alert">
          <h1 className="page__notice-title">{loaded.message}</h1>
        </section>
      )
    case 'loaded':
      break
  }
  return <TaskEditors {...loaded} save={save} />
}

function TaskEditors({
  task,
  project,
  members,
  onTask,
  save,
}: Loaded & { save: (changes: Record<string, unknown>) => Promise<void> }) {
  const people: PeopleOnTask = useMemo(() => {
    const names = new Map<string, string>()
    for (const person of [...onTask, ...members]) names.set(person.accountId, person.username)
    return {
      choices: members,
      nameOf: (accountId) => names.get(accountId) ?? 'Unknown person',
      cannotRead: new Set(task.withoutReadAccess),
      projectName: project.name,
    }
  }, [members, onTask, project.name, task.withoutReadAccess])

  return (
    <section className="task-page">
      <p className="page__note">
        <Link to={`/projects/${encodeURIComponent(project.id)}/kanban`}>{project.name}</Link>
      </p>
      <h1 className="page__title">{task.title}</h1>
      {task.milestone ? (
        <p className="page__note">
          A milestone takes no time: no one can be eligible for it or assigned to it.
        </p>
      ) : (
        <>
          <EligibilitySection
            key={`e-${JSON.stringify(task.eligibility)}`}
            task={task}
            people={people}
            save={save}
          />
          <AssignmentSection
            key={`a-${JSON.stringify([task.assignees, task.loadOverrides, task.personLoad])}`}
            task={task}
            people={people}
            save={save}
          />
        </>
      )}
    </section>
  )
}

/** Runs a save, keeping what it says for the section: its refusal, or that it was saved. */
function useSaving() {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (action: () => Promise<void>) => {
    setSaving(true)
    setError(null)
    try {
      await action()
    } catch (refusal) {
      setError(
        refusal instanceof ApiError ? refusal.message : 'The change could not be saved. Try again.',
      )
    } finally {
      setSaving(false)
    }
  }
  return { saving, error, setError, run }
}

function EligibilitySection({
  task,
  people,
  save,
}: {
  task: Task
  people: PeopleOnTask
  save: (changes: Record<string, unknown>) => Promise<void>
}) {
  const [draft, setDraft] = useState<EligibilityDraft>(() => draftOf(task.eligibility))
  const { saving, error, setError, run } = useSaving()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const problem = draftProblem(draft)
    if (problem) {
      setError(problem)
      return
    }
    const expression = expressionOf(draft)
    if (sameExpression(expression, task.eligibility)) return
    void run(() => save({ eligibility: expression }))
  }

  return (
    <form className="task-page__card" aria-labelledby="eligibility-heading" onSubmit={submit}>
      <h2 id="eligibility-heading" className="task-page__heading">
        Who can do it
      </h2>
      <EligibilityEditor draft={draft} people={people} onChange={setDraft} />
      <Footer saving={saving} error={error} label="Save eligibility" />
    </form>
  )
}

function AssignmentSection({
  task,
  people,
  save,
}: {
  task: Task
  people: PeopleOnTask
  save: (changes: Record<string, unknown>) => Promise<void>
}) {
  const [draft, setDraft] = useState<AssignmentDraft>(() => assignmentDraftOf(task))
  const aiOnly = task.aiShare === AI_ONLY_SHARE
  const [load, setLoad] = useState(task.personLoad === null ? '' : String(task.personLoad))
  const { saving, error, setError, run } = useSaving()
  const typedLoad = percentageOf(load)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const changes: AssignmentChanges & { personLoad?: number | null } = {}
    const assignment = assignmentChanges(task, draft, people.nameOf)
    if (typeof assignment === 'string') {
      setError(assignment)
      return
    }
    Object.assign(changes, assignment)
    if (aiOnly && typedLoad !== task.personLoad) {
      if (Number.isNaN(typedLoad)) {
        setError('The person load is not a number.')
        return
      }
      changes.personLoad = typedLoad
    }
    if (Object.keys(changes).length === 0) return
    void run(() => save({ ...changes }))
  }

  return (
    <form className="task-page__card" aria-labelledby="assignment-heading" onSubmit={submit}>
      <h2 id="assignment-heading" className="task-page__heading">
        Who will do it
      </h2>
      {aiOnly ? <PersonLoadField value={load} onChange={setLoad} /> : null}
      <AssignmentEditor
        draft={draft}
        taskLoad={
          aiOnly && typedLoad !== null && !Number.isNaN(typedLoad) ? typedLoad : task.personLoad
        }
        people={people}
        onChange={setDraft}
      />
      <Footer saving={saving} error={error} label="Save assignment" />
    </form>
  )
}

function Footer({
  saving,
  error,
  label,
}: {
  saving: boolean
  error: string | null
  label: string
}) {
  return (
    <>
      {error ? (
        <p role="alert" className="task-page__error">
          {error}
        </p>
      ) : null}
      <div className="task-editor__row">
        <button
          type="submit"
          className="task-editor__button task-editor__button--primary"
          disabled={saving}
        >
          {label}
        </button>
      </div>
    </>
  )
}
