import { asc, eq } from 'drizzle-orm'
import type { Database, Executor, Transaction } from '../db/client.ts'
import { baselines, baselineTasks, tasks } from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { violates } from './db-errors.ts'
import { notVisible, ServiceError } from './errors.ts'
import { allows } from './permissions.ts'
import type { ProjectRoleService } from './project-roles.ts'
import { isUuid } from './system-admins.ts'
import { characters } from './text.ts'

/** A baseline as the service layer lists it: its name, and when it was saved. */
export interface BaselineSummary {
  id: string
  projectId: string
  name: string
  /** When it was saved. */
  savedAt: Date
}

/** A task's planned dates as a baseline holds them, `YYYY-MM-DD`, or null for none. */
export interface BaselineTask {
  taskId: string
  /** The task's title as it is now, for showing the dates against. */
  title: string
  plannedStart: string | null
  plannedFinish: string | null
}

/** A baseline with the dates it holds, in the order the tasks were created. */
export interface Baseline extends BaselineSummary {
  tasks: BaselineTask[]
}

/** The longest name a baseline can have, in characters, as for a project or a group. */
export const BASELINE_NAME_MAX_LENGTH = 200

/** The unique index that keeps a project's baseline names apart (see the schema). */
const BASELINE_NAME_INDEX = 'baselines_project_name_key'

/** Why saving a baseline is refused to a role that does not allow it (FR-065, SRC-133). */
const SAVE_REFUSAL = "Only the project's read-write members and admins can save a baseline"

/** A task's dates as the snapshot reads them. */
export interface PlannedDates {
  plannedStart: string | null
  plannedFinish: string | null
  milestoneVariant: 'fixed-date' | 'floating' | null
  milestoneDate: string | null
  floatingDate: string | null
}

/**
 * A task's planned start and finish as a baseline keeps them (FR-064). A milestone takes no time
 * and has no planned start or finish of its own, so it is kept as the day it lies on, as both: its
 * fixed date, or the day the scheduler placed a floating one on, or none while it has no day.
 */
export function snapshotOf(task: PlannedDates): {
  plannedStart: string | null
  plannedFinish: string | null
} {
  if (task.milestoneVariant === null) {
    return { plannedStart: task.plannedStart, plannedFinish: task.plannedFinish }
  }
  const day = task.milestoneVariant === 'fixed-date' ? task.milestoneDate : task.floatingDate
  return { plannedStart: day, plannedFinish: day }
}

/**
 * The name a baseline is saved under: in one Unicode form, so that the same name typed two ways is
 * one name, and trimmed. Refused if it is empty or too long.
 */
export function baselineName(given: string): string {
  const name = given.normalize('NFC').trim()
  if (name === '') throw new ServiceError('invalid', 'A baseline name is required')
  if (characters(name) > BASELINE_NAME_MAX_LENGTH) {
    throw new ServiceError(
      'invalid',
      `A baseline name can have at most ${BASELINE_NAME_MAX_LENGTH} characters`,
    )
  }
  return name
}

const summaryColumns = {
  id: baselines.id,
  projectId: baselines.projectId,
  name: baselines.name,
  savedAt: baselines.createdAt,
} as const

/**
 * The baseline snapshots of the service layer (SC-009, DD-039). It saves, under a name, a snapshot
 * of every task's planned start and finish in a project (FR-064, DD-036), and keeps several per
 * project, each under its own name (FR-153). Only someone with the read-write role in the project,
 * or its admin, who may do all the read-write role may (FR-109), can save one (FR-065, SRC-133).
 * Anyone with a role in the project can read its baselines (FR-106).
 *
 * A saved baseline is never changed: later changes to the plan leave it as it was saved, and
 * saving another adds one beside it. The saving is recorded in the audit log in the same
 * transaction (FR-116).
 */
export class BaselineService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService

  constructor(db: Database, audit: AuditLogService, roles: ProjectRoleService) {
    this.#db = db
    this.#audit = audit
    this.#roles = roles
  }

  /**
   * Saves a baseline of the project under the given name: every task of the project, with its
   * planned start and finish as they are now. Refused as not visible to someone with no role in
   * the project (FR-017), as forbidden to someone whose role there is not read-write or admin
   * (FR-065), as invalid if the name is empty or too long, and as a conflict if the project already
   * has a baseline of that name (FR-153).
   */
  async saveBaseline(
    caller: Caller,
    projectId: string,
    baseline: { name: string },
  ): Promise<Baseline> {
    // The name once the role allows the save, so that it tells nothing to someone who may not.
    let name = ''
    // The unique index on names decides, so two concurrent saves of one name cannot both succeed.
    try {
      return await this.#db.transaction(async (tx) => {
        const role = await this.#roles.roleOf(caller.accountId, projectId, tx)
        if (role === undefined) throw notVisible()
        if (!allows(role, 'edit-plan')) throw new ServiceError('forbidden', SAVE_REFUSAL)
        name = baselineName(baseline.name)
        return this.#save(tx, caller, projectId, name)
      })
    } catch (error) {
      if (violates(error, BASELINE_NAME_INDEX)) {
        throw new ServiceError('conflict', `This project already has a baseline named ${name}`)
      }
      throw error
    }
  }

  async #save(tx: Transaction, caller: Caller, projectId: string, name: string): Promise<Baseline> {
    const [saved] = await tx
      .insert(baselines)
      .values({ projectId, name, createdBy: caller.accountId })
      .returning(summaryColumns)
    if (!saved) throw new Error('The new baseline was not returned')
    // One statement, so that the snapshot is of the plan at one moment: a change to the plan
    // that has not been committed yet is not in it, in part or at all.
    const current = await tx
      .select({
        taskId: tasks.id,
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
    const held = current.map((task) => ({
      taskId: task.taskId,
      title: task.title,
      ...snapshotOf(task),
    }))
    if (held.length > 0) {
      await tx.insert(baselineTasks).values(
        held.map(({ taskId, plannedStart, plannedFinish }) => ({
          baselineId: saved.id,
          taskId,
          plannedStart,
          plannedFinish,
        })),
      )
    }
    await this.#audit.record(tx, caller, {
      action: 'baseline.saved',
      subject: { type: 'baseline', id: saved.id },
      projectId,
      details: { name, tasks: held.length },
    })
    return { ...saved, tasks: held }
  }

  /**
   * The baselines of the project, in the order they were saved, for anyone with a role in it
   * (FR-106). Refused as not visible to someone with no role in it (FR-017).
   */
  async listBaselines(caller: Caller, projectId: string): Promise<BaselineSummary[]> {
    await this.#roles.permissions.require(caller, projectId, 'read')
    return this.#db
      .select(summaryColumns)
      .from(baselines)
      .where(eq(baselines.projectId, projectId))
      .orderBy(asc(baselines.createdAt), asc(baselines.id))
  }

  /**
   * The baseline with the dates it holds, for anyone with a role in its project (FR-106). Refused
   * as not found if there is no such baseline, and as not visible to someone with no role in its
   * project (FR-017).
   */
  async getBaseline(caller: Caller, baselineId: string): Promise<Baseline> {
    const summary = isUuid(baselineId) ? await this.#find(this.#db, baselineId) : undefined
    if (!summary) throw new ServiceError('not-found', 'There is no such baseline')
    await this.#roles.permissions.require(caller, summary.projectId, 'read')
    const held = await this.#db
      .select({
        taskId: baselineTasks.taskId,
        title: tasks.title,
        plannedStart: baselineTasks.plannedStart,
        plannedFinish: baselineTasks.plannedFinish,
      })
      .from(baselineTasks)
      .innerJoin(tasks, eq(tasks.id, baselineTasks.taskId))
      .where(eq(baselineTasks.baselineId, baselineId))
      .orderBy(asc(tasks.createdAt), asc(tasks.id))
    return { ...summary, tasks: held }
  }

  async #find(executor: Executor, baselineId: string): Promise<BaselineSummary | undefined> {
    const [row] = await executor
      .select(summaryColumns)
      .from(baselines)
      .where(eq(baselines.id, baselineId))
    return row
  }
}
