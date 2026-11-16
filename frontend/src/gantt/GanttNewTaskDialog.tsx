import { type FormEvent, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api.ts'
import { milestoneOn } from '../tasks/task-details.ts'
import { type GanttProject, newTaskProject } from './gantt-edit.ts'
import '../kanban/kanban.css'
import './gantt-export.css'
import './gantt-edit.css'

/** What a task is created with on the Gantt, as the REST API takes it (`POST /projects/{id}/tasks`). */
export interface NewTask {
  title: string
  plannedStart?: string
  durationWorkingDays?: number
  milestone?: ReturnType<typeof milestoneOn>
}

interface GanttNewTaskDialogProps {
  /** The projects the Gantt covers. */
  projects: readonly GanttProject[]
  /** The projects the view's filter allows, or null for a view with no filter on its projects. */
  filteredTo?: readonly string[] | null
  /** Creates the task in the project; rejects with the API's refusal. */
  onCreate: (projectId: string, task: NewTask) => Promise<void>
  onClose: () => void
}

/**
 * Creating a task on the Gantt (SC-067). On a Gantt covering several projects it asks which
 * project the task goes in, offering only those the viewer can write to, unless the view's filter
 * allows only one, which it then uses (FR-061). The task is created with its title, and its
 * planned start and duration if given, so that it is drawn on its dates. A duration of 0 makes it
 * a milestone, fixed to the planned start, or floating without one (FR-212).
 */
export function GanttNewTaskDialog({
  projects,
  filteredTo = null,
  onCreate,
  onClose,
}: GanttNewTaskDialogProps) {
  const where = newTaskProject(projects, filteredTo)
  const [title, setTitle] = useState('')
  const [start, setStart] = useState('')
  const [duration, setDuration] = useState('')
  const [project, setProject] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLInputElement>(null)
  const milestone = duration.trim() !== '' && Number(duration) === 0

  useEffect(() => first.current?.focus(), [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const projectId = where.ask ? project : where.project.id
    const task: NewTask = { title }
    if (milestone) task.milestone = milestoneOn(start)
    else {
      if (start !== '') task.plannedStart = start
      if (duration.trim() !== '') task.durationWorkingDays = Number(duration)
    }
    setError(null)
    setSaving(true)
    try {
      await onCreate(projectId, task)
      onClose()
    } catch (refused) {
      setError(
        refused instanceof ApiError ? refused.message : 'The task could not be created. Try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  const nowhere = where.ask && where.offered.length === 0

  return (
    <div className="gantt-export__backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gantt-new-task-title"
        className="gantt-export gantt-task"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <h2 id="gantt-new-task-title" className="gantt-export__title">
          New task
        </h2>
        {error !== null && (
          <p role="alert" className="gantt-task__error">
            {error}
          </p>
        )}
        <form
          className="kanban__form"
          aria-label="New task"
          onSubmit={(event) => void submit(event)}
        >
          {where.ask && (
            <label className="kanban__field">
              Project
              <select value={project} required onChange={(event) => setProject(event.target.value)}>
                <option value="">Choose a project</option>
                {where.offered.map((offered) => (
                  <option key={offered.id} value={offered.id}>
                    {offered.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {nowhere && (
            <p className="gantt-task__muted">
              You cannot create tasks in any of the projects this Gantt covers.
            </p>
          )}
          <label className="kanban__field">
            Title
            <input
              ref={first}
              value={title}
              required
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="kanban__field">
            Planned start
            <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label className="kanban__field">
            Duration in working days
            <input
              type="number"
              min="0"
              step="1"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </label>
          {milestone && (
            <p className="gantt-task__muted">
              {start === ''
                ? 'Duration 0: a floating milestone, placed where what it is blocked by finishes.'
                : 'Duration 0: a milestone fixed to the planned start.'}
            </p>
          )}
          <div className="gantt-export__actions">
            <button
              type="submit"
              className="gantt__button gantt__button--primary"
              disabled={saving || nowhere}
            >
              Create
            </button>
            <button type="button" className="gantt__button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
