import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.ts'
import { ExportDialog } from '../gantt/ExportDialog.tsx'
import { Gantt, type PeopleById } from '../gantt/Gantt.tsx'
import {
  type ApiBaseline,
  type ApiCalendar,
  type ApiRedFlag,
  type ApiRelations,
  type ApiTask,
  buildGanttModel,
  formatDay,
} from '../gantt/gantt-model.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { useProject } from './project-context.ts'

/** A baseline of the project as the API lists it (`GET /projects/{id}/baselines`). */
interface BaselineSummary {
  id: string
  name: string
  savedAt: string
}

interface Plan {
  tasks: ApiTask[]
  relations: ApiRelations[]
  flags: ApiRedFlag[]
  calendar: ApiCalendar
  baselines: BaselineSummary[]
  people: PeopleById
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
 */
export function GanttPage() {
  const project = useProject()
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [selected, setSelected] = useState<Selected>({ state: 'none' })
  const [exporting, setExporting] = useState(false)
  const exportButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const abort = new AbortController()
    const get = <T,>(path: string) => api<T>(path, { signal: abort.signal })
    const base = `/projects/${encodeURIComponent(project.id)}`
    setLoaded({ state: 'loading' })
    setSelected({ state: 'none' })
    Promise.all([
      get<ApiTask[]>(`${base}/tasks`),
      get<ApiRedFlag[]>(`${base}/red-flags`),
      get<ApiCalendar>('/calendar'),
      get<{ accountId: string; username: string }[]>(`${base}/members`),
      get<BaselineSummary[]>(`${base}/baselines`),
    ])
      .then(async ([tasks, flags, calendar, members, baselines]) => {
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
        })
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        setLoaded({ state: 'failed' })
      })
    return () => abort.abort()
  }, [project.id, toSignIn])

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
  const model = useMemo(
    () =>
      loaded.state === 'loaded'
        ? buildGanttModel(loaded.tasks, loaded.relations, loaded.flags, loaded.calendar, baseline)
        : null,
    [loaded, baseline],
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

  return (
    <>
      <div className="gantt__toolbar">
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
      <Gantt
        name={`Gantt of ${project.name}`}
        model={model}
        people={loaded.people}
        today={localDate(new Date())}
      />
      {exporting && (
        <ExportDialog projectId={project.id} projectName={project.name} onClose={closeExport} />
      )}
    </>
  )
}
