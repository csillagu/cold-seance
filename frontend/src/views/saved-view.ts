import { api } from '../api.ts'
import type { FilterCondition } from './filter.ts'

/** The view kinds that can be saved (FR-054): the person load and baseline variance views cannot. */
export type SavedViewKind = 'kanban' | 'gantt'

/** Where a saved view is kept (FR-055). */
export type SavedViewPlace = 'project' | 'group' | 'personal'

/** A saved view as the REST API gives it (`GET /saved-views`). */
export interface SavedView {
  id: string
  name: string
  kind: SavedViewKind
  keptIn: SavedViewPlace
  projectId: string | null
  groupId: string | null
  ownerId: string | null
  /** The projects it covers, among only those the caller can read. */
  projects: string[]
  filter: FilterCondition[]
}

/** A project or a group as the REST API lists it. */
export interface Named {
  id: string
  name: string
}

export const KIND_NAMES: Record<SavedViewKind, string> = { kanban: 'Kanban', gantt: 'Gantt' }

/** Where the view is kept, in words: "Personal", "Project Apollo", "Group Platform". */
export function placeOf(
  view: SavedView,
  projects: ReadonlyMap<string, string>,
  groups: ReadonlyMap<string, string>,
): string {
  if (view.keptIn === 'personal') return 'Personal'
  if (view.keptIn === 'project') return `Project ${projects.get(view.projectId ?? '') ?? ''}`.trim()
  return `Group ${groups.get(view.groupId ?? '') ?? ''}`.trim()
}

/** The projects and groups the caller can see, by id, for naming where views are kept. */
export async function loadNames(signal?: AbortSignal): Promise<{
  projects: Map<string, string>
  groups: Map<string, string>
}> {
  const [projects, groups] = await Promise.all([
    api<Named[]>('/projects', { signal }),
    api<Named[]>('/groups', { signal }),
  ])
  return {
    projects: new Map(projects.map((project) => [project.id, project.name])),
    groups: new Map(groups.map((group) => [group.id, group.name])),
  }
}

/** The address a saved view is opened at. */
export function viewPath(view: { id: string }): string {
  return `/views/${encodeURIComponent(view.id)}`
}
