/*
 * What the person load view (SC-032) and its unassigned task rating panel (SC-069) show, worked
 * out from what the REST API gives: the span of days, each person's row of daily loads against
 * their capacity, the tasks behind a row, the tasks that put load on no one, and a rating in
 * words. Pure functions, so that the drawing and its tests share them.
 */
import { addDays, type ApiTask, daysBetween, formatDay, weekday } from '../gantt/gantt-model.ts'
import { scheduledOn } from '../kanban/kanban-model.ts'
import type { Eligibility } from '../tasks/eligibility.ts'

/** The most days one person's load is read for at once, as the REST API allows (SC-006). */
export const MAX_SPAN_DAYS = 366

/** How many days the view covers when no span is asked for: four weeks. */
export const DEFAULT_SPAN_DAYS = 28

/** One task's share of a person's load on a day, as the API gives it. */
export interface ApiTaskLoad {
  taskId: string
  projectId: string
  title: string
  load: number
}

/** A person's load on one day, as the API gives it (`GET /accounts/{id}/load`). */
export interface ApiDayLoad {
  date: string
  /** The whole load, across all projects, in percent. */
  load: number
  /** The tasks behind it in projects the viewer can read. */
  tasks: ApiTaskLoad[]
  /** The load from projects the viewer cannot read, in percent. */
  otherProjects: number
  /** The capacity that day, 0 on an absence day; null when the viewer may not read it. */
  capacity: number | null
  /** Whether the load is above the capacity; null when the viewer may not read the capacity. */
  overloaded: boolean | null
}

/** A person's load over a span, as the API gives it. */
export interface ApiPersonLoad {
  accountId: string
  from: string
  to: string
  days: ApiDayLoad[]
}

/** The colour an eligible but unassigned task is rated in (FR-045). */
export type Rating = 'red' | 'amber' | 'green'

/** An eligible but unassigned task with its rating, as the API gives it. */
export interface ApiRating {
  taskId: string
  title: string
  plannedStart: string
  plannedFinish: string
  eligibility: Eligibility
  rating: Rating
}

/** The days the view covers, both included, `YYYY-MM-DD`. */
export interface Span {
  from: string
  to: string
}

/** Today's date in the browser's time zone, `YYYY-MM-DD`. */
export function today(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** The span shown when none is asked for: four weeks from the Monday of `date`'s week. */
export function defaultSpan(date: string): Span {
  const from = addDays(date, -weekday(date))
  return { from, to: addDays(from, DEFAULT_SPAN_DAYS - 1) }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Whether `value` is a real day written `YYYY-MM-DD`. */
function isDay(value: string): boolean {
  if (!DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/**
 * What is wrong with a span the person asked for, in words, or null if nothing is: both days must
 * be real days, the first not after the last, and the span at most `MAX_SPAN_DAYS` days long.
 */
export function spanProblem(span: Span): string | null {
  if (!isDay(span.from) || !isDay(span.to)) return 'Give both days as dates.'
  const length = daysBetween(span.from, span.to) + 1
  if (length < 1) return 'The first day must not be after the last.'
  if (length > MAX_SPAN_DAYS) return `The view covers at most ${MAX_SPAN_DAYS} days at once.`
  return null
}

/**
 * The span asked for in the address (`?from=…&to=…`), if it names a valid one; the default span
 * around `date` otherwise.
 */
export function spanOf(params: URLSearchParams, date: string): Span {
  const from = params.get('from')
  const to = params.get('to')
  if (from !== null && to !== null && spanProblem({ from, to }) === null) return { from, to }
  return defaultSpan(date)
}

/** A percentage as the view writes it: whole, or with up to one decimal, such as `12.5%`. */
export function formatPercent(value: number): string {
  return `${Math.round(value * 10) / 10}%`
}

/** A task behind a person's load in the span, in a project the viewer can read. */
export interface RowTask {
  taskId: string
  projectId: string
  title: string
  /** The load it puts on the person on the days it is active. */
  load: number
}

/** A person's row in the view: their daily loads and the tasks behind them. */
export interface LoadRow {
  accountId: string
  username: string
  days: ApiDayLoad[]
  /** The readable tasks that load the person on some day of the span, in the order first met. */
  tasks: RowTask[]
}

/** A project member, as the API gives them (`GET /projects/{id}/members`). */
export interface ApiMember {
  accountId: string
  username: string
}

/**
 * The rows of the view: one per member of the project, by username, each with their daily loads
 * and the readable tasks behind them. A task's load is the same on each day it is active
 * (DD-009), so the first day's is taken.
 */
export function buildRows(
  members: readonly ApiMember[],
  loads: ReadonlyMap<string, ApiPersonLoad>,
): LoadRow[] {
  return [...members]
    .sort((a, b) => a.username.localeCompare(b.username))
    .map((member) => {
      const days = loads.get(member.accountId)?.days ?? []
      const tasks = new Map<string, RowTask>()
      for (const day of days) {
        for (const task of day.tasks) {
          if (!tasks.has(task.taskId)) tasks.set(task.taskId, { ...task })
        }
      }
      return { ...member, days, tasks: [...tasks.values()] }
    })
}

/** Why a task of the project puts load on no one. */
export type NoLoadReason = 'unscheduled' | 'cancelled' | 'milestone' | 'unassigned'

/** A task of the project that puts load on no one, and why. */
export interface NoLoadTask {
  task: ApiTask
  reason: NoLoadReason
}

/**
 * The tasks of the project that put load on no one, so that every task of the project is in the
 * view (FR-004, SRC-024), in the order the API gives them:
 *
 * - an unscheduled task, one with no planned dates or a milestone with no day (FR-004);
 * - a cancelled task, which frees its load (FR-127);
 * - a milestone, which takes no time (FR-191);
 * - a task no one is assigned to, unless the rating panel lists it (FR-045).
 *
 * The first that holds is the reason given.
 */
export function noLoadTasks(tasks: readonly ApiTask[], rated: ReadonlySet<string>): NoLoadTask[] {
  const found: NoLoadTask[] = []
  for (const task of tasks) {
    const reason = noLoadReason(task, rated)
    if (reason) found.push({ task, reason })
  }
  return found
}

function noLoadReason(task: ApiTask, rated: ReadonlySet<string>): NoLoadReason | null {
  if (scheduledOn(task) === null) return 'unscheduled'
  if (task.status === 'cancelled') return 'cancelled'
  if (task.milestone) return 'milestone'
  if (task.assignees.length === 0 && !rated.has(task.id)) return 'unassigned'
  return null
}

/** What the view says of why a task puts load on no one. */
export const NO_LOAD_WORDS: Record<NoLoadReason, string> = {
  unscheduled: 'No dates, so no load',
  cancelled: 'Cancelled, so no load',
  milestone: 'A milestone takes no time',
  unassigned: 'No one assigned',
}

/** The rating's name and what it means, as the panel says them (FR-045, SRC-201). */
export const RATING_WORDS: Record<Rating, { name: string; meaning: string }> = {
  red: { name: 'Red', meaning: 'Every eligible combination overloads someone' },
  amber: { name: 'Amber', meaning: 'Some eligible combinations overload someone' },
  green: { name: 'Green', meaning: 'No eligible combination overloads anyone' },
}

/** A task's planned days in words: `1 Mar 2027`, or `1 Mar – 5 Mar 2027`. */
export function datesInWords(start: string, finish: string): string {
  if (start === finish) return formatDay(start, true)
  return `${formatDay(start, start.slice(0, 4) !== finish.slice(0, 4))} – ${formatDay(finish, true)}`
}

/** The days of the span, in order. */
export function daysOf(span: Span): string[] {
  const days: string[] = []
  for (let day = span.from; day <= span.to; day = addDays(day, 1)) days.push(day)
  return days
}

/** A day's cell in words: `carol, 2 Mar 2027: 70% of 80% capacity`, and whether overloaded. */
export function cellLabel(username: string, day: ApiDayLoad): string {
  let label = `${username}, ${formatDay(day.date, true)}: ${formatPercent(day.load)}`
  if (day.capacity !== null) label += ` of ${day.capacity}% capacity`
  if (day.overloaded === true) label += ', overloaded'
  return label
}
