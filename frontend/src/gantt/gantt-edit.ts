/*
 * What an edit made on the Gantt (SC-067) changes, worked out from what the viewer did: a bar
 * dragged by some days, and the project a task created on the Gantt goes in. Pure functions, so
 * that the Gantt and its tests share them.
 */
import type { TaskChanges } from '../tasks/TaskEditForm.tsx'
import { addDays, type ApiTask } from './gantt-model.ts'

/**
 * Whether a task's bar can be dragged to other dates. A parent spans its subtasks' dates and a
 * floating milestone lies where its blockers finish, both set by the scheduler, so neither can;
 * every other task with dates can.
 */
export function movable(task: ApiTask, parent: boolean): boolean {
  if (parent) return false
  return task.milestone === null || task.milestone.variant === 'fixed-date'
}

/** How many whole days a bar dragged `dx` pixels, on days `dayWidth` wide, moves its task. */
export function daysDragged(dx: number, dayWidth: number): number {
  // `|| 0` turns the -0 of a small drag to the left into 0.
  return Math.round(dx / dayWidth) || 0
}

/**
 * The change that moves a task drawn from `start` by `days` days: a fixed-date milestone's date,
 * or any other task's planned start, from which the scheduler places its finish (FR-144).
 */
export function moveChanges(task: ApiTask, start: string, days: number): TaskChanges {
  const date = addDays(start, days)
  return task.milestone ? { milestone: { variant: 'fixed-date', date } } : { plannedStart: date }
}

/** A project of a Gantt, as the question of where a new task goes needs it. */
export interface GanttProject {
  id: string
  name: string
  /** Whether the viewer's role in it, held directly or through a group, lets them create tasks. */
  writable: boolean
}

/** Where a task created on the Gantt goes: a project known without asking, or a question. */
export type NewTaskProject =
  { ask: false; project: GanttProject } | { ask: true; offered: GanttProject[] }

/**
 * Where a task created on a Gantt goes (FR-061). On a Gantt of one project, that project. On one
 * covering several, the only project the view's filter allows, if it allows only one; otherwise
 * the viewer is asked, and offered only the projects they can write to.
 */
export function newTaskProject(
  projects: readonly GanttProject[],
  filteredTo: readonly string[] | null = null,
): NewTaskProject {
  const allowed =
    filteredTo === null ? projects : projects.filter((project) => filteredTo.includes(project.id))
  if (allowed.length === 1) return { ask: false, project: allowed[0]! }
  return { ask: true, offered: allowed.filter((project) => project.writable) }
}
