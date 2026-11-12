import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import { Gantt, type PeopleById } from '../gantt/Gantt.tsx'
import {
  type ApiCalendar,
  type ApiRedFlag,
  type ApiRelations,
  type ApiTask,
  buildGanttModel,
  type GanttModel,
} from '../gantt/gantt-model.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { useProject } from './project-context.ts'

type Loaded =
  | { state: 'loading' }
  | { state: 'loaded'; model: GanttModel; people: PeopleById }
  | { state: 'failed' }

/** Today in the browser's time zone, `YYYY-MM-DD`. */
function localToday(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * The Gantt of a project (SC-031), at `/projects/<id>/gantt`, inside the project's page. It reads
 * the project's tasks, each task's relations, the project's red flags, its members and the global
 * calendar through the REST API, and draws them; anyone with a role in the project can open it
 * (FR-106). It shows the plan as it was when opened; reloading the page reads it again.
 */
export function GanttPage() {
  const project = useProject()
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })

  useEffect(() => {
    const abort = new AbortController()
    const get = <T,>(path: string) => api<T>(path, { signal: abort.signal })
    const base = `/projects/${encodeURIComponent(project.id)}`
    setLoaded({ state: 'loading' })
    Promise.all([
      get<ApiTask[]>(`${base}/tasks`),
      get<ApiRedFlag[]>(`${base}/red-flags`),
      get<ApiCalendar>('/calendar'),
      get<{ accountId: string; username: string }[]>(`${base}/members`),
    ])
      .then(async ([tasks, flags, calendar, members]) => {
        const relations = await Promise.all(
          tasks.map((task) => get<ApiRelations>(`/tasks/${encodeURIComponent(task.id)}/relations`)),
        )
        setLoaded({
          state: 'loaded',
          model: buildGanttModel(tasks, relations, flags, calendar),
          people: new Map(members.map((member) => [member.accountId, member.username])),
        })
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        setLoaded({ state: 'failed' })
      })
    return () => abort.abort()
  }, [project.id, toSignIn])

  if (loaded.state === 'loading') return <p className="page__note">Loading…</p>
  if (loaded.state === 'failed') {
    return (
      <p role="alert" className="page__note">
        The Gantt could not be loaded.
      </p>
    )
  }
  return (
    <Gantt
      name={`Gantt of ${project.name}`}
      model={loaded.model}
      people={loaded.people}
      today={localToday()}
    />
  )
}
