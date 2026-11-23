import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { api } from '../api.ts'
import type { ApiTask } from '../gantt/gantt-model.ts'
import {
  type ApiMember,
  type ApiPersonLoad,
  type ApiRating,
  buildRows,
  daysOf,
  type LoadRow,
  noLoadTasks,
  type NoLoadTask,
  type Span,
  spanOf,
  spanProblem,
  today,
} from '../load/load-model.ts'
import { PersonLoad } from '../load/PersonLoad.tsx'
import { RatingPanel } from '../load/RatingPanel.tsx'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { TaskDialog } from '../tasks/TaskDialog.tsx'
import { useProject } from './project-context.ts'

type Loaded =
  | { state: 'loading' }
  | {
      state: 'loaded'
      rows: LoadRow[]
      ratings: ApiRating[]
      noLoad: NoLoadTask[]
      people: ReadonlyMap<string, string>
      projectNames: ReadonlyMap<string, string>
    }
  | { state: 'failed' }

/**
 * The person load view of a project (SC-032, SC-069), at `/projects/<id>/load`, inside the
 * project's page. It shows each member of the project, every day of a span, with their whole load
 * across all projects as the REST API gives it to the viewer, and below it the project's eligible
 * but unassigned tasks, each rated by load. The span is four weeks from this week's Monday unless
 * the address asks for another (`?from=YYYY-MM-DD&to=YYYY-MM-DD`), which the form above the view
 * changes. Anyone with a role in the project can open it (FR-106); it changes nothing itself. A
 * task's title opens the task dialog (#209), and the view is read again after a change saved there.
 */
export function PersonLoadPage() {
  const project = useProject()
  const toSignIn = useSignInRedirect()
  const [params, setParams] = useSearchParams()
  const span = useMemo(() => spanOf(params, today()), [params])
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  /** The task whose dialog is open, by id. */
  const [open, setOpen] = useState<string | null>(null)
  /** Counts the changes saved in the task dialog, so that the view is read again after each. */
  const [changes, setChanges] = useState(0)

  useEffect(() => {
    const abort = new AbortController()
    const get = <T,>(path: string) => api<T>(path, { signal: abort.signal })
    const base = `/projects/${encodeURIComponent(project.id)}`
    setLoaded({ state: 'loading' })
    ;(async () => {
      const [members, tasks, ratings] = await Promise.all([
        get<ApiMember[]>(`${base}/members`),
        get<ApiTask[]>(`${base}/tasks`),
        get<ApiRating[]>(`${base}/unassigned-task-ratings`),
      ])
      const query = `from=${span.from}&to=${span.to}`
      const loads = await Promise.all(
        members.map((member) =>
          get<ApiPersonLoad>(`/accounts/${encodeURIComponent(member.accountId)}/load?${query}`),
        ),
      )
      const projectNames = await namesOf(
        { id: project.id, name: project.name },
        loads.flatMap((load) => load.days.flatMap((day) => day.tasks.map((t) => t.projectId))),
        get,
      )
      setLoaded({
        state: 'loaded',
        rows: buildRows(members, new Map(loads.map((load) => [load.accountId, load]))),
        ratings,
        noLoad: noLoadTasks(tasks, new Set(ratings.map((rating) => rating.taskId))),
        people: new Map(members.map((member) => [member.accountId, member.username])),
        projectNames,
      })
    })().catch((error: unknown) => {
      if (abort.signal.aborted || toSignIn(error)) return
      setLoaded({ state: 'failed' })
    })
    return () => abort.abort()
  }, [project.id, project.name, span.from, span.to, toSignIn, changes])

  return (
    <>
      <SpanForm
        key={`${span.from}/${span.to}`}
        span={span}
        onShow={(next) => setParams({ from: next.from, to: next.to })}
      />
      {loaded.state === 'loading' && <p className="page__note">Loading…</p>}
      {loaded.state === 'failed' && (
        <p role="alert" className="page__note">
          The person load view could not be loaded.
        </p>
      )}
      {loaded.state === 'loaded' && (
        <>
          <PersonLoad
            name={`Person load of ${project.name}`}
            projectId={project.id}
            days={daysOf(span)}
            rows={loaded.rows}
            projectNames={loaded.projectNames}
            noLoad={loaded.noLoad}
            people={loaded.people}
            onOpen={setOpen}
          />
          <div className="load">
            <RatingPanel ratings={loaded.ratings} people={loaded.people} onOpen={setOpen} />
          </div>
        </>
      )}
      {open !== null && (
        <TaskDialog
          taskId={open}
          onClose={() => setOpen(null)}
          onChanged={() => setChanges((count) => count + 1)}
        />
      )}
    </>
  )
}

/**
 * The names of the projects other than `project` that the viewer can read tasks of, by id, so
 * that the view names another project's task by its project. A project whose name cannot be read
 * is left out, and its tasks are named as of another project.
 */
async function namesOf(
  project: { id: string; name: string },
  ids: readonly string[],
  get: <T>(path: string) => Promise<T>,
): Promise<Map<string, string>> {
  const names = new Map([[project.id, project.name]])
  const others = [...new Set(ids)].filter((id) => id !== project.id)
  const found = await Promise.all(
    others.map((id) =>
      get<{ id: string; name: string }>(`/projects/${encodeURIComponent(id)}`).catch(() => null),
    ),
  )
  for (const other of found) if (other) names.set(other.id, other.name)
  return names
}

/** The form that chooses the days the view covers. */
function SpanForm({ span, onShow }: { span: Span; onShow: (span: Span) => void }) {
  const [from, setFrom] = useState(span.from)
  const [to, setTo] = useState(span.to)
  const [problem, setProblem] = useState<string | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found = spanProblem({ from, to })
    setProblem(found)
    if (found === null) onShow({ from, to })
  }
  /** Shows the span as soon as a changed date makes it a whole, valid one (#256). */
  const change = (next: Span) => {
    setFrom(next.from)
    setTo(next.to)
    if (next.from === '' || next.to === '') return
    const found = spanProblem(next)
    setProblem(found)
    if (found === null && (next.from !== span.from || next.to !== span.to)) onShow(next)
  }

  return (
    <form className="load__span" aria-label="Days shown" onSubmit={submit}>
      <label className="load__field">
        From
        <input
          type="date"
          value={from}
          onChange={(event) => change({ from: event.target.value, to })}
        />
      </label>
      <label className="load__field">
        To
        <input
          type="date"
          value={to}
          onChange={(event) => change({ from, to: event.target.value })}
        />
      </label>
      <button type="submit" className="load__show">
        Show
      </button>
      {problem && (
        <p role="alert" className="load__problem">
          {problem}
        </p>
      )}
    </form>
  )
}
