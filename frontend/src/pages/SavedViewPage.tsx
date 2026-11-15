import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { api, ApiError } from '../api.ts'
import { Gantt, type PeopleById } from '../gantt/Gantt.tsx'
import {
  type ApiCalendar,
  type ApiRedFlag,
  type ApiRelations,
  buildGanttModel,
  type TaskStatus,
} from '../gantt/gantt-model.ts'
import { Kanban, type Member, type TaskChanges } from '../kanban/Kanban.tsx'
import { buildKanbanModel, type KanbanTask } from '../kanban/kanban-model.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { describeCondition } from '../views/filter.ts'
import { KIND_NAMES, type Named, placeOf, type SavedView } from '../views/saved-view.ts'
import '../views/saved-views.css'
import './pages.css'

/** A repository as the REST API lists it, the fields the page reads. */
interface Repository {
  id: string
  owner: string
  name: string
}

interface Opened {
  view: SavedView
  tasks: KanbanTask[]
  /** The projects the view covers, among those the viewer can read now. */
  projects: Named[]
  groups: Map<string, string>
  repositories: Map<string, string>
  flags: ApiRedFlag[]
  members: Map<string, Member[]>
  people: PeopleById
  /** For a Gantt: the calendar and each task's relations. */
  gantt: { calendar: ApiCalendar; relations: ApiRelations[] } | null
}

type Loaded =
  | { state: 'loading' }
  | ({ state: 'loaded' } & Opened)
  | { state: 'not-visible'; message: string }
  | { state: 'failed' }

/** `date` as `YYYY-MM-DD` in the browser's time zone. */
function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * A saved view, opened, at `/views/<id>`: its name, kind, where it is kept, the projects it covers
 * and its filter, and below them the view itself, a Kanban (SC-030) or a Gantt (SC-031) of the
 * tasks of the projects it covers that meet its filter, with the person opening it as the person
 * viewing it (FR-058). The REST API gives only the projects and tasks the viewer can read now, so a
 * view never shows a project they have lost access to (FR-059).
 *
 * Opening it changes nothing. A card moved or edited on its Kanban goes to the REST API, as on a
 * project's Kanban, and the view is read again once the change is saved; its Gantt only shows.
 */
export function SavedViewPage() {
  const { viewId = '' } = useParams()
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const get = <T,>(path: string) => api<T>(path, { signal })
      const base = `/saved-views/${encodeURIComponent(viewId)}`
      const [view, tasks, groups, repositories] = await Promise.all([
        get<SavedView>(base),
        get<KanbanTask[]>(`${base}/tasks`),
        get<Named[]>('/groups'),
        get<Repository[]>('/repositories'),
      ])
      const perProject = await Promise.all(
        view.projects.map(async (id) => {
          const at = `/projects/${encodeURIComponent(id)}`
          const [project, members, flags] = await Promise.all([
            get<Named>(at),
            get<Member[]>(`${at}/members`),
            get<ApiRedFlag[]>(`${at}/red-flags`),
          ])
          return { project, members, flags }
        }),
      )
      const gantt =
        view.kind === 'gantt'
          ? {
              calendar: await get<ApiCalendar>('/calendar'),
              relations: await Promise.all(
                tasks.map((task) =>
                  get<ApiRelations>(`/tasks/${encodeURIComponent(task.id)}/relations`),
                ),
              ),
            }
          : null
      const people = new Map<string, string>()
      for (const { members } of perProject) {
        for (const member of members) people.set(member.accountId, member.username)
      }
      setLoaded({
        state: 'loaded',
        view,
        tasks,
        projects: perProject.map(({ project }) => project),
        groups: new Map(groups.map((group) => [group.id, group.name])),
        repositories: new Map(
          repositories.map((repository) => [
            repository.id,
            `${repository.owner}/${repository.name}`,
          ]),
        ),
        flags: perProject.flatMap(({ flags }) => flags),
        members: new Map(perProject.map(({ project, members }) => [project.id, members])),
        people,
        gantt,
      })
    },
    [viewId],
  )

  useEffect(() => {
    const abort = new AbortController()
    setLoaded({ state: 'loading' })
    load(abort.signal).catch((error: unknown) => {
      if (abort.signal.aborted || toSignIn(error)) return
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        setLoaded({ state: 'not-visible', message: error.message })
      } else if (error instanceof ApiError && error.status === 400) {
        setLoaded({ state: 'not-visible', message: 'This saved view does not exist' })
      } else {
        setLoaded({ state: 'failed' })
      }
    })
    return () => abort.abort()
  }, [load, toSignIn])

  /** Saves a change through the REST API, then reads the view again; rejects with a refusal. */
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

  const onMove = useCallback(
    (task: KanbanTask, status: TaskStatus) => {
      const path = `/tasks/${encodeURIComponent(task.id)}`
      return status === 'cancelled'
        ? save(`${path}/cancel`, 'POST', {})
        : save(`${path}/status`, 'PUT', { status })
    },
    [save],
  )

  const onEdit = useCallback(
    (task: KanbanTask, changes: TaskChanges) =>
      save(`/tasks/${encodeURIComponent(task.id)}`, 'PATCH', changes),
    [save],
  )

  switch (loaded.state) {
    case 'loading':
      return <p className="page__note">Loading…</p>
    case 'failed':
      return (
        <p role="alert" className="page__note">
          The saved view could not be loaded.
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

  const { view, projects } = loaded
  const projectNames = new Map(projects.map((project) => [project.id, project.name]))
  const names = { people: loaded.people, projects: projectNames, repositories: loaded.repositories }
  return (
    <section>
      <h1 className="page__title">{view.name}</h1>
      <dl className="views__about" aria-label="About the view">
        <div>
          <dt>Kind</dt>
          <dd>{KIND_NAMES[view.kind]}</dd>
        </div>
        <div>
          <dt>Kept in</dt>
          <dd>{placeOf(view, projectNames, loaded.groups)}</dd>
        </div>
        <div>
          <dt>Covers</dt>
          <dd>
            {projects.length === 0
              ? 'No project you can read'
              : projects.map((project) => project.name).join(', ')}
          </dd>
        </div>
        <div>
          <dt>Filter</dt>
          <dd>
            {view.filter.length === 0 ? (
              'None: every task'
            ) : (
              <ul className="views__filter-list" aria-label="Filter">
                {view.filter.map((condition, index) => (
                  // The conditions have no ids of their own; one is its place in the filter.
                  <li key={index}>{describeCondition(condition, names)}</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
      <div className="views__body">
        {view.kind === 'kanban' ? (
          <Kanban
            name={view.name}
            model={buildKanbanModel(projects, loaded.tasks, loaded.flags)}
            people={loaded.people}
            members={loaded.members}
            onMove={onMove}
            onEdit={onEdit}
          />
        ) : loaded.tasks.length === 0 ? (
          <p className="page__note">No task meets the view.</p>
        ) : (
          <Gantt
            name={view.name}
            model={buildGanttModel(
              loaded.tasks,
              loaded.gantt?.relations ?? [],
              loaded.flags,
              loaded.gantt?.calendar ?? { weekendDays: [], holidays: [] },
            )}
            people={loaded.people}
            today={localDate(new Date())}
          />
        )}
      </div>
    </section>
  )
}
