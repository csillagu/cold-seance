import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.ts'
import { type ApiRelations, formatDay } from '../gantt/gantt-model.ts'
import type { KanbanTask } from '../kanban/kanban-model.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { SaveBaselineDialog, type SavedBaseline } from '../variance/SaveBaselineDialog.tsx'
import { type ApiVariance, buildVarianceModel } from '../variance/variance-model.ts'
import { VarianceView } from '../variance/VarianceView.tsx'
import '../variance/variance.css'
import { useProject } from './project-context.ts'

/** A baseline of the project as the API lists it (`GET /projects/{id}/baselines`). */
type BaselineSummary = SavedBaseline

interface Plan {
  tasks: KanbanTask[]
  relations: ApiRelations[]
  baselines: BaselineSummary[]
}

type Loaded = { state: 'loading' } | ({ state: 'loaded' } & Plan) | { state: 'failed' }

/** The variance against the selected baseline: being read, read, or not read. */
type Compared =
  | { state: 'loading'; id: string }
  | { state: 'loaded'; id: string; variance: ApiVariance }
  | { state: 'failed'; id: string }

/** `date` as `YYYY-MM-DD` in the browser's time zone. */
function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * The baseline variance view of a project (SC-033), at `/projects/<id>/variance`, inside the
 * project's page. It reads the project's baselines, its tasks and each task's relations through the
 * REST API, and the variance against the selected baseline, which the variance calculator computes
 * when it is read (DD-037); anyone with a role in the project can open it (FR-106). The baseline
 * saved last is selected when it opens; another can be selected above the table, which only reads
 * it.
 *
 * The view is read-only (FR-052): it changes no task and no baseline. "Save baseline" opens the
 * baseline save dialog (SC-097), which saves a new baseline beside the others; once saved, it is
 * selected.
 */
export function VariancePage() {
  const project = useProject()
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [selected, setSelected] = useState<string | null>(null)
  const [compared, setCompared] = useState<Compared | null>(null)
  const [saving, setSaving] = useState(false)
  const saveButton = useRef<HTMLButtonElement>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const get = <T,>(path: string) => api<T>(path, { signal })
      const base = `/projects/${encodeURIComponent(project.id)}`
      const [tasks, baselines] = await Promise.all([
        get<KanbanTask[]>(`${base}/tasks`),
        get<BaselineSummary[]>(`${base}/baselines`),
      ])
      const relations = await Promise.all(
        tasks.map((task) => get<ApiRelations>(`/tasks/${encodeURIComponent(task.id)}/relations`)),
      )
      setLoaded({ state: 'loaded', tasks, relations, baselines })
      return baselines
    },
    [project.id],
  )

  useEffect(() => {
    const abort = new AbortController()
    setLoaded({ state: 'loading' })
    setSelected(null)
    load(abort.signal).then(
      (baselines) => setSelected(baselines.at(-1)?.id ?? null),
      (error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        setLoaded({ state: 'failed' })
      },
    )
    return () => abort.abort()
  }, [load, toSignIn])

  useEffect(() => {
    const abort = new AbortController()
    if (selected === null) {
      setCompared(null)
    } else {
      setCompared({ state: 'loading', id: selected })
      api<ApiVariance>(`/baselines/${encodeURIComponent(selected)}/variance`, {
        signal: abort.signal,
      }).then(
        (variance) => setCompared({ state: 'loaded', id: selected, variance }),
        (error: unknown) => {
          if (abort.signal.aborted || toSignIn(error)) return
          setCompared({ state: 'failed', id: selected })
        },
      )
    }
    return () => abort.abort()
  }, [selected, toSignIn])

  const model = useMemo(
    () =>
      loaded.state === 'loaded' && compared?.state === 'loaded'
        ? buildVarianceModel(
            compared.variance,
            loaded.tasks,
            loaded.relations,
            localDate(new Date()),
          )
        : null,
    [loaded, compared],
  )

  const closeDialog = () => {
    setSaving(false)
    saveButton.current?.focus()
  }

  const saved = (baseline: SavedBaseline) => {
    setSaving(false)
    load().then(
      () => setSelected(baseline.id),
      (error: unknown) => {
        if (!toSignIn(error)) setLoaded({ state: 'failed' })
      },
    )
  }

  if (loaded.state === 'failed') {
    return (
      <p role="alert" className="page__note">
        The baseline variance view could not be loaded.
      </p>
    )
  }
  if (loaded.state === 'loading') return <p className="page__note">Loading…</p>

  return (
    <div className="variance">
      <div className="variance__toolbar">
        {loaded.baselines.length > 0 && (
          <>
            <label htmlFor="variance-baseline">Baseline</label>
            <select
              id="variance-baseline"
              className="variance__select"
              value={selected ?? ''}
              onChange={(event) => setSelected(event.target.value)}
            >
              {loaded.baselines.map((summary) => (
                <option key={summary.id} value={summary.id}>
                  {summary.name} · saved {formatDay(localDate(new Date(summary.savedAt)), true)}
                </option>
              ))}
            </select>
          </>
        )}
        <span className="variance__pill">
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          >
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          Read-only
        </span>
        <span className="variance__explain">
          Variance in working days of the global calendar. Actual dates are used where a task has
          them, the current plan where it has none.
        </span>
        <button
          ref={saveButton}
          type="button"
          className="variance__button"
          onClick={() => setSaving(true)}
        >
          Save baseline
        </button>
      </div>
      {loaded.baselines.length === 0 && (
        <p className="variance__status">
          No baseline of {project.name} has been saved yet. Save one to compare the plan against it.
        </p>
      )}
      {compared?.state === 'loading' && <p className="variance__status">Loading…</p>}
      {compared?.state === 'failed' && (
        <p role="alert" className="variance__status">
          The variance against the baseline could not be loaded.
        </p>
      )}
      {model && (
        <VarianceView
          name={`Baseline variance of ${project.name} against ${model.baseline}`}
          model={model}
        />
      )}
      {saving && (
        <SaveBaselineDialog
          projectId={project.id}
          projectName={project.name}
          onSaved={saved}
          onClose={closeDialog}
        />
      )}
    </div>
  )
}
