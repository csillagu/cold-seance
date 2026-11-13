/*
 * What the baseline variance view (SC-033) lays out, worked out from what the REST API gives: each
 * task's planned, baseline and actual dates side by side with its variance (FR-152), the counts
 * above the table, and the bars of its timeline. The variance itself is the variance calculator's
 * (SC-044), computed when it is read and not stored (DD-037); this only arranges it. Pure
 * functions, so that the drawing and its tests share them.
 */
import { type ApiRelations, formatDay, type TaskStatus } from '../gantt/gantt-model.ts'
import type { KanbanTask } from '../kanban/kanban-model.ts'

/** A start and a finish as the API gives them, each `YYYY-MM-DD`, or null for none. */
export interface ApiDatePair {
  start: string | null
  finish: string | null
}

/** One task's variance as the API gives it (`GET /baselines/{id}/variance`). */
export interface ApiTaskVariance {
  taskId: string
  title: string
  milestone: boolean
  /** Its dates in the baseline; null if it was created after the baseline was saved. */
  baseline: ApiDatePair | null
  planned: ApiDatePair
  actual: ApiDatePair
  /** In working days of the global calendar; positive is later; null where it cannot be had. */
  variance: { start: number | null; finish: number | null }
}

/** A project's variance against one of its baselines, as the API gives it. */
export interface ApiVariance {
  baseline: { id: string; projectId: string; name: string; savedAt: string }
  tasks: ApiTaskVariance[]
}

/** A span of days on the timeline, as offsets in days from its first day. */
export interface Span {
  /** The first day, counted from the timeline's first day. */
  from: number
  /** How many days it covers. */
  days: number
}

/** One shown date or span of dates: in short, as the table shows it, and in full. */
export interface Dates {
  /** As the table shows it: `8–10 Mar`, `12 Mar`, `1 Mar –`, or `—` for none. */
  text: string
  /** In full, with the year, or null for none: `8 Mar 2027 to 10 Mar 2027`. */
  full: string | null
}

/** A row of the table: one task. */
export interface VarianceRow {
  taskId: string
  title: string
  milestone: boolean
  /** Its status as the task gives it; a task the API did not list counts as not started. */
  status: TaskStatus
  /** How deep it is under the tasks it is a subtask of; 0 for a task at the top. */
  depth: number
  /** How many subtasks it has in the table. */
  subtasks: number
  /** What its row says beside its title, if anything: its status, or its subtasks. */
  note: string | null
  planned: Dates
  baseline: Dates
  actual: Dates
  /** The start variance as the table shows it: `+1`, `−1`, `0`, or `—`. */
  start: string
  /** The finish variance as shown, or null where it is not shown: a milestone has one day. */
  finish: string | null
  /** Its bars on the timeline; null where it has no such dates. */
  bars: { planned: Span | null; baseline: Span | null; actual: Span | null; open: boolean }
}

/** The counts above the table: how many tasks are later, on, or earlier than the baseline. */
export interface VarianceSummary {
  later: number
  on: number
  earlier: number
  /** The tasks with no variance either way: no baseline dates, or no dates now. */
  none: number
}

/** The timeline beside the table: its days, its week marks and today. */
export interface Timeline {
  /** The first day it shows, a Monday, `YYYY-MM-DD`. */
  first: string
  /** How many days it shows: whole weeks. */
  days: number
  /** A mark at each Monday: its offset in days, and its label. */
  weeks: { at: number; label: string }[]
  /** Today's offset in days, or null if today lies outside it. */
  today: number | null
}

/** Everything the baseline variance view lays out. */
export interface VarianceModel {
  /** The name of the baseline it compares against. */
  baseline: string
  summary: VarianceSummary
  /** The tasks with planned dates; each subtask follows its parent. */
  scheduled: VarianceRow[]
  /** The tasks with no planned dates, and the milestones with no day (FR-004). */
  unscheduled: VarianceRow[]
  /** Null when no task has a date at all. */
  timeline: Timeline | null
}

const NONE = '—'

/** The days from `from` to `to`, both `YYYY-MM-DD`. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** `date` moved by `days`. */
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

/** The day of the week of `date`, Monday 0 to Sunday 6. */
function weekday(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
}

/**
 * A start and a finish as the table shows them: one day as `12 Mar`, days in one month as
 * `8–10 Mar`, across months as `25 Feb–1 Mar`, a start with no finish yet as `1 Mar –`, and none
 * as `—`.
 */
export function formatDates({ start, finish }: ApiDatePair): Dates {
  if (start === null && finish === null) return { text: NONE, full: null }
  if (start === null) {
    return { text: `– ${formatDay(finish!)}`, full: `finished ${formatDay(finish!, true)}` }
  }
  if (finish === null) {
    return { text: `${formatDay(start)} –`, full: `${formatDay(start, true)}, not finished` }
  }
  const full =
    start === finish
      ? formatDay(start, true)
      : `${formatDay(start, true)} to ${formatDay(finish, true)}`
  if (start === finish) return { text: formatDay(start), full }
  if (start.slice(0, 7) === finish.slice(0, 7)) {
    return { text: `${Number(start.slice(8))}–${formatDay(finish)}`, full }
  }
  return { text: `${formatDay(start)}–${formatDay(finish)}`, full }
}

/** A variance in days as the table shows it: `+1` later, `−1` earlier (a minus sign), `0`, `—`. */
export function formatVariance(days: number | null): string {
  if (days === null) return NONE
  if (days > 0) return `+${days}`
  if (days < 0) return `−${-days}`
  return '0'
}

/**
 * Where a task stands against the baseline, for the counts above the table: later if either date
 * is later, else earlier if either is earlier, else on it; with no variance at all, none.
 */
function standing({ start, finish }: ApiTaskVariance['variance']): keyof VarianceSummary {
  const known = [start, finish].filter((days): days is number => days !== null)
  if (known.length === 0) return 'none'
  if (known.some((days) => days > 0)) return 'later'
  if (known.some((days) => days < 0)) return 'earlier'
  return 'on'
}

/** What a row says beside its title. */
function noteOf(status: TaskStatus, subtasks: number, milestone: boolean): string | null {
  if (subtasks > 0) return subtasks === 1 ? '1 subtask' : `${subtasks} subtasks`
  if (status === 'done') return 'done'
  if (status === 'on-hold') return 'on hold'
  if (status === 'cancelled') return 'cancelled'
  if (milestone) return 'milestone'
  return null
}

/**
 * Builds the baseline variance view from the variance of the project against the selected
 * baseline, its tasks (for their statuses), their relations (for their parents) and today's date.
 *
 * - The scheduled tasks come first, cancelled ones included, which the view shows faded; each
 *   subtask follows its parent, indented, and otherwise they keep the order the API gives them.
 * - The unscheduled tasks, those with no planned dates and the milestones with no day, follow in
 *   a group of their own (FR-004), with dashes for the dates and variance they do not have.
 * - A scheduled task created after the baseline was saved says that it is not in it.
 * - The timeline runs from the Monday of the week of the first date shown to the Sunday of the
 *   week of the last; a task's actual bar runs to its actual finish, or to today while it has none.
 */
export function buildVarianceModel(
  variance: ApiVariance,
  tasks: readonly KanbanTask[],
  relations: readonly ApiRelations[],
  today: string,
): VarianceModel {
  const statusOf = new Map(tasks.map((task) => [task.id, task.status]))
  const name = variance.baseline.name
  const isScheduled = (task: ApiTaskVariance) =>
    task.planned.start !== null || task.planned.finish !== null
  const scheduledTasks = new Map(
    variance.tasks.filter(isScheduled).map((task) => [task.taskId, task]),
  )

  const parentOf = new Map<string, string>()
  for (const relation of relations) {
    if (
      relation.parent &&
      scheduledTasks.has(relation.parent.id) &&
      scheduledTasks.has(relation.taskId)
    ) {
      parentOf.set(relation.taskId, relation.parent.id)
    }
  }
  const childrenOf = new Map<string, string[]>()
  for (const id of scheduledTasks.keys()) {
    const parent = parentOf.get(id)
    if (parent) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), id])
  }

  // Every date shown, so that the timeline covers them all.
  const dates: string[] = []
  for (const task of variance.tasks) {
    for (const pair of [task.planned, task.baseline, task.actual]) {
      if (pair?.start) dates.push(pair.start)
      if (pair?.finish) dates.push(pair.finish)
    }
    if (task.actual.start && !task.actual.finish) dates.push(today)
  }
  dates.sort()
  const first = dates.length > 0 ? addDays(dates[0]!, -weekday(dates[0]!)) : null
  const last = dates.length > 0 ? dates[dates.length - 1]! : null
  const span = (pair: ApiDatePair | null | undefined, to?: string | null): Span | null => {
    const start = pair?.start ?? null
    const finish = to ?? pair?.finish ?? null
    if (first === null || start === null || finish === null) return null
    return { from: daysBetween(first, start), days: daysBetween(start, finish) + 1 }
  }

  const rowOf = (task: ApiTaskVariance, depth: number, subtasks: number): VarianceRow => {
    const status = statusOf.get(task.taskId) ?? 'not-started'
    const scheduled = isScheduled(task)
    const open = task.actual.start !== null && task.actual.finish === null
    return {
      taskId: task.taskId,
      title: task.title,
      milestone: task.milestone,
      status,
      depth,
      subtasks,
      note: noteOf(status, subtasks, task.milestone),
      planned: formatDates(task.planned),
      baseline:
        task.baseline === null && scheduled
          ? { text: `not in ${name}`, full: null }
          : formatDates(task.baseline ?? { start: null, finish: null }),
      actual: formatDates(task.actual),
      start: formatVariance(task.variance.start),
      finish: task.milestone ? null : formatVariance(task.variance.finish),
      bars: {
        planned: span(task.planned),
        baseline: span(task.baseline),
        actual: span(task.actual, open ? today : null),
        open,
      },
    }
  }

  const scheduled: VarianceRow[] = []
  const place = (id: string, depth: number) => {
    const task = scheduledTasks.get(id)
    if (!task) return
    const children = childrenOf.get(id) ?? []
    scheduled.push(rowOf(task, depth, children.length))
    for (const child of children) place(child, depth + 1)
  }
  for (const id of scheduledTasks.keys()) {
    if (!parentOf.has(id)) place(id, 0)
  }
  const unscheduled = variance.tasks
    .filter((task) => !isScheduled(task))
    .map((task) => rowOf(task, 0, 0))

  const summary: VarianceSummary = { later: 0, on: 0, earlier: 0, none: 0 }
  for (const task of variance.tasks) summary[standing(task.variance)] += 1

  let timeline: Timeline | null = null
  if (first !== null && last !== null) {
    const days = daysBetween(first, last) + 7 - weekday(last)
    const weeks: Timeline['weeks'] = []
    for (let at = 0; at < days; at += 7) {
      weeks.push({ at, label: formatDay(addDays(first, at)).toUpperCase() })
    }
    const offset = daysBetween(first, today)
    timeline = { first, days, weeks, today: offset >= 0 && offset < days ? offset : null }
  }

  return { baseline: name, summary, scheduled, unscheduled, timeline }
}
