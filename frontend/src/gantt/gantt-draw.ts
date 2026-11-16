/*
 * Scheduling an unscheduled task by drawing its bar on its lane of the Gantt (#228, SC-119): what can be
 * drawn, the days a drawing covers, and the change it saves. Pure functions, so that the Gantt and
 * its tests share them.
 */
import type { TaskChanges } from '../tasks/TaskEditForm.tsx'
import { type BarSpan, workingDays } from './gantt-edit.ts'
import { type ApiTask, formatDay } from './gantt-model.ts'

/**
 * How an unscheduled task's lane can be drawn on (#228): a task's bar is drawn, a fixed-date
 * milestone is placed by a click; `null` when it cannot be, as for a closed task, done or
 * cancelled, and a floating milestone, which the scheduler places. It is the rule for moving a
 * bar (#223), as a task without dates is never a parent on the Gantt.
 */
export type DrawMode = 'bar' | 'milestone' | null

export function drawMode(task: ApiTask): DrawMode {
  if (task.status === 'done' || task.status === 'cancelled') return null
  if (task.milestone === null) return 'bar'
  return task.milestone.variant === 'fixed-date' ? 'milestone' : null
}

/** The index of the day of the timeline at `x` pixels from its left, within its `count` days. */
export function dayAt(x: number, dayWidth: number, count: number): number {
  return Math.min(Math.max(Math.floor(x / dayWidth), 0), count - 1)
}

/**
 * The days a bar drawn from the day `from` to the day `to` covers, both included: the earlier is
 * its start, whichever way it was drawn.
 */
export function drawnSpan(from: string, to: string): BarSpan {
  return from <= to ? { start: from, finish: to } : { start: to, finish: from }
}

/**
 * How many working days a drawn bar lasts: those it covers, of the global calendar's (#228), and
 * one at least, as a task lasts, so that a bar drawn on non-working days alone still schedules it.
 */
export function drawnWorkingDays(span: BarSpan, nonWorking: (date: string) => boolean): number {
  return Math.max(1, workingDays(span.start, span.finish, nonWorking))
}

/**
 * The change a bar drawn on `span` saves (#228): its planned start, and a duration of the working
 * days it covers. The planned finish is not saved: the scheduler places it (FR-144), so a holiday
 * added later pushes it out rather than shortening the work.
 */
export function drawChanges(span: BarSpan, nonWorking: (date: string) => boolean): TaskChanges {
  return { plannedStart: span.start, durationWorkingDays: drawnWorkingDays(span, nonWorking) }
}

/** The change that places a fixed-date milestone on `date` with a click on its lane (#228). */
export function placeChanges(date: string): TaskChanges {
  return { milestone: { variant: 'fixed-date', date } }
}

/** `3 Mar – 7 Mar`, or `3 Mar` for one day: the days a bar lies on, as the Gantt says them. */
export function spanText(span: BarSpan): string {
  return span.start === span.finish
    ? formatDay(span.start)
    : `${formatDay(span.start)} – ${formatDay(span.finish)}`
}

/** `1 working day`, `5 working days`. */
export function workingDaysText(count: number): string {
  return `${count} working day${count === 1 ? '' : 's'}`
}

/**
 * Where a label `width` pixels wide goes along the timeline, ideally from `left`: moved as little
 * as it takes to lie within the part of the timeline in view, from `from` to `to`, so that it is
 * never cut off at its edges. One wider than that part starts at its left edge.
 */
export function clampLabel(left: number, width: number, from: number, to: number): number {
  return Math.max(from, Math.min(left, to - width))
}

/**
 * How many pixels to scroll the timeline by, in a frame, with the pointer at `x`, while drawing
 * near the edge of the part in view, from `from` to `to`: faster the closer it is to the edge, and
 * past it; 0 away from the edges.
 */
export function edgeScroll(x: number, from: number, to: number, edge = 40, most = 16): number {
  if (x < from + edge) return -Math.ceil(Math.min(1, (from + edge - x) / edge) * most)
  if (x > to - edge) return Math.ceil(Math.min(1, (x - (to - edge)) / edge) * most)
  return 0
}
