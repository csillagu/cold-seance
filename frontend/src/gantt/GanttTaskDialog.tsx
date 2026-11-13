import { type FormEvent, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api.ts'
import { EditForm, type Member, type TaskChanges } from '../kanban/Kanban.tsx'
import { COLUMNS, type KanbanTask, movesFrom } from '../kanban/kanban-model.ts'
import type { ApiRelations, ApiTask, TaskStatus } from './gantt-model.ts'
import './gantt-export.css'
import './gantt-edit.css'

/** Saves a change through the REST API; rejects with the API's refusal. */
export type SaveChange = (path: string, method: string, body: unknown) => Promise<void>

interface GanttTaskDialogProps {
  task: KanbanTask
  /** The tasks of the task's project, to choose its blockers and its parent among. */
  tasks: readonly ApiTask[]
  /** The task's relations, as read with the Gantt. */
  relations: ApiRelations | undefined
  /** The people who can be assigned to it: those with a role in its project. */
  members: readonly Member[]
  save: SaveChange
  onClose: () => void
}

/** What the API said when it refused a change, or a plain word when it said nothing. */
function refusal(error: unknown): string {
  return error instanceof ApiError ? error.message : 'The change could not be saved. Try again.'
}

/**
 * The editor of a task on the Gantt (SC-067, FR-053): everything the Gantt shows of a task that a
 * person sets, changed without leaving the Gantt. Its fields are the Kanban's edit form; besides
 * them, its status, the tasks it is blocked by (the Gantt's arrows) and its parent (the Gantt's
 * indentation). Each change goes to the REST API, which allows or refuses it by the viewer's role
 * in the task's project (FR-060); a refusal is shown in the editor.
 */
export function GanttTaskDialog({
  task,
  tasks,
  relations,
  members,
  save,
  onClose,
}: GanttTaskDialogProps) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  const path = `/tasks/${encodeURIComponent(task.id)}`

  useEffect(() => dialog.current?.focus(), [])

  /** Saves a change, and gives whether it was saved; a refusal is shown. */
  const change = async (to: string, method: string, body: unknown): Promise<boolean> => {
    setError(null)
    setSaving(true)
    try {
      await save(to, method, body)
      return true
    } catch (refused) {
      setError(refusal(refused))
      return false
    } finally {
      setSaving(false)
    }
  }

  const titleOf = new Map(tasks.map((other) => [other.id, other.title]))
  const others = tasks.filter((other) => other.id !== task.id)
  const blockers = relations?.blockedBy ?? []
  const parentId = relations?.parent?.id ?? null

  return (
    <div className="gantt-export__backdrop">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gantt-task-title"
        tabIndex={-1}
        className="gantt-export gantt-task"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <h2 id="gantt-task-title" className="gantt-export__title">
          Edit {task.title}
        </h2>
        {error !== null && (
          <p role="alert" className="gantt-task__error">
            {error}
          </p>
        )}
        <StatusForm
          key={task.status}
          status={task.status}
          disabled={saving}
          onSave={(status) =>
            change(
              status === 'cancelled' ? `${path}/cancel` : `${path}/status`,
              status === 'cancelled' ? 'POST' : 'PUT',
              status === 'cancelled' ? {} : { status },
            )
          }
        />
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
        <section className="gantt-task__section" aria-labelledby="gantt-task-blockers">
          <h3 id="gantt-task-blockers" className="gantt-task__heading">
            Blocked by
          </h3>
          {blockers.length === 0 ? (
            <p className="gantt-task__muted">Nothing</p>
          ) : (
            <ul className="gantt-task__list" aria-labelledby="gantt-task-blockers">
              {blockers.map((blocker) => {
                const title = titleOf.get(blocker.id) ?? 'A milestone of another project'
                return (
                  <li key={blocker.id} className="gantt-task__item">
                    <span>{title}</span>
                    <button
                      type="button"
                      className="gantt__button"
                      aria-label={`Remove the blocker ${title}`}
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
                  </li>
                )
              })}
            </ul>
          )}
          <ChoiceForm
            label="Add a blocker"
            button="Add"
            choices={others.filter((other) => !blockers.some((b) => b.id === other.id))}
            initial=""
            required
            disabled={saving}
            onSave={(blockerId) => change(`${path}/blocked-by`, 'POST', { blockerId })}
          />
        </section>
        <section className="gantt-task__section" aria-labelledby="gantt-task-parent">
          <h3 id="gantt-task-parent" className="gantt-task__heading">
            Parent
          </h3>
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
        </section>
        <div className="gantt-export__actions">
          <button type="button" className="gantt__button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

/** The status of the task, changed to any it can move to (SC-003, SC-038), as on the Kanban. */
function StatusForm({
  status,
  disabled,
  onSave,
}: {
  status: TaskStatus
  disabled: boolean
  onSave: (status: TaskStatus) => Promise<boolean>
}) {
  const [chosen, setChosen] = useState<TaskStatus>(status)
  const moves = movesFrom(status)
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
          disabled={moves.length === 0}
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
