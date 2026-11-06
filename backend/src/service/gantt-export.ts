import { asc, eq } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { projects, taskBlockedBy, tasks } from '../db/schema.ts'
import type { Caller } from './caller.ts'
import { notVisible } from './errors.ts'
import type { ProjectRoleService } from './project-roles.ts'

/** A task as the exporter reads it: its title and the dates it lies on, `YYYY-MM-DD`. */
export interface GanttTask {
  id: string
  title: string
  plannedStart: string | null
  plannedFinish: string | null
  milestoneVariant: 'fixed-date' | 'floating' | null
  milestoneDate: string | null
  floatingDate: string | null
}

/** A blocked-by relation between two tasks: `taskId` is blocked by `blockerId`. */
export interface GanttDependency {
  taskId: string
  blockerId: string
}

/** What the exporter turns into a chart: a Gantt's title, tasks and dependencies. */
export interface Gantt {
  title: string
  /** In the order the chart lists them. */
  tasks: readonly GanttTask[]
  /** In the order a task's blockers are named. */
  dependencies: readonly GanttDependency[]
}

/** A Gantt exported as a Mermaid gantt chart, ready to paste into GitHub markdown (FR-063). */
export interface MermaidGantt {
  /** The chart in a fenced `mermaid` code block, which GitHub markdown renders as a chart. */
  markdown: string
}

/**
 * Words that Mermaid's gantt grammar reads as a statement when a line starts with them, so that a
 * task titled "Section review" would not be a task. A title that starts with one of them has its
 * first character written as an entity. Matched as a prefix, ignoring case, which errs on the
 * safe side: an entity renders as the character it stands for.
 */
const STATEMENT_WORDS = [
  'accdescr',
  'acctitle',
  'axisformat',
  'call',
  'click',
  'dateformat',
  'excludes',
  'gantt',
  'href',
  'inclusiveenddates',
  'includes',
  'section',
  'tickinterval',
  'title',
  'todaymarker',
  'topaxis',
  'weekday',
  'weekend',
]

/**
 * Characters written as they are in a chart's text. Any other is written as a Mermaid entity,
 * `#<code point>;`, which the chart renders as the character itself: so that a colon cannot end a
 * task's title, a `#` or `%%` cannot start a comment, markup cannot be read as markup, and an
 * entity in a title is shown as typed.
 */
const PLAIN = /[\p{L}\p{M}\p{N} .,\-_()[\]'!?/+*@=]/u

/**
 * A title as one line of a chart's text: its runs of white space made one space, and every
 * character Mermaid could read as syntax written as an entity.
 */
export function chartText(title: string): string {
  const line = title.replace(/\s+/gu, ' ').trim()
  let text = ''
  for (const character of line) {
    text += PLAIN.test(character) ? character : entity(character)
  }
  const lower = line.toLowerCase()
  if (text !== '' && STATEMENT_WORDS.some((word) => lower.startsWith(word))) {
    const first = String.fromCodePoint(line.codePointAt(0) ?? 0)
    text = entity(first) + text.slice(first.length)
  }
  return text
}

function entity(character: string): string {
  return `#${character.codePointAt(0)};`
}

/** Where a task lies on the chart: a bar from its start to its finish, or a milestone's day. */
type Placed = { kind: 'bar'; start: string; finish: string } | { kind: 'milestone'; day: string }

/**
 * Where the task lies, or `null` if it lies nowhere: a task without both a planned start and a
 * planned finish, or a floating milestone the scheduler has not placed.
 */
function placed(task: GanttTask): Placed | null {
  if (task.milestoneVariant === 'fixed-date' && task.milestoneDate !== null) {
    return { kind: 'milestone', day: task.milestoneDate }
  }
  if (task.milestoneVariant === 'floating') {
    return task.floatingDate === null ? null : { kind: 'milestone', day: task.floatingDate }
  }
  if (task.milestoneVariant !== null) return null
  if (task.plannedStart === null || task.plannedFinish === null) return null
  return { kind: 'bar', start: task.plannedStart, finish: task.plannedFinish }
}

/**
 * The Gantt as a Mermaid gantt chart in a fenced code block (FR-063, DD-004): its title, then
 * each task that lies on a date, as a bar from its planned start to its planned finish, both days
 * included, or as a milestone on its day. Each task names the tasks on the chart it depends on,
 * "(after A, B)". Mermaid's own `after` would start the task where its blockers end and so move it
 * off its scheduled dates, such as a fixed-date milestone off its date; the chart keeps the dates.
 *
 * The chart holds nothing of load or red flags (DD-004): no load figure, no violation, and none of
 * Mermaid's `crit` markings, which it draws in red. Its lines are indented four spaces, so that no
 * title can close the code block.
 */
export function mermaidGantt(gantt: Gantt): string {
  const shown = new Map<string, { task: GanttTask; at: Placed }>()
  for (const task of gantt.tasks) {
    const at = placed(task)
    if (at !== null) shown.set(task.id, { task, at })
  }
  const blockers = new Map<string, string[]>()
  for (const { taskId, blockerId } of gantt.dependencies) {
    const blocker = shown.get(blockerId)
    if (!shown.has(taskId) || blocker === undefined) continue
    const named = blockers.get(taskId) ?? []
    named.push(chartText(blocker.task.title))
    blockers.set(taskId, named)
  }
  const lines = [
    '```mermaid',
    'gantt',
    `    title ${chartText(gantt.title)}`,
    '    dateFormat YYYY-MM-DD',
    '    inclusiveEndDates',
  ]
  for (const { task, at } of shown.values()) {
    const after = blockers.get(task.id)
    const label = chartText(task.title) + (after ? ` (after ${after.join(', ')})` : '')
    const data = at.kind === 'bar' ? `${at.start}, ${at.finish}` : `milestone, ${at.day}, 0d`
    lines.push(`    ${label} : ${data}`)
  }
  lines.push('```')
  return `${lines.join('\n')}\n`
}

/**
 * The Mermaid Gantt exporter of the service layer (SC-021, DD-039): it exports a project's Gantt
 * as a Mermaid gantt chart that renders in GitHub markdown, carrying its tasks, dates,
 * dependencies and milestones, and leaving out load and red flags (FR-063, DD-004). Anyone with a
 * role in the project may export it, as they may read it (FR-106); someone with none is told the
 * project is not visible to them (FR-017).
 */
export class GanttExportService {
  readonly #db: Database
  readonly #roles: ProjectRoleService

  constructor(db: Database, roles: ProjectRoleService) {
    this.#db = db
    this.#roles = roles
  }

  /**
   * The project's Gantt as a Mermaid gantt chart: its tasks in the order they were created, each
   * naming the tasks of the project it depends on in the order the relations were made.
   */
  async exportProjectGantt(caller: Caller, projectId: string): Promise<MermaidGantt> {
    return this.#db.transaction(
      async (tx) => {
        await this.#roles.permissions.require(caller, projectId, 'read', tx)
        const [project] = await tx
          .select({ name: projects.name })
          .from(projects)
          .where(eq(projects.id, projectId))
        if (!project) throw notVisible()
        const rows = await tx
          .select({
            id: tasks.id,
            title: tasks.title,
            plannedStart: tasks.plannedStart,
            plannedFinish: tasks.plannedFinish,
            milestoneVariant: tasks.milestoneVariant,
            milestoneDate: tasks.milestoneDate,
            floatingDate: tasks.floatingDate,
          })
          .from(tasks)
          .where(eq(tasks.projectId, projectId))
          .orderBy(asc(tasks.createdAt), asc(tasks.id))
        const dependencies = await tx
          .select({ taskId: taskBlockedBy.taskId, blockerId: taskBlockedBy.blockerId })
          .from(taskBlockedBy)
          .innerJoin(tasks, eq(tasks.id, taskBlockedBy.taskId))
          .where(eq(tasks.projectId, projectId))
          .orderBy(asc(taskBlockedBy.createdAt), asc(taskBlockedBy.blockerId))
        return { markdown: mermaidGantt({ title: project.name, tasks: rows, dependencies }) }
      },
      // One snapshot, so that the chart is of the plan at one moment.
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
  }
}
