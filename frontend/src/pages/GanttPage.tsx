import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api.ts'
import { ExportDialog } from '../gantt/ExportDialog.tsx'
import { Gantt, type GanttEditing, type PeopleById } from '../gantt/Gantt.tsx'
import { moveChanges } from '../gantt/gantt-edit.ts'
import { GanttNewTaskDialog, type NewTask } from '../gantt/GanttNewTaskDialog.tsx'
import type { KanbanTask } from '../kanban/kanban-model.ts'
import {
  type ApiBaseline,
  type ApiCalendar,
  type ApiRedFlag,
  type ApiRelations,
  buildGanttModel,
  formatDay,
} from '../gantt/gantt-model.ts'
import { PendingBanner } from '../proposals/PendingBanner.tsx'
import {
  loadOverlay,
  pendingChanges,
  pendingSummaries,
  type PendingProposal,
} from '../proposals/overlay.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { TaskDialog } from '../tasks/TaskDialog.tsx'
import type { Member } from '../tasks/TaskEditForm.tsx'
import { useProject } from './project-context.ts'

/** A baseline of the project as the API lists it (`GET /projects/{id}/baselines`). */
interface BaselineSummary {
  id: string
  name: string
  savedAt: string
}

interface Plan {
  tasks: KanbanTask[]
  relations: ApiRelations[]
  flags: ApiRedFlag[]
  calendar: ApiCalendar
  baselines: BaselineSummary[]
  people: PeopleById
  /** The proposals under review that change the project; null if they could not be read. */
  proposals: PendingProposal[] | null
}

type Loaded = { state: 'loading' } | ({ state: 'loaded' } & Plan) | { state: 'failed' }

/** The selected baseline: none, one being read, one read, or one that could not be read. */
type Selected =
  | { state: 'none' }
  | { state: 'loading'; id: string }
  | { state: 'loaded'; id: string; baseline: ApiBaseline }
  | { state: 'failed'; id: string }

/** `date` as `YYYY-MM-DD` in the browser's time zone. */
function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * The Gantt of a project (SC-031), at `/projects/<id>/gantt`, inside the project's page. It reads
 * the project's tasks, each task's relations, the project's red flags, its baselines, its members
 * and the global calendar through the REST API, and draws them; anyone with a role in the project
 * can open it (FR-106). It shows the plan as it was when opened; reloading the page reads it again.
 *
 * Above it, a baseline can be selected, whose bars the Gantt then draws under the planned ones
 * (SC-065, FR-050); selecting one only reads it, and changes no task. The export dialog gives the
 * Gantt as a Mermaid chart for GitHub markdown (SC-096, FR-063).
 *
 * What it shows can be changed on it (SC-067, FR-053): a bar dragged to other days, a dependency
 * drawn between two bars, the rest in the task dialog its title or bar opens (#209), and a new task
 * created with "New task".
 * Each change goes to the REST API, which allows or refuses it by the viewer's role in the
 * project (FR-060); a refusal is shown above the Gantt, and once a change is saved the Gantt is
 * read again, as the scheduler may have moved other tasks with it.
 *
 * Each proposal under review that changes the project is read with its live preview, and what it
 * would change is drawn as pending, apart from the live plan, with a line above the Gantt naming
 * it and linking to its review (SC-068, FR-073). Reading it changes nothing in the plan.
 */
export function GanttPage() {
  const project = useProject()
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [selected, setSelected] = useState<Selected>({ state: 'none' })
  const [exporting, setExporting] = useState(false)
  const exportButton = useRef<HTMLButtonElement>(null)
  /** The task whose dialog is open, by id. */
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const newTaskButton = useRef<HTMLButtonElement>(null)
  /** What the API said of the last change made on the Gantt itself that it refused. */
  const [refused, setRefused] = useState<string | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const get = <T,>(path: string) => api<T>(path, { signal })
      const base = `/projects/${encodeURIComponent(project.id)}`
      const [tasks, flags, calendar, members, baselines, proposals] = await Promise.all([
        get<KanbanTask[]>(`${base}/tasks`),
        get<ApiRedFlag[]>(`${base}/red-flags`),
        get<ApiCalendar>('/calendar'),
        get<Member[]>(`${base}/members`),
        get<BaselineSummary[]>(`${base}/baselines`),
        loadOverlay(project.id, signal),
      ])
      const relations = await Promise.all(
        tasks.map((task) => get<ApiRelations>(`/tasks/${encodeURIComponent(task.id)}/relations`)),
      )
      setLoaded({
        state: 'loaded',
        tasks,
        relations,
        flags,
        calendar,
        baselines,
        people: new Map(members.map((member) => [member.accountId, member.username])),
        proposals,
      })
    },
    [project.id],
  )

  useEffect(() => {
    const abort = new AbortController()
    setLoaded({ state: 'loading' })
    setSelected({ state: 'none' })
    load(abort.signal).catch((error: unknown) => {
      if (abort.signal.aborted || toSignIn(error)) return
      setLoaded({ state: 'failed' })
    })
    return () => abort.abort()
  }, [load, toSignIn])

  /** Saves a change through the REST API, then reads the Gantt again; rejects with a refusal. */
  const save = useCallback(
    async (path: string, method: string, body: unknown) => {
      try {
        await api(path, { method, body })
      } catch (error) {
        if (toSignIn(error)) return
        throw error
      }
      await load().catch((error: unknown) => {
        if (!toSignIn(error)) setLoaded({ state: 'failed' })
      })
    },
    [load, toSignIn],
  )

  const ganttEditing = useMemo<GanttEditing>(() => {
    /** Saves a change made on the Gantt itself, and says above it if it was refused. */
    const attempt = (path: string, method: string, body: unknown, failed: string) => {
      setRefused(null)
      save(path, method, body).catch((error: unknown) => {
        const why = error instanceof ApiError ? error.message : 'Try again.'
        setRefused(`${failed}: ${why}`)
      })
    }
    return {
      onMove: (task, start, days) =>
        attempt(
          `/tasks/${encodeURIComponent(task.id)}`,
          'PATCH',
          moveChanges(task, start, days),
          `${task.title} was not moved`,
        ),
      onLink: (task, blocker) =>
        attempt(
          `/tasks/${encodeURIComponent(task.id)}/blocked-by`,
          'POST',
          { blockerId: blocker.id },
          `${task.title} was not made blocked by ${blocker.title}`,
        ),
    }
  }, [save])

  const open = useCallback((task: { id: string }) => {
    setRefused(null)
    setEditing(task.id)
  }, [])

  /** Reads the Gantt again, after a change made in the task dialog. */
  const reload = useCallback(() => {
    load().catch((error: unknown) => {
      if (!toSignIn(error)) setLoaded({ state: 'failed' })
    })
  }, [load, toSignIn])

  const create = useCallback(
    (projectId: string, task: NewTask) =>
      save(`/projects/${encodeURIComponent(projectId)}/tasks`, 'POST', task),
    [save],
  )

  const selectedId = selected.state === 'none' ? null : selected.id
  useEffect(() => {
    const abort = new AbortController()
    if (selectedId !== null) {
      api<ApiBaseline>(`/baselines/${encodeURIComponent(selectedId)}`, {
        signal: abort.signal,
      }).then(
        (baseline) => setSelected({ state: 'loaded', id: selectedId, baseline }),
        (error: unknown) => {
          if (abort.signal.aborted || toSignIn(error)) return
          setSelected({ state: 'failed', id: selectedId })
        },
      )
    }
    return () => abort.abort()
  }, [selectedId, toSignIn])

  const baseline = selected.state === 'loaded' ? selected.baseline : null
  const pending = useMemo(() => {
    if (loaded.state !== 'loaded') return []
    return pendingChanges(loaded.proposals ?? [], project.id, {
      people: loaded.people,
      projects: new Map([[project.id, project.name]]),
      tasks: new Map(loaded.tasks.map((task) => [task.id, task.title])),
    })
  }, [loaded, project.id, project.name])
  const model = useMemo(
    () =>
      loaded.state === 'loaded'
        ? buildGanttModel(
            loaded.tasks,
            loaded.relations,
            loaded.flags,
            loaded.calendar,
            baseline,
            pending,
          )
        : null,
    [loaded, baseline, pending],
  )

  if (loaded.state === 'failed') {
    return (
      <p role="alert" className="page__note">
        The Gantt could not be loaded.
      </p>
    )
  }
  if (loaded.state === 'loading' || !model) return <p className="page__note">Loading…</p>

  const closeExport = () => {
    setExporting(false)
    exportButton.current?.focus()
  }
  const closeNewTask = () => {
    setCreating(false)
    newTaskButton.current?.focus()
  }

  return (
    <>
      <div className="gantt__toolbar">
        <button
          ref={newTaskButton}
          type="button"
          className="gantt__button gantt__button--primary"
          onClick={() => {
            setRefused(null)
            setCreating(true)
          }}
        >
          New task
        </button>
        <label className="gantt__control">
          Baseline:
          <select
            value={selectedId ?? ''}
            onChange={(event) => {
              const id = event.target.value
              setSelected(id === '' ? { state: 'none' } : { state: 'loading', id })
            }}
          >
            <option value="">None</option>
            {loaded.baselines.map((summary) => (
              <option key={summary.id} value={summary.id}>
                {summary.name} ({formatDay(localDate(new Date(summary.savedAt)))})
              </option>
            ))}
          </select>
        </label>
        <button
          ref={exportButton}
          type="button"
          className="gantt__button"
          onClick={() => setExporting(true)}
        >
          Export as Mermaid
        </button>
        {selected.state === 'loading' && <span className="gantt__status-text">Loading…</span>}
        {selected.state === 'failed' && (
          <span role="alert" className="gantt__status-text">
            The baseline could not be loaded.
          </span>
        )}
      </div>
      {refused !== null && (
        <p role="alert" className="gantt__refusal">
          {refused}
        </p>
      )}
      <PendingBanner summaries={loaded.proposals && pendingSummaries(loaded.proposals, pending)} />
      <Gantt
        name={`Gantt of ${project.name}`}
        model={model}
        people={loaded.people}
        today={localDate(new Date())}
        editing={ganttEditing}
        onOpen={open}
      />
      {editing !== null && (
        <TaskDialog taskId={editing} onClose={() => setEditing(null)} onChanged={reload} />
      )}
      {creating && (
        <GanttNewTaskDialog
          projects={[{ id: project.id, name: project.name, writable: true }]}
          onCreate={create}
          onClose={closeNewTask}
        />
      )}
      {exporting && (
        <ExportDialog projectId={project.id} projectName={project.name} onClose={closeExport} />
      )}
    </>
  )
}
