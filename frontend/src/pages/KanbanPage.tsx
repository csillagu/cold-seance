import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.ts'
import type { PeopleById } from '../gantt/Gantt.tsx'
import type { ApiRedFlag, TaskStatus } from '../gantt/gantt-model.ts'
import { Kanban, type Member, type TaskChanges } from '../kanban/Kanban.tsx'
import { buildKanbanModel, type KanbanModel, type KanbanTask } from '../kanban/kanban-model.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { useProject } from './project-context.ts'

type Loaded =
  | { state: 'loading' }
  | {
      state: 'loaded'
      model: KanbanModel
      people: PeopleById
      members: ReadonlyMap<string, readonly Member[]>
    }
  | { state: 'failed' }

/**
 * The Kanban of a project (SC-030), at `/projects/<id>/kanban`, inside the project's page. It reads
 * the project's tasks, its red flags and its members through the REST API and lays them out;
 * anyone with a role in the project can open it (FR-106). A move or an edit on a card goes to the
 * REST API, and the Kanban is read again once it is saved, as a change can move other tasks too.
 */
export function KanbanPage() {
  const project = useProject()
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const get = <T,>(path: string) => api<T>(path, { signal })
      const base = `/projects/${encodeURIComponent(project.id)}`
      const [tasks, flags, members] = await Promise.all([
        get<KanbanTask[]>(`${base}/tasks`),
        get<ApiRedFlag[]>(`${base}/red-flags`),
        get<Member[]>(`${base}/members`),
      ])
      const projects = [{ id: project.id, name: project.name }]
      setLoaded({
        state: 'loaded',
        model: buildKanbanModel(projects, tasks, flags),
        people: new Map(members.map((member) => [member.accountId, member.username])),
        members: new Map([[project.id, members]]),
      })
    },
    [project.id, project.name],
  )

  useEffect(() => {
    const abort = new AbortController()
    setLoaded({ state: 'loading' })
    load(abort.signal).catch((error: unknown) => {
      if (abort.signal.aborted || toSignIn(error)) return
      setLoaded({ state: 'failed' })
    })
    return () => abort.abort()
  }, [load, toSignIn])

  /** Saves a change through the REST API, then reads the Kanban again; rejects with a refusal. */
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

  if (loaded.state === 'loading') return <p className="page__note">Loading…</p>
  if (loaded.state === 'failed') {
    return (
      <p role="alert" className="page__note">
        The Kanban could not be loaded.
      </p>
    )
  }
  return (
    <Kanban
      name={`Kanban of ${project.name}`}
      model={loaded.model}
      people={loaded.people}
      members={loaded.members}
      onMove={onMove}
      onEdit={onEdit}
    />
  )
}
