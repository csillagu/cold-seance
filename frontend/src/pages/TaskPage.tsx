import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, ApiError } from '../api.ts'
import type { TaskStatus } from '../gantt/gantt-model.ts'
import { COLUMNS } from '../kanban/kanban-model.ts'
import { SubscriptionControl } from '../notifications/SubscriptionControl.tsx'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { AssignmentEditor, PersonLoadField } from '../tasks/AssignmentEditor.tsx'
import { EligibilityEditor } from '../tasks/EligibilityEditor.tsx'
import type { PeopleOnTask, Person } from '../tasks/PersonChip.tsx'
import { RelationsSection } from '../tasks/RelationsSection.tsx'
import { RepositoryField, TaskDetailsFields } from '../tasks/TaskDetailsFields.tsx'
import {
  AI_ONLY_SHARE,
  type AssignmentChanges,
  type AssignmentDraft,
  assignmentChanges,
  assignmentDraftOf,
  percentageOf,
} from '../tasks/assignment.ts'
import {
  type DetailedTask,
  type DetailsDraft,
  detailsChanges,
  detailsDraftOf,
  detailsProblem,
  type Repository,
} from '../tasks/task-details.ts'
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
import '../tasks/task-details.css'
import './pages.css'

/** A task as the REST API gives it, the fields this page reads. */
interface Task extends DetailedTask {
  id: string
  projectId: string
  status: TaskStatus
  repositoryId: string | null
  githubIssue: { repositoryId: string; number: number } | null
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

/** Sends a change of the task to the REST API, below `/tasks/<id>`; rejects with its refusal. */
type Send = (below: string, method: string, body?: unknown) => Promise<void>

/**
 * A task's page, at `/tasks/<id>`: its fields, in the task details editor (SC-098), the
 * repository it is assigned to, its status and the action that cancels it (SC-102), who can do
 * it, in the eligibility expression editor (SC-099), and who will do it, in the assignment editor
 * (SC-100), and its parent, subtasks and blockers, in the task relation editor (SC-101), each saved on its own through the REST API, which decides by the viewer's role in the
 * task's project what may be changed, and whose refusal is shown. The Kanban's cards lead here. Someone the task's project is not visible to is told so, in the API's
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

  /** Sends a change of the task, then reads it again; rejects with the API's refusal. */
  const send: Send = useCallback(
    async (below, method, body) => {
      try {
        await api(`/tasks/${encodeURIComponent(taskId)}${below}`, { method, body })
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
  const save = useCallback((changes: Record<string, unknown>) => send('', 'PATCH', changes), [send])
  /** Reads the task again, after a change its relation editor made. */
  const reload = useCallback(
    () =>
      load().catch((error: unknown) => {
        if (!toSignIn(error)) setLoaded({ state: 'failed' })
      }),
    [load, toSignIn],
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
  return <TaskEditors {...loaded} save={save} send={send} reload={reload} />
}

function TaskEditors({
  task,
  project,
  members,
  onTask,
  save,
  send,
  reload,
}: Loaded & {
  save: (changes: Record<string, unknown>) => Promise<void>
  send: Send
  reload: () => Promise<void>
}) {
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
      <StatusSection key={`s-${task.status}`} task={task} projectName={project.name} send={send} />
      <DetailsSection key={`d-${JSON.stringify(task)}`} task={task} save={save} />
      <RepositorySection key={`r-${task.repositoryId ?? ''}`} task={task} send={send} />
      <RelationsSection task={task} projectName={project.name} onChanged={reload} />
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

/** How the page names each status: as the Kanban's columns do. */
function statusWord(status: TaskStatus): string {
  return COLUMNS.find((column) => column.status === status)?.name ?? status
}

/**
 * The task's status and the action that cancels it (SC-102, FR-027). Cancelling asks once more,
 * then the task shows as cancelled; it stays in its project. A finished or cancelled task offers
 * no cancelling. Whether the viewer's role allows it is the REST API's to decide.
 */
function StatusSection({
  task,
  projectName,
  send,
}: {
  task: Task
  projectName: string
  send: Send
}) {
  const [asking, setAsking] = useState(false)
  const { saving, error, run } = useSaving()
  const cancelled = task.status === 'cancelled'

  return (
    <section className="task-page__card" aria-labelledby="status-heading">
      <h2 id="status-heading" className="task-page__heading">
        Status
      </h2>
      <div className="task-editor__row">
        <span
          className={'task-details__status' + (cancelled ? ' task-details__status--cancelled' : '')}
          aria-label={`Status: ${statusWord(task.status)}`}
        >
          {statusWord(task.status)}
        </span>
        {cancelled ? (
          <span className="task-editor__muted">
            The task is cancelled; it stays in {projectName}.
          </span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="task-page__error">
          {error}
        </p>
      ) : null}
      {cancelled || task.status === 'done' ? null : asking ? (
        <div className="task-editor__row">
          <p className="task-details__confirm">
            Cancel {task.title}? It stays in {projectName}, cancelled.
          </p>
          <button
            type="button"
            className="task-editor__button task-details__button--danger"
            disabled={saving}
            onClick={() => void run(() => send('/cancel', 'POST', {}))}
          >
            Cancel the task
          </button>
          <button
            type="button"
            className="task-editor__button task-editor__button--quiet"
            disabled={saving}
            onClick={() => setAsking(false)}
          >
            Keep it
          </button>
        </div>
      ) : (
        <div className="task-editor__row">
          <button
            type="button"
            className="task-editor__button task-details__button--danger"
            onClick={() => setAsking(true)}
          >
            Cancel task
          </button>
        </div>
      )}
    </section>
  )
}

/** The task details editor (SC-098): the task's own fields, saved together. */
function DetailsSection({
  task,
  save,
}: {
  task: Task
  save: (changes: Record<string, unknown>) => Promise<void>
}) {
  const [draft, setDraft] = useState<DetailsDraft>(() => detailsDraftOf(task))
  const { saving, error, setError, run } = useSaving()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const problem = detailsProblem(draft)
    if (problem) {
      setError(problem)
      return
    }
    const changes = detailsChanges(task, draft)
    if (Object.keys(changes).length === 0) return
    void run(() => save(changes))
  }

  return (
    <form
      className="task-page__card"
      aria-labelledby="details-heading"
      noValidate
      onSubmit={submit}
    >
      <h2 id="details-heading" className="task-page__heading">
        Details
      </h2>
      <TaskDetailsFields
        draft={draft}
        onChange={setDraft}
        milestone={Boolean(task.milestone)}
        // An AI-only task's person load is set in its assignment; one becoming AI-only gets it here.
        offerPersonLoad={task.aiShare !== AI_ONLY_SHARE}
      />
      <Footer saving={saving} error={error} label="Save details" />
    </form>
  )
}

/**
 * The repository the task is assigned to (FR-141): one of those its project pulls issues from.
 * Once assigned, its GitHub issue is created; the task keeps a repository once it has one. A task
 * with an issue offers the control that subscribes the person to the issue (SC-093).
 */
function RepositorySection({ task, send }: { task: Task; send: Send }) {
  const toSignIn = useSignInRedirect()
  const [repositories, setRepositories] = useState<Repository[] | 'failed' | null>(null)
  const [chosen, setChosen] = useState(task.repositoryId ?? '')
  const { saving, error, run } = useSaving()

  useEffect(() => {
    const abort = new AbortController()
    api<Repository[]>(`/projects/${encodeURIComponent(task.projectId)}/repositories`, {
      signal: abort.signal,
    }).then(setRepositories, (failure: unknown) => {
      if (!abort.signal.aborted && !toSignIn(failure)) setRepositories('failed')
    })
    return () => abort.abort()
  }, [task.projectId, toSignIn])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (chosen === '' || chosen === task.repositoryId) return
    void run(() => send('/repository', 'PUT', { repositoryId: chosen }))
  }

  const offered = repositories === null || repositories === 'failed' ? null : repositories
  return (
    <form className="task-page__card" aria-labelledby="repository-heading" onSubmit={submit}>
      <h2 id="repository-heading" className="task-page__heading">
        Repository
      </h2>
      {task.githubIssue ? (
        <>
          <p className="task-editor__muted">Linked to GitHub issue #{task.githubIssue.number}.</p>
          <SubscriptionControl
            subject={{ kind: 'issue', taskId: task.id, number: task.githubIssue.number }}
          />
        </>
      ) : null}
      {repositories === 'failed' ? (
        <p className="task-editor__muted">The repositories could not be loaded.</p>
      ) : offered === null ? null : offered.length === 0 && task.repositoryId === null ? (
        <p className="task-editor__muted">The project pulls issues from no repository.</p>
      ) : (
        <>
          <RepositoryField
            value={chosen}
            repositories={offered}
            allowNone={task.repositoryId === null}
            onChange={setChosen}
          />
          <Footer saving={saving} error={error} label="Assign to repository" />
        </>
      )}
    </form>
  )
}
