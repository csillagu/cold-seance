import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.ts'
import type { PeopleById } from '../gantt/Gantt.tsx'
import type { ApiRedFlag, TaskStatus } from '../gantt/gantt-model.ts'
import { Kanban } from '../kanban/Kanban.tsx'
import { buildKanbanModel, type KanbanModel, type KanbanTask } from '../kanban/kanban-model.ts'
import { PendingBanner } from '../proposals/PendingBanner.tsx'
import {
  loadOverlay,
  pendingChanges,
  pendingSummaries,
  type PendingSummary,
} from '../proposals/overlay.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { TaskDialog } from '../tasks/TaskDialog.tsx'
import type { Member } from '../tasks/TaskEditForm.tsx'
import { useProject } from './project-context.ts'

type Loaded =
  | { state: 'loading' }
  | {
      state: 'loaded'
      model: KanbanModel
      people: PeopleById
      /** The proposals under review that change the project; null if they could not be read. */
      proposals: PendingSummary[] | null
    }
  | { state: 'failed' }

/**
 * The Kanban of a project (SC-030), at `/projects/<id>/kanban`, inside the project's page. It reads
 * the project's tasks, its red flags and its members through the REST API and lays them out;
 * anyone with a role in the project can open it (FR-106). A card moved to another column goes to
 * the REST API; a card's title opens the task dialog, the same as every view's (#209). The Kanban
 * is read again once a change is saved, as a change can move other tasks too.
 *
 * Each proposal under review that changes the project is read with its live preview, and what it
 * would change is shown as pending, apart from the live cards, with a line above the Kanban naming
 * it and linking to its review (FR-073). Reading it changes nothing in the plan.
 */
export function KanbanPage() {
  const project = useProject()
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  /** The task whose dialog is open, by id. */
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const get = <T,>(path: string) => api<T>(path, { signal })
      const base = `/projects/${encodeURIComponent(project.id)}`
      const [tasks, flags, members, proposals] = await Promise.all([
        get<KanbanTask[]>(`${base}/tasks`),
        get<ApiRedFlag[]>(`${base}/red-flags`),
        get<Member[]>(`${base}/members`),
        loadOverlay(project.id, signal),
      ])
      const projects = [{ id: project.id, name: project.name }]
      const people = new Map(members.map((member) => [member.accountId, member.username]))
      const pending = pendingChanges(proposals ?? [], project.id, {
        people,
        projects: new Map([[project.id, project.name]]),
        tasks: new Map(tasks.map((task) => [task.id, task.title])),
      })
      setLoaded({
        state: 'loaded',
        model: buildKanbanModel(projects, tasks, flags, pending),
        people,
        proposals: proposals && pendingSummaries(proposals, pending),
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

  /** Reads the Kanban again, after a change made in the task dialog. */
  const reload = useCallback(() => {
    load().catch((error: unknown) => {
      if (!toSignIn(error)) setLoaded({ state: 'failed' })
    })
  }, [load, toSignIn])
  const onOpen = useCallback((task: KanbanTask) => setOpen(task.id), [])

  if (loaded.state === 'loading') return <p className="page__note">Loading…</p>
  if (loaded.state === 'failed') {
    return (
      <p role="alert" className="page__note">
        The Kanban could not be loaded.
      </p>
    )
  }
  return (
    <>
      <PendingBanner summaries={loaded.proposals} />
      <Kanban
        name={`Kanban of ${project.name}`}
        model={loaded.model}
        people={loaded.people}
        onMove={onMove}
        onOpen={onOpen}
      />
      {open !== null && (
        <TaskDialog taskId={open} onClose={() => setOpen(null)} onChanged={reload} />
      )}
    </>
  )
}
