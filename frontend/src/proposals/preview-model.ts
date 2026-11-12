/*
 * What the proposal preview screen (SC-034) shows, worked out from what the REST API gives: each
 * task the proposal would change, before and after, and each new red flag in words. Pure
 * functions, so that the screen and its tests share them.
 */

import { formatDay, type TaskStatus } from '../gantt/gantt-model.ts'

/** A task as the preview gives it (`GET /proposals/{id}/preview`), the fields the screen reads. */
export interface PreviewTask {
  id: string
  projectId: string
  title: string
  status: TaskStatus
  plannedStart: string | null
  plannedFinish: string | null
  durationWorkingDays: number | null
  effort: number | null
  aiShare: number | null
  personLoad: number | null
  milestone: { variant: 'fixed-date' | 'floating'; date: string | null } | null
  assignees: string[]
  parentId: string | null
  blockedBy: string[]
  [field: string]: unknown
}

/** A task the proposal would change, as the preview gives it. */
export interface ApiDifference {
  taskId: string
  projectId: string
  /** The key the proposal gives a task it creates; `null` for a task of the live plan. */
  newTask: string | null
  before: PreviewTask | null
  after: PreviewTask
}

/** A red flag the proposal would newly raise, as the preview gives it. */
export interface ApiNewRedFlag {
  kind:
    'overload' | 'assignee-unavailable' | 'fixed-date-milestone-pushed' | 'cross-project-dependency'
  projectId: string
  accountId?: string
  date?: string
  task?: { id: string; projectId: string }
  blocker?: { id: string; projectId: string }
  start?: string
  blockerFinish?: string
  holiday?: boolean
}

/** The live preview of a proposal, as the API gives it. */
export interface ApiPreview {
  proposalId: string
  differences: ApiDifference[]
  newRedFlags: ApiNewRedFlag[]
}

/** What the screen needs to name things: people, projects and the live plan's tasks, by id. */
export interface Names {
  people: ReadonlyMap<string, string>
  projects: ReadonlyMap<string, string>
  tasks: ReadonlyMap<string, string>
}

/** A value the preview shows: as it is in the live plan, and as the proposal would make it. */
export interface Cell {
  /** In the live plan; `null` for a task the proposal creates. */
  before: string | null
  after: string
  /** Whether the proposal changes it: always for a task the proposal creates. */
  changed: boolean
}

/** A row of the differences: a task the proposal would change. */
export interface DifferenceRow {
  taskId: string
  title: string
  project: string
  /** Whether the proposal creates the task. */
  created: boolean
  start: Cell
  finish: Cell
  days: Cell
  assigned: Cell
  /** Every other change to the task, in words: `Status: not started → in progress`. */
  other: string[]
}

/** A new red flag in words, with the projects it would be raised in. */
export interface FlagLine {
  text: string
  projects: string[]
}

/** What the screen shows. */
export interface PreviewModel {
  rows: DifferenceRow[]
  flags: FlagLine[]
}

const NONE = '—'

const STATUS_WORDS: Record<TaskStatus, string> = {
  'not-started': 'not started',
  'in-progress': 'in progress',
  'on-hold': 'on hold',
  done: 'done',
  cancelled: 'cancelled',
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The day as the screen writes it, with the year, or a dash for none. */
function day(date: string | null): string {
  return date ? formatDay(date, true) : NONE
}

/**
 * The days a task is on: a milestone on its date, any other task from its planned start to its
 * planned finish.
 */
function startOf(task: PreviewTask): string | null {
  return task.milestone ? task.milestone.date : task.plannedStart
}

function finishOf(task: PreviewTask): string | null {
  return task.milestone ? task.milestone.date : task.plannedFinish
}

/** A task's title: as the proposal would make it if the preview shows it, else as the live plan has it. */
function titleOf(id: string, names: Names, differences: readonly ApiDifference[]): string {
  const shown = differences.find((difference) => difference.taskId === id)
  return shown?.after.title ?? names.tasks.get(id) ?? 'a task not visible to you'
}

function personOf(id: string, names: Names): string {
  return names.people.get(id) ?? 'someone who is not a member'
}

/** What a field is said as: its value in words, or `null` when the screen says only that it changed. */
type Describe = (task: PreviewTask, names: Names, differences: readonly ApiDifference[]) => string

const percent = (value: number | null) => (value === null ? NONE : `${value}%`)

/**
 * The fields `other` names, in the order it names them: what it calls each, how it says its value
 * (none for a value said only as changed), and whether it is said of a task the proposal creates.
 * The dates, duration and assigned people have columns of their own.
 */
const OTHER_FIELDS: readonly {
  field: string
  label: string
  describe?: Describe
  ofNewTask?: boolean
}[] = [
  { field: 'title', label: 'Title', describe: (task) => task.title },
  { field: 'description', label: 'Description' },
  {
    field: 'status',
    label: 'Status',
    describe: (task) => STATUS_WORDS[task.status],
    ofNewTask: true,
  },
  {
    field: 'milestone',
    label: 'Milestone',
    describe: ({ milestone }) =>
      milestone === null
        ? NONE
        : `${milestone.variant}${milestone.date ? `, ${day(milestone.date)}` : ''}`,
    ofNewTask: true,
  },
  {
    field: 'parentId',
    label: 'Parent',
    describe: (task, names, differences) =>
      task.parentId === null ? NONE : titleOf(task.parentId, names, differences),
    ofNewTask: true,
  },
  {
    field: 'blockedBy',
    label: 'Blocked by',
    describe: (task, names, differences) =>
      task.blockedBy.length === 0
        ? NONE
        : task.blockedBy.map((id) => titleOf(id, names, differences)).join(', '),
    ofNewTask: true,
  },
  {
    field: 'effort',
    label: 'Effort',
    describe: (task) => (task.effort === null ? NONE : String(task.effort)),
  },
  {
    field: 'aiShare',
    label: 'AI share',
    describe: (task) => percent(task.aiShare),
    ofNewTask: true,
  },
  { field: 'personLoad', label: 'Person load', describe: (task) => percent(task.personLoad) },
  { field: 'loadOverrides', label: 'Load overrides' },
  { field: 'eligibility', label: 'Eligibility' },
  { field: 'repositoryId', label: 'Repository' },
]

function cell(before: string | null, after: string, created: boolean): Cell {
  return { before, after, changed: created || before !== after }
}

/**
 * Builds what the proposal preview screen shows from the preview the API gives.
 *
 * - The rows are the preview's differences, in its order: the start, finish, duration in working
 *   days and assigned people of each task before and after, and every other field the proposal
 *   would change, in words. A task the proposal creates has nothing before.
 * - The new red flags are said in words, each once, with the projects it would be raised in; the
 *   preview gives an overload once for each project involved.
 */
export function buildPreviewModel(preview: ApiPreview, names: Names): PreviewModel {
  const { differences } = preview
  const projectOf = (id: string) => names.projects.get(id) ?? 'a project not visible to you'
  const people = (task: PreviewTask) =>
    task.assignees.length === 0 ? NONE : task.assignees.map((id) => personOf(id, names)).join(', ')
  const days = (task: PreviewTask) =>
    task.milestone || task.durationWorkingDays === null ? NONE : String(task.durationWorkingDays)

  const rows = differences.map((difference): DifferenceRow => {
    const { before, after } = difference
    const created = before === null
    const other: string[] = []
    for (const { field, label, describe, ofNewTask } of OTHER_FIELDS) {
      if (before) {
        if (same(before[field], after[field])) continue
        other.push(
          describe
            ? `${label}: ${describe(before, names, differences)} → ${describe(after, names, differences)}`
            : `${label} changed`,
        )
      } else if (ofNewTask && describe) {
        // A new task is said with what it has: not a status it starts with, nor a field it lacks.
        const value = describe(after, names, differences)
        if (value !== NONE && !(field === 'status' && after.status === 'not-started')) {
          other.push(`${label}: ${value}`)
        }
      }
    }
    return {
      taskId: difference.taskId,
      title: after.title,
      project: projectOf(difference.projectId),
      created,
      start: cell(before && day(startOf(before)), day(startOf(after)), created),
      finish: cell(before && day(finishOf(before)), day(finishOf(after)), created),
      days: cell(before && days(before), days(after), created),
      assigned: cell(before && people(before), people(after), created),
      other,
    }
  })

  const flags: FlagLine[] = []
  for (const flag of preview.newRedFlags) {
    const text = flagText(flag, names, differences)
    const project = projectOf(flag.projectId)
    const line = flags.find((existing) => existing.text === text)
    if (!line) flags.push({ text, projects: [project] })
    else if (!line.projects.includes(project)) line.projects.push(project)
  }
  return { rows, flags }
}

/** A new red flag in words. */
function flagText(
  flag: ApiNewRedFlag,
  names: Names,
  differences: readonly ApiDifference[],
): string {
  const task = flag.task ? titleOf(flag.task.id, names, differences) : 'a task'
  const blocker = flag.blocker ? titleOf(flag.blocker.id, names, differences) : 'a task'
  switch (flag.kind) {
    case 'overload':
      return `${flag.accountId ? personOf(flag.accountId, names) : 'Someone'} overloaded on ${day(flag.date ?? null)}`
    case 'assignee-unavailable':
      return `${task}: its assigned people cannot do it in its time`
    case 'fixed-date-milestone-pushed':
      return `${task}: fixed-date milestone pushed, as ${blocker} finishes ${day(flag.blockerFinish ?? null)}`
    default:
      // A cross-project dependency.
      return `${task} starts ${day(flag.start ?? null)}, before ${blocker} of another project finishes ${day(flag.blockerFinish ?? null)}`
  }
}
