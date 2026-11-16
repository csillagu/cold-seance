import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api, ApiError } from '../api.ts'
import {
  type ApiRelations,
  type ApiTask,
  formatDay,
  type TaskStatus,
} from '../gantt/gantt-model.ts'
import { COLUMNS, type KanbanTask } from '../kanban/kanban-model.ts'
import { NOT_VISIBLE } from '../pages/ProjectPage.tsx'
import type { Role } from '../pages/roles.ts'
import { useSignedIn } from '../signed-in.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { AI_ONLY_SHARE } from './assignment.ts'
import { taskAccess } from './task-access.ts'
import { EditForm, type Member, type TaskChanges } from './TaskEditForm.tsx'
import '../gantt/gantt-export.css'
import '../gantt/gantt-edit.css'
import './task-dialog.css'

/** The task's project as `GET /projects/{id}` gives it: with the viewer's role in it. */
interface Project {
  id: string
  name: string
  role: Role
}

interface Loaded {
  task: KanbanTask
  project: Project
  /** The tasks of the task's project, to choose its blockers and its parent among. */
  tasks: ApiTask[]
  relations: ApiRelations
  /** The people who can be assigned to it: those with a role in its project. */
  members: Member[]
}

type State =
  | { state: 'loading' }
  | ({ state: 'loaded' } & Loaded)
  | { state: 'not-visible'; message: string }
  | { state: 'failed' }

interface TaskDialogProps {
  taskId: string
  onClose: () => void
  /** Called once a change is saved, so that the view behind the dialog reads the plan again. */
  onChanged?: () => void
}

/** What the API said when it refused a change, or a plain word when it said nothing. */
function refusal(error: unknown): string {
  return error instanceof ApiError ? error.message : 'The change could not be saved. Try again.'
}

/**
 * The task dialog (#209, SC-067, FR-053): the one editor of a task, the same in every view, opened
 * by clicking the task's title. It reads the task, its project with the viewer's role there, the
 * project's tasks and members and the task's relations itself, so a view needs only the task's id.
 * It shows everything a view shows of the task that a person sets: its fields, its status, the
 * tasks it is blocked by and its parent; and offers only what the viewer's role allows (FR-106,
 * FR-107, FR-108): the read-write and admin roles change everything, a contributor only the status
 * of a task they are assigned to, the read-only role nothing. Each change goes to the REST API,
 * which still decides it by that role (FR-060); a refusal is shown in the dialog.
 */
export function TaskDialog({ taskId, onClose, onChanged }: TaskDialogProps) {
  const toSignIn = useSignInRedirect()
  const viewer = useSignedIn()
  const [loaded, setLoaded] = useState<State>({ state: 'loading' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  const path = `/tasks/${encodeURIComponent(taskId)}`

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const get = <T,>(at: string) => api<T>(at, { signal })
      const task = await get<KanbanTask>(path)
      const base = `/projects/${encodeURIComponent(task.projectId)}`
      const [project, tasks, relations, members] = await Promise.all([
        get<Project>(base),
        get<ApiTask[]>(`${base}/tasks`),
        get<ApiRelations>(`${path}/relations`),
        get<Member[]>(`${base}/members`),
      ])
      setLoaded({ state: 'loaded', task, project, tasks, relations, members })
    },
    [path],
  )

  useEffect(() => {
    const abort = new AbortController()
    setLoaded({ state: 'loading' })
    load(abort.signal).catch((failure: unknown) => {
      if (abort.signal.aborted || toSignIn(failure)) return
      if (
        failure instanceof ApiError &&
        failure.status === 403 &&
        failure.error === 'Not Visible'
      ) {
        setLoaded({ state: 'not-visible', message: failure.message })
      } else if (
        failure instanceof ApiError &&
        (failure.status === 400 || failure.status === 404)
      ) {
        setLoaded({ state: 'not-visible', message: NOT_VISIBLE })
      } else {
        setLoaded({ state: 'failed' })
      }
    })
    return () => abort.abort()
  }, [load, toSignIn])

  useEffect(() => dialog.current?.focus(), [])

  /** Saves a change and reads the task again; gives whether it was saved. A refusal is shown. */
  const change = async (to: string, method: string, body: unknown): Promise<boolean> => {
    setError(null)
    setSaving(true)
    try {
      await api(to, { method, body })
    } catch (refused) {
      setSaving(false)
      if (toSignIn(refused)) return false
      setError(refusal(refused))
      return false
    }
    onChanged?.()
    await load().catch((failure: unknown) => {
      if (!toSignIn(failure)) setLoaded({ state: 'failed' })
    })
    setSaving(false)
    return true
  }

  const title = loaded.state === 'loaded' ? loaded.task.title : 'Task'

  return (
    <div className="gantt-export__backdrop">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-dialog-title"
        tabIndex={-1}
        className="gantt-export gantt-task"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <h2 id="task-dialog-title" className="gantt-export__title">
          {title}
        </h2>
        {loaded.state === 'loading' && <p className="gantt-task__muted">Loading…</p>}
        {loaded.state === 'failed' && (
          <p role="alert" className="gantt-task__error">
            The task could not be loaded.
          </p>
        )}
        {loaded.state === 'not-visible' && (
          <p role="alert" className="gantt-task__error">
            {loaded.message}
          </p>
        )}
        {loaded.state === 'loaded' && (
          <TaskContent
            {...loaded}
            viewer={viewer?.id}
            error={error}
            saving={saving}
            change={change}
            onClose={onClose}
          />
        )}
        <div className="gantt-export__actions">
          {loaded.state === 'loaded' && (
            <Link to={path} className="task-dialog__page-link">
              Open the task&apos;s page
            </Link>
          )}
          <button type="button" className="gantt__button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

/** What the dialog shows of a task it has read, and the controls the viewer's role allows. */
function TaskContent({
  task,
  project,
  tasks,
  relations,
  members,
  viewer,
  error,
  saving,
  change,
  onClose,
}: Loaded & {
  viewer: string | undefined
  error: string | null
  saving: boolean
  change: (to: string, method: string, body: unknown) => Promise<boolean>
  onClose: () => void
}) {
  const path = `/tasks/${encodeURIComponent(task.id)}`
  const access = taskAccess(project.role, viewer, task)
  const titleOf = new Map(tasks.map((other) => [other.id, other.title]))
  const others = tasks.filter((other) => other.id !== task.id)
  const blockers = relations.blockedBy
  const parentId = relations.parent?.id ?? null
  const nameOf = (id: string | null) =>
    id === null ? null : (titleOf.get(id) ?? 'A milestone of another project')

  return (
    <>
      <p className="gantt-task__muted">In {project.name}</p>
      {error !== null && (
        <p role="alert" className="gantt-task__error">
          {error}
        </p>
      )}
      {access.statuses.length > 0 ? (
        <StatusForm
          key={task.status}
          status={task.status}
          moves={access.statuses}
          disabled={saving}
          onSave={(status) =>
            change(
              status === 'cancelled' ? `${path}/cancel` : `${path}/status`,
              status === 'cancelled' ? 'POST' : 'PUT',
              status === 'cancelled' ? {} : { status },
            )
          }
        />
      ) : (
        <p className="task-dialog__status">
          Status: <strong>{statusName(task.status)}</strong>
        </p>
      )}
      {access.edit ? (
        <EditForm
          // Read again once saved, as the scheduler may have moved it.
          key={JSON.stringify(task)}
          task={task}
          members={members}
          onCancel={onClose}
          onSave={async (changes: TaskChanges) => {
            if (Object.keys(changes).length === 0 || (await change(path, 'PATCH', changes))) {
              onClose()
            }
          }}
        />
      ) : (
        <TaskDetails task={task} members={members} />
      )}
      <section className="gantt-task__section" aria-labelledby="task-dialog-blockers">
        <h3 id="task-dialog-blockers" className="gantt-task__heading">
          Blocked by
        </h3>
        {blockers.length === 0 ? (
          <p className="gantt-task__muted">Nothing</p>
        ) : (
          <ul className="gantt-task__list" aria-labelledby="task-dialog-blockers">
            {blockers.map((blocker) => {
              const name = nameOf(blocker.id)
              return (
                <li key={blocker.id} className="gantt-task__item">
                  <span>{name}</span>
                  {access.edit && (
                    <button
                      type="button"
                      className="gantt__button"
                      aria-label={`Remove the blocker ${name}`}
                      disabled={saving}
                      onClick={() =>
                        void change(
                          `${path}/blocked-by/${encodeURIComponent(blocker.id)}`,
                          'DELETE',
                          undefined,
                        )
                      }
                    >
                      Remove
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {access.edit && (
          <ChoiceForm
            label="Add a blocker"
            button="Add"
            choices={others.filter((other) => !blockers.some((b) => b.id === other.id))}
            initial=""
            required
            disabled={saving}
            onSave={(blockerId) => change(`${path}/blocked-by`, 'POST', { blockerId })}
          />
        )}
      </section>
      <section className="gantt-task__section" aria-labelledby="task-dialog-parent">
        <h3 id="task-dialog-parent" className="gantt-task__heading">
          Parent
        </h3>
        {access.edit ? (
          <ChoiceForm
            key={parentId}
            label="Subtask of"
            button="Set parent"
            choices={others}
            initial={parentId ?? ''}
            none="None"
            disabled={saving}
            onSave={(chosen) => change(`${path}/parent`, 'PUT', { parentId: chosen || null })}
          />
        ) : (
          <p className="gantt-task__muted">{nameOf(parentId) ?? 'None'}</p>
        )}
      </section>
    </>
  )
}

/** How each status is named, as the Kanban's columns name it. */
function statusName(status: TaskStatus): string {
  return COLUMNS.find((column) => column.status === status)?.name ?? status
}

/** The task's fields, shown to a viewer whose role cannot change them: those the editor offers. */
function TaskDetails({ task, members }: { task: KanbanTask; members: readonly Member[] }) {
  const day = (date: string | null) => (date ? formatDay(date, true) : 'Not set')
  const usernames = new Map(members.map((member) => [member.accountId, member.username]))
  const rows: [string, ReactNode][] = []
  if (task.milestone) {
    rows.push(['Milestone', task.milestone.variant === 'fixed-date' ? 'Fixed date' : 'Floating'])
    rows.push(['Date', day(task.milestone.date)])
  } else {
    rows.push(['Planned start', day(task.plannedStart)])
    rows.push([
      'Duration in working days',
      task.durationWorkingDays === null ? 'Not set' : String(task.durationWorkingDays),
    ])
    rows.push(['Planned finish', day(task.plannedFinish)])
    rows.push(['AI share', task.aiShare === null ? 'Not set' : `${task.aiShare}%`])
    if (task.aiShare === AI_ONLY_SHARE && task.personLoad != null) {
      rows.push(['Person load', `${task.personLoad}%`])
    }
    rows.push([
      'Assigned',
      task.assignees.length === 0
        ? 'No one'
        : task.assignees
            .map((id) => usernames.get(id) ?? 'Not a member of this project')
            .join(', '),
    ])
  }
  return (
    <dl className="task-dialog__details" aria-label="Details">
      {rows.map(([term, value]) => (
        <div key={term} className="task-dialog__detail">
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The status of the task, changed to one of `moves`: those the viewer's role allows. */
function StatusForm({
  status,
  moves,
  disabled,
  onSave,
}: {
  status: TaskStatus
  moves: readonly TaskStatus[]
  disabled: boolean
  onSave: (status: TaskStatus) => Promise<boolean>
}) {
  const [chosen, setChosen] = useState<TaskStatus>(status)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (chosen !== status) void onSave(chosen)
  }
  return (
    <form className="gantt-task__inline" onSubmit={submit}>
      <label className="gantt-task__label">
        Status
        <select
          value={chosen}
          onChange={(event) => {
            const next = COLUMNS.find((column) => column.status === event.target.value)
            if (next) setChosen(next.status)
          }}
        >
          {COLUMNS.filter(
            (column) => column.status === status || moves.includes(column.status),
          ).map((column) => (
            <option key={column.status} value={column.status}>
              {column.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="gantt__button" disabled={disabled || chosen === status}>
        Change status
      </button>
    </form>
  )
}

/** A task chosen among `choices`, and saved with `button`. */
function ChoiceForm({
  label,
  button,
  choices,
  initial,
  none,
  required = false,
  disabled,
  onSave,
}: {
  label: string
  button: string
  choices: readonly ApiTask[]
  initial: string
  /** The words for choosing no task, if that can be chosen. */
  none?: string
  required?: boolean
  disabled: boolean
  onSave: (id: string) => Promise<boolean>
}) {
  const [chosen, setChosen] = useState(initial)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if ((await onSave(chosen)) && required) setChosen('')
  }
  return (
    <form className="gantt-task__inline" onSubmit={(event) => void submit(event)}>
      <label className="gantt-task__label">
        {label}
        <select
          value={chosen}
          required={required}
          onChange={(event) => setChosen(event.target.value)}
        >
          <option value="">{none ?? 'Choose a task'}</option>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.title}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="gantt__button"
        disabled={disabled || (!required && chosen === initial)}
      >
        {button}
      </button>
    </form>
  )
}
