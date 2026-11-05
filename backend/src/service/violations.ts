import { and, asc, eq, ne, or, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Database, Executor } from '../db/client.ts'
import { taskBlockedBy, tasks } from '../db/schema.ts'
import type { Caller } from './caller.ts'
import type { ProjectRoleService } from './project-roles.ts'

/** A task as a violation names it: which task, and the project that owns it. */
export interface ViolationTask {
  id: string
  projectId: string
  title: string
}

/**
 * What a violation is:
 *
 * - `fixed-date-milestone-pushed`: work a fixed-date milestone depends on finishes after the date
 *   the milestone is pinned to, so would push it past that date (FR-013).
 * - `cross-project-dependency`: a milestone another project owns lies after the start of a task
 *   that depends on it (FR-019); a conflict across a project boundary, which both projects'
 *   owners see (FR-147).
 *
 * A fixed-date milestone that depends on another project's milestone and is pushed by it is
 * reported once, as `fixed-date-milestone-pushed`, with `crossProject` set.
 */
export type ViolationKind = 'fixed-date-milestone-pushed' | 'cross-project-dependency'

/**
 * A violation, shown in red (DD-029): one blocked-by relation that does not hold, `task` blocked
 * by `blocker`. Nothing is moved to remove it; the owners resolve it.
 */
export interface Violation {
  kind: ViolationKind
  /** The task that depends on the blocker: the milestone pushed, or the task started too early. */
  task: ViolationTask
  /** What it depends on: the work that pushes the milestone, or the other project's milestone. */
  blocker: ViolationTask
  /** Whether the two lie in different projects: a conflict across a project boundary (FR-147). */
  crossProject: boolean
  /** The day the task starts: a fixed-date milestone's date, or the task's start, `YYYY-MM-DD`. */
  start: string
  /** The day the blocker finishes, after `start`: a milestone's date, or a task's planned finish. */
  blockerFinish: string
}

/** One side of a blocked-by relation, with the dates a violation is worked out from. */
export interface DependencyEnd extends ViolationTask {
  milestoneVariant: 'fixed-date' | 'floating' | null
  plannedStart: string | null
  plannedFinish: string | null
  milestoneDate: string | null
  floatingDate: string | null
}

/** A blocked-by relation: `task` is blocked by `blocker`. */
export interface Dependency {
  task: DependencyEnd
  blocker: DependencyEnd
}

/** The day a task starts, as a dependency on it is checked: a milestone's date, or its start. */
function startOf(end: DependencyEnd): string | null {
  if (end.milestoneVariant === 'fixed-date') return end.milestoneDate
  if (end.milestoneVariant === 'floating') return end.floatingDate
  return end.plannedStart
}

/** The day a blocker finishes: a milestone's date, or a task's planned finish. */
function finishOf(end: DependencyEnd): string | null {
  if (end.milestoneVariant === 'fixed-date') return end.milestoneDate
  if (end.milestoneVariant === 'floating') return end.floatingDate
  return end.plannedFinish
}

/**
 * The violation the dependency makes, or `null` if it holds. It is a violation when the task is a
 * fixed-date milestone and the blocker finishes after the milestone's date (FR-013, SRC-022), or
 * when the blocker is a milestone of another project that lies after the task's start (FR-019,
 * SRC-048). A task or a blocker without the date it would be checked by makes none: an
 * unscheduled task has no start to lie after.
 *
 * Within a project, any other dependency is the scheduler's to keep (SC-004): it starts a task
 * after its blockers, so there is nothing to show. A blocker finishing on the very day the task
 * starts is no violation: a milestone takes no time, and a floating one lies on the day its last
 * blocker finishes (FR-195), so a finish on that day does not push it.
 */
export function violationOf({ task, blocker }: Dependency): Violation | null {
  const crossProject = task.projectId !== blocker.projectId
  let kind: ViolationKind
  if (task.milestoneVariant === 'fixed-date') kind = 'fixed-date-milestone-pushed'
  else if (crossProject && blocker.milestoneVariant !== null) kind = 'cross-project-dependency'
  else return null
  const start = startOf(task)
  const blockerFinish = finishOf(blocker)
  if (start === null || blockerFinish === null || blockerFinish <= start) return null
  return {
    kind,
    task: ref(task),
    blocker: ref(blocker),
    crossProject,
    start,
    blockerFinish,
  }
}

function ref({ id, projectId, title }: ViolationTask): ViolationTask {
  return { id, projectId, title }
}

const blocked = alias(tasks, 'blocked')
const blocker = alias(tasks, 'blocker')

function endColumns(table: typeof blocked | typeof blocker) {
  return {
    id: table.id,
    projectId: table.projectId,
    title: table.title,
    milestoneVariant: table.milestoneVariant,
    plannedStart: table.plannedStart,
    plannedFinish: table.plannedFinish,
    milestoneDate: table.milestoneDate,
    floatingDate: table.floatingDate,
  }
}

/**
 * Every violation that involves a task of the project, whoever may see it: of its own fixed-date
 * milestones, of its tasks that depend on another project's milestone, and of other projects'
 * tasks that depend on one of its milestones (FR-147). A cancelled task is out of the plan, so
 * a dependency of one is not checked. In the order the dependent tasks were created, then the
 * order the relations were made.
 */
export async function violationsIn(executor: Executor, projectId: string): Promise<Violation[]> {
  return violationsWhere(
    executor,
    or(eq(blocked.projectId, projectId), eq(blocker.projectId, projectId)),
  )
}

/**
 * Every violation in every project, in the order `violationsIn` gives them: for the red flag
 * register (SC-043).
 */
export async function everyViolation(executor: Executor): Promise<Violation[]> {
  return violationsWhere(executor, undefined)
}

async function violationsWhere(executor: Executor, scope: SQL | undefined): Promise<Violation[]> {
  const rows = await executor
    .select({ task: endColumns(blocked), blocker: endColumns(blocker) })
    .from(taskBlockedBy)
    .innerJoin(blocked, eq(blocked.id, taskBlockedBy.taskId))
    .innerJoin(blocker, eq(blocker.id, taskBlockedBy.blockerId))
    .where(
      and(
        scope,
        or(eq(blocked.milestoneVariant, 'fixed-date'), ne(blocked.projectId, blocker.projectId)),
        ne(blocked.status, 'cancelled'),
        ne(blocker.status, 'cancelled'),
      ),
    )
    .orderBy(
      asc(blocked.createdAt),
      asc(blocked.id),
      asc(taskBlockedBy.createdAt),
      asc(taskBlockedBy.blockerId),
    )
  return rows.flatMap((dependency) => violationOf(dependency) ?? [])
}

/**
 * The milestone and dependency violation detector of the service layer (SC-007, DD-039). It
 * finds the violations shown in red at milestones and dependencies (DD-029): a fixed-date
 * milestone that work it depends on would push past its date (FR-013); a dependency on another
 * project's milestone that lies after the dependent task's start, red in the dependent project
 * (FR-019); and, as such a dependency is a conflict across a project boundary, the same violation
 * in the milestone's project too, so that the owners on both sides see it to resolve it (FR-147).
 *
 * It only reports: it moves no task to remove a violation, in either project (FR-019, DD-029).
 * A conflict across a project boundary of another kind, a shared person's overload, is the
 * overload detector's (SC-040).
 */
export class ViolationService {
  readonly #db: Database
  readonly #roles: ProjectRoleService

  constructor(db: Database, roles: ProjectRoleService) {
    this.#db = db
    this.#roles = roles
  }

  /**
   * The violations that involve a task of the project, for anyone with a role in it (FR-106).
   * Refused as not visible to someone with no role in it (FR-017). A violation across a project
   * boundary is given only to a caller who can read both projects, so that it tells nothing about
   * a project the caller cannot read (FR-059).
   */
  async violationsOf(caller: Caller, projectId: string): Promise<Violation[]> {
    await this.#roles.permissions.require(caller, projectId, 'read')
    const found = await violationsIn(this.#db, projectId)
    if (!found.some((violation) => violation.crossProject)) return found
    const readable = await this.#roles.readableProjects(caller.accountId)
    return found.filter(
      (violation) =>
        readable.has(violation.task.projectId) && readable.has(violation.blocker.projectId),
    )
  }
}
