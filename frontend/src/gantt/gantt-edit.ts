/*
 * What an edit made on the Gantt (SC-067) changes, worked out from what the viewer did: a bar
 * dragged by some days, and the project a task created on the Gantt goes in. Pure functions, so
 * that the Gantt and its tests share them.
 */
import type { TaskChanges } from '../tasks/TaskEditForm.tsx'
import { addDays, type ApiTask, daysBetween } from './gantt-model.ts'

/**
 * Whether a task's bar can be dragged to other dates (#223). A closed task, done or cancelled, is
 * frozen. A parent spans its subtasks' dates and a floating milestone lies where its blockers
 * finish, both set by the scheduler, so neither can; every other task with dates can.
 */
export function movable(task: ApiTask, parent: boolean): boolean {
  if (parent || task.status === 'done' || task.status === 'cancelled') return false
  return task.milestone === null || task.milestone.variant === 'fixed-date'
}

/**
 * Whether a task's bar can be made longer or shorter by dragging one of its ends (#223): any bar
 * that can be moved, but a milestone's, which has one date and is only moved.
 */
export function resizable(task: ApiTask, parent: boolean): boolean {
  return movable(task, parent) && task.milestone === null
}

/** An end of a bar: its start, on the left, or its finish, on the right. */
export type BarEnd = 'start' | 'finish'

/** The days a bar is drawn on, `YYYY-MM-DD`, both included. */
export interface BarSpan {
  start: string
  finish: string
}

/**
 * How many days the `end` of a bar drawn on `span` can be dragged, of the `days` asked: no further
 * than leaves the bar one day long, its grabbed end on the day of the other.
 */
export function resizeDays(span: BarSpan, end: BarEnd, days: number): number {
  const length = daysBetween(span.start, span.finish)
  return end === 'start' ? Math.min(days, length) : Math.max(days, -length)
}

/** How many working days lie from `from` to `to`, both included; 0 if `to` is earlier. */
export function workingDays(
  from: string,
  to: string,
  nonWorking: (date: string) => boolean,
): number {
  let count = 0
  for (let date = from; date <= to; date = addDays(date, 1)) if (!nonWorking(date)) count++
  return count
}

/**
 * The change that drags the `end` of a task's bar, drawn on `span`, by `days` days (#223), or null
 * if it changes nothing. A task keeps its planned start and a duration in working days, from which
 * the scheduler places its finish (FR-144). Dragging the finish changes the duration by the working
 * days gained or lost; dragging the start changes the start, and the duration by as many working
 * days, so that the finish stays. The working days are those of `nonWorking`, the global calendar;
 * a task with no duration is taken to last the working days of its bar. A task lasts one working
 * day at least.
 */
export function resizeChanges(
  task: ApiTask,
  span: BarSpan,
  end: BarEnd,
  days: number,
  nonWorking: (date: string) => boolean,
): TaskChanges | null {
  const by = resizeDays(span, end, days)
  if (by === 0) return null
  const duration =
    task.durationWorkingDays ?? Math.max(1, workingDays(span.start, span.finish, nonWorking))
  const between = (from: string, to: string) => workingDays(from, to, nonWorking)
  if (end === 'finish') {
    const finish = addDays(span.finish, by)
    const longer =
      by > 0
        ? duration + between(addDays(span.finish, 1), finish)
        : duration - between(addDays(finish, 1), span.finish)
    const durationWorkingDays = Math.max(1, longer)
    return durationWorkingDays === task.durationWorkingDays ? null : { durationWorkingDays }
  }
  const start = addDays(span.start, by)
  const longer =
    by < 0
      ? duration + between(start, addDays(span.start, -1))
      : duration - between(span.start, addDays(start, -1))
  return { plannedStart: start, durationWorkingDays: Math.max(1, longer) }
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
