/*
 * What the Kanban view (SC-030) lays out, worked out from what the REST API gives: one column per
 * task status, the cards in each, scheduled ones first and unscheduled ones at the bottom, and
 * which cards are red and why. Pure functions, so that the drawing and its tests share them.
 */
import { type ApiRedFlag, type ApiTask, formatDay, type TaskStatus } from '../gantt/gantt-model.ts'

/** A task as the API gives it, the fields the Kanban reads: the Gantt's, and its actual finish. */
export interface KanbanTask extends ApiTask {
  actualFinish: string | null
}

/** A project a Kanban shows tasks of. */
export interface KanbanProject {
  id: string
  name: string
}

/** A column of the Kanban: the tasks in one status. */
export interface KanbanColumn {
  status: TaskStatus
  /** The column's heading. */
  name: string
  /** The scheduled tasks of the status, by planned start. */
  scheduled: KanbanCard[]
  /** The unscheduled tasks of the status, laid at the bottom of the column (FR-145). */
  unscheduled: KanbanCard[]
}

/** A card of the Kanban: a task and what its card says of it. */
export interface KanbanCard {
  task: KanbanTask
  /** The task's project, named on the card when the Kanban shows several projects (FR-048). */
  project: KanbanProject | null
  /** Whether it is shown in red: a red flag of its project names it. */
  red: boolean
  /** Why it is red, in words, when the card can say so. */
  note: string | null
}

/** Everything the Kanban lays out. */
export interface KanbanModel {
  columns: KanbanColumn[]
}

/** The task statuses in the order of their columns, with the words the columns are headed by. */
export const COLUMNS: readonly { status: TaskStatus; name: string }[] = [
  { status: 'not-started', name: 'Not started' },
  { status: 'in-progress', name: 'In progress' },
  { status: 'on-hold', name: 'On hold' },
  { status: 'done', name: 'Done' },
  { status: 'cancelled', name: 'Cancelled' },
]

/**
 * The statuses a card in `from` can be moved to on the Kanban. A task is never set back to not
 * started, and a cancelled task stays cancelled (SC-003, SC-038); any other move is offered, and
 * the service layer refuses what the viewer's role or the task's relations do not allow (DD-039).
 */
export function movesFrom(from: TaskStatus): TaskStatus[] {
  if (from === 'cancelled') return []
  return COLUMNS.map((column) => column.status).filter(
    (status) => status !== from && status !== 'not-started',
  )
}

/** The date a task is scheduled on, to order its column by: null for an unscheduled task. */
export function scheduledOn(task: ApiTask): string | null {
  if (task.milestone) return task.milestone.date
  if (!task.plannedStart || !task.plannedFinish) return null
  return task.plannedStart
}

/**
 * Builds the Kanban of the given projects from their tasks and red flags.
 *
 * - One column per task status, every task in the column of its own status, cancelled tasks in
 *   the cancelled column (FR-048, FR-129).
 * - In each column, the scheduled tasks by planned start (a milestone by its date), then the
 *   unscheduled ones (no planned start or finish; a milestone with no date), at the bottom
 *   (FR-004, FR-145). Tasks on the same date, and the unscheduled ones, keep the API's order.
 * - A card is red when a red flag names its task: its assigned people cannot do it, a fixed-date
 *   milestone is pushed past its date, or it starts before another project's milestone it
 *   depends on, as on the Gantt.
 */
export function buildKanbanModel(
  projects: readonly KanbanProject[],
  tasks: readonly KanbanTask[],
  flags: readonly ApiRedFlag[],
): KanbanModel {
  const byId = new Map(projects.map((project) => [project.id, project]))
  const several = projects.length > 1
  const titles = new Map(tasks.map((task) => [task.id, task.title]))

  const notes = new Map<string, string | null>()
  for (const flag of flags) {
    if (!flag.task) continue
    notes.set(flag.task.id, notes.get(flag.task.id) ?? noteOf(flag, titles))
  }

  const columns: KanbanColumn[] = COLUMNS.map(({ status, name }) => ({
    status,
    name,
    scheduled: [],
    unscheduled: [],
  }))
  const columnOf = new Map(columns.map((column) => [column.status, column]))
  for (const task of tasks) {
    const column = columnOf.get(task.status)
    if (!column) continue
    const card: KanbanCard = {
      task,
      project: several ? (byId.get(task.projectId) ?? null) : null,
      red: notes.has(task.id),
      note: notes.get(task.id) ?? null,
    }
    if (scheduledOn(task) === null) column.unscheduled.push(card)
    else column.scheduled.push(card)
  }
  for (const column of columns) {
    // Array.prototype.sort is stable, so tasks on one date keep the API's order.
    column.scheduled.sort((a, b) => scheduledOn(a.task)!.localeCompare(scheduledOn(b.task)!))
  }
  return { columns }
}

/** What a card says of why it is red, from the red flag that names its task. */
function noteOf(flag: ApiRedFlag, titles: ReadonlyMap<string, string>): string | null {
  switch (flag.kind) {
    case 'assignee-unavailable':
      return 'The people assigned cannot do it in its time'
    case 'fixed-date-milestone-pushed': {
      const blocker = flag.blocker ? titles.get(flag.blocker.id) : undefined
      if (blocker && flag.blockerFinish) {
        return `Pushed past its fixed date: ${blocker} finishes ${formatDay(flag.blockerFinish)}`
      }
      return 'Pushed past its fixed date'
    }
    case 'cross-project-dependency':
      return "Starts before another project's milestone it depends on"
    case 'overload':
      break
  }
  return null
}

/** A task's planned dates as its card shows them, such as `1–3 Mar · 3d`; null when it has none. */
export function datesLabel(task: ApiTask): string | null {
  if (task.milestone) return task.milestone.date ? formatDay(task.milestone.date) : null
  if (!task.plannedStart || !task.plannedFinish) return null
  const [start, finish] = [task.plannedStart, task.plannedFinish]
  let span: string
  if (start === finish) span = formatDay(start)
  else if (start.slice(0, 7) === finish.slice(0, 7)) {
    span = `${Number(start.slice(8))}–${formatDay(finish)}`
  } else span = `${formatDay(start)} – ${formatDay(finish)}`
  return task.durationWorkingDays === null ? span : `${span} · ${task.durationWorkingDays}d`
}
