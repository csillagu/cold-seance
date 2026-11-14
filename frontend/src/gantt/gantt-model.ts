/*
 * What the Gantt timeline (SC-031) draws, worked out from what the REST API gives: the rows in
 * order, the unscheduled and cancelled tasks (SC-064), a selected baseline's bars (SC-065), the
 * days the timeline spans, and which tasks and dependencies are red. Pure functions, so that the
 * drawing and its tests share them.
 */

/** A task's status, as the API gives it. */
export type TaskStatus = 'not-started' | 'in-progress' | 'on-hold' | 'done' | 'cancelled'

/** A task as the API gives it (`GET /projects/{id}/tasks`), the fields the Gantt reads. */
export interface ApiTask {
  id: string
  projectId: string
  title: string
  status: TaskStatus
  plannedStart: string | null
  plannedFinish: string | null
  durationWorkingDays: number | null
  aiShare: number | null
  milestone: { variant: 'fixed-date' | 'floating'; date: string | null } | null
  assignees: string[]
}

/** A task's relations as the API gives them (`GET /tasks/{id}/relations`). */
export interface ApiRelations {
  taskId: string
  parent: { id: string; projectId: string } | null
  blockedBy: { id: string; projectId: string }[]
}

/** A red flag as the API gives it (`GET /projects/{id}/red-flags`), the fields the Gantt reads. */
export interface ApiRedFlag {
  kind:
    'overload' | 'assignee-unavailable' | 'fixed-date-milestone-pushed' | 'cross-project-dependency'
  task?: { id: string; projectId: string }
  blocker?: { id: string; projectId: string }
  blockerFinish?: string
}

/** The global calendar as the API gives it (`GET /calendar`). */
export interface ApiCalendar {
  weekendDays: string[]
  holidays: string[]
}

/** A baseline as the API gives it (`GET /baselines/{id}`), the fields the Gantt reads. */
export interface ApiBaseline {
  id: string
  name: string
  tasks: { taskId: string; plannedStart: string | null; plannedFinish: string | null }[]
}

/** The days a task lay on in the selected baseline. */
export interface BaselineBar {
  start: string
  finish: string
}

/** A row of the Gantt: a task drawn on its dates. */
export interface GanttRow {
  task: ApiTask
  /** How many parents above it are on the Gantt: 0 for a task at the top. */
  depth: number
  /** Whether a subtask of it is on the Gantt, so it is drawn as a parent. */
  parent: boolean
  /** The first day it is drawn on. */
  start: string
  /** The last day it is drawn on, the same as `start` for a milestone. */
  finish: string
  /** Whether it is shown in red: a violation on it, or its assigned people cannot do it. */
  red: boolean
  /** Why it is red, in words, when the Gantt says so beside it. */
  note: string | null
  /** Its bar in the selected baseline, if a baseline is selected and gives it dates (FR-050). */
  baseline: BaselineBar | null
}

/**
 * A row of the Gantt's unscheduled part: a task with no planned dates, or a milestone with no day
 * (FR-004), laid below every scheduled task (FR-145).
 */
export interface UnscheduledRow {
  task: ApiTask
  /** Its bar in the selected baseline, if it had dates there (FR-050). */
  baseline: BaselineBar | null
}

/** A dependency drawn between two rows: `task` is blocked by `blocker`. */
export interface GanttDependency {
  task: string
  blocker: string
  /**
   * Whether it is a violation, shown in red: its blocker pushes a fixed-date milestone, or it is
   * on another project's milestone that lies after the task's start.
   */
  red: boolean
  /**
   * Whether `blocker` is in another project than `task`, on a Gantt covering several projects
   * (SC-066, FR-062): drawn dashed.
   */
  crossProject: boolean
}

/** A day of the timeline. */
export interface GanttDay {
  date: string
  /** A weekend day or a company holiday of the global calendar. */
  nonWorking: boolean
}

/** Everything the Gantt draws. */
export interface GanttModel {
  /** The scheduled tasks, cancelled ones included (FR-129). */
  rows: GanttRow[]
  /** The unscheduled tasks, cancelled ones included, in the order the API gives them. */
  unscheduled: UnscheduledRow[]
  /** The name of the selected baseline, or null for none. */
  baseline: string | null
  dependencies: GanttDependency[]
  days: GanttDay[]
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The day `days` after `date`, both `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + days)
  return day.toISOString().slice(0, 10)
}

/** The day of the week of `date`, 0 for Monday to 6 for Sunday. */
export function weekday(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
}

/** How many days lie from `from` to `to`: 0 on the same day, negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** `date` as the Gantt writes it: `1 Mar`, or `1 Mar 2027` with the year. */
export function formatDay(date: string, withYear = false): string {
  const [year, month, day] = date.split('-')
  const short = `${Number(day)} ${MONTHS[Number(month) - 1]}`
  return withYear ? `${short} ${year}` : short
}

/** The month of `date` as a heading: `March 2027`. */
export function formatMonth(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * The days a task is drawn on: a milestone on its date, any other task from its planned start to
 * its planned finish. Null for a task without them, which the Gantt lays at the bottom.
 */
function datesOf(task: ApiTask): { start: string; finish: string } | null {
  if (task.milestone) {
    return task.milestone.date ? { start: task.milestone.date, finish: task.milestone.date } : null
  }
  if (!task.plannedStart || !task.plannedFinish) return null
  return { start: task.plannedStart, finish: task.plannedFinish }
}

/**
 * The bars of a baseline, by task: the days each task lay on when it was saved (FR-050). A task
 * the baseline holds no dates for has none.
 */
function baselineBars(baseline: ApiBaseline | null): Map<string, BaselineBar> {
  const bars = new Map<string, BaselineBar>()
  for (const task of baseline?.tasks ?? []) {
    const start = task.plannedStart ?? task.plannedFinish
    const finish = task.plannedFinish ?? task.plannedStart
    if (start && finish) bars.set(task.taskId, { start, finish })
  }
  return bars
}

/**
 * Builds what the Gantt of a project draws from its tasks, their relations, its red flags, the
 * global calendar and, if one is selected, a baseline.
 *
 * - The rows are the project's tasks with dates, cancelled ones included, which the Gantt draws
 *   faded (FR-129). Each subtask follows its parent, indented, and otherwise the tasks keep the
 *   order the API gives them.
 * - The unscheduled tasks, those with no planned dates and the milestones with no day, are listed
 *   apart, to be laid below every scheduled task (FR-004, FR-145), in the order the API gives them.
 * - With a baseline selected, each task it gives dates for has a baseline bar on them (FR-050).
 * - A task is red when a red flag of the project names it: its assigned people cannot do it in
 *   its time (FR-020), it is a fixed-date milestone that work it depends on would push (FR-013),
 *   or it starts before another project's milestone it depends on.
 * - The dependencies are the blocked-by relations between two rows; the one of a pushed fixed-date
 *   milestone on the work that pushes it is red. On a Gantt covering several projects, a
 *   dependency of a task on another project's milestone is drawn between them too, marked as
 *   crossing projects (SC-066, FR-062), and red when that milestone lies after the task's start.
 *   A dependency whose blocker is not on the Gantt, such as one on another project's milestone on
 *   the Gantt of one project, is not drawn.
 * - The days run from the Monday of the week of the first date to the Sunday of the week after
 *   the last, so that a note beside the last bar has room.
 */
export function buildGanttModel(
  tasks: readonly ApiTask[],
  relations: readonly ApiRelations[],
  flags: readonly ApiRedFlag[],
  calendar: ApiCalendar,
  baseline: ApiBaseline | null = null,
): GanttModel {
  const bars = baselineBars(baseline)
  const shown = new Map<string, { task: ApiTask; start: string; finish: string }>()
  const unscheduled: UnscheduledRow[] = []
  for (const task of tasks) {
    const dates = datesOf(task)
    if (dates) shown.set(task.id, { task, ...dates })
    else unscheduled.push({ task, baseline: bars.get(task.id) ?? null })
  }

  const parentOf = new Map<string, string>()
  for (const relation of relations) {
    if (relation.parent && shown.has(relation.parent.id) && shown.has(relation.taskId)) {
      parentOf.set(relation.taskId, relation.parent.id)
    }
  }
  const childrenOf = new Map<string, string[]>()
  for (const { task } of shown.values()) {
    const parent = parentOf.get(task.id)
    if (parent) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), task.id])
  }

  const redTasks = new Map<string, string | null>()
  const redDependencies = new Set<string>()
  for (const flag of flags) {
    if (!flag.task) continue
    if (flag.kind === 'assignee-unavailable') {
      if (!redTasks.has(flag.task.id)) redTasks.set(flag.task.id, null)
    } else if (flag.kind === 'fixed-date-milestone-pushed') {
      const date = shown.get(flag.task.id)?.start
      const note =
        date && flag.blockerFinish
          ? `Fixed ${formatDay(date)} · pushed: blocker ends ${formatDay(flag.blockerFinish)}`
          : null
      redTasks.set(flag.task.id, note)
      if (flag.blocker) redDependencies.add(`${flag.task.id}<${flag.blocker.id}`)
    } else if (flag.kind === 'cross-project-dependency') {
      // The task that starts before another project's milestone, and its line to that milestone
      // where the milestone is on the Gantt too (SC-066).
      redTasks.set(flag.task.id, redTasks.get(flag.task.id) ?? null)
      if (flag.blocker) redDependencies.add(`${flag.task.id}<${flag.blocker.id}`)
    }
  }

  const rows: GanttRow[] = []
  const place = (id: string, depth: number) => {
    const entry = shown.get(id)
    if (!entry) return
    const children = childrenOf.get(id) ?? []
    rows.push({
      task: entry.task,
      depth,
      parent: children.length > 0,
      start: entry.start,
      finish: entry.finish,
      red: redTasks.has(id),
      note: redTasks.get(id) ?? null,
      baseline: bars.get(id) ?? null,
    })
    for (const child of children) place(child, depth + 1)
  }
  for (const { task } of shown.values()) {
    if (!parentOf.has(task.id)) place(task.id, 0)
  }

  const dependencies: GanttDependency[] = []
  for (const relation of relations) {
    const task = shown.get(relation.taskId)
    if (!task) continue
    for (const blocker of relation.blockedBy) {
      if (!shown.has(blocker.id)) continue
      dependencies.push({
        task: relation.taskId,
        blocker: blocker.id,
        red: redDependencies.has(`${relation.taskId}<${blocker.id}`),
        crossProject: blocker.projectId !== task.task.projectId,
      })
    }
  }

  const spans: BaselineBar[] = [
    ...rows.map((row) => ({ start: row.start, finish: row.finish })),
    ...rows.flatMap((row) => (row.baseline ? [row.baseline] : [])),
    ...unscheduled.flatMap((row) => (row.baseline ? [row.baseline] : [])),
  ]
  return {
    rows,
    unscheduled,
    baseline: baseline?.name ?? null,
    dependencies,
    days: daysOf(spans, calendar),
  }
}

/**
 * The path of an arrow from `from` to `to`: right, then down or up to the task's row, then right
 * to it; or, where the task starts before the blocker ends, around through the gap between the
 * rows.
 */
export function arrowPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  rowGap: number,
): string {
  if (to.x - from.x >= 12) {
    const turn = from.x + 6
    return `M${from.x} ${from.y} H${turn} V${to.y} H${to.x}`
  }
  return `M${from.x} ${from.y} H${from.x + 6} V${rowGap} H${to.x - 10} V${to.y} H${to.x}`
}

/**
 * The days the timeline spans, so that every bar fits, the baseline's too, with the non-working
 * ones of the global calendar marked.
 */
function daysOf(spans: readonly BaselineBar[], calendar: ApiCalendar): GanttDay[] {
  if (spans.length === 0) return []
  let first = spans[0]!.start
  let last = spans[0]!.finish
  for (const row of spans) {
    if (row.start < first) first = row.start
    if (row.finish > last) last = row.finish
  }
  const from = addDays(first, -weekday(first))
  const to = addDays(last, 6 - weekday(last) + 7)
  const weekend = new Set(calendar.weekendDays)
  const holidays = new Set(calendar.holidays)
  const days: GanttDay[] = []
  for (let date = from; date <= to; date = addDays(date, 1)) {
    days.push({
      date,
      nonWorking: weekend.has(WEEKDAYS[weekday(date)]!) || holidays.has(date),
    })
  }
  return days
}
