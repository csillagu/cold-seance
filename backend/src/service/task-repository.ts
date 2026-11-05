import { eq } from 'drizzle-orm'
import type { Database, Executor } from '../db/client.ts'
import { tasks } from '../db/schema.ts'
import { TaskAssignments } from './assignment.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import type { ProjectRepositoryService } from './project-repositories.ts'
import type { ProjectRoleService } from './project-roles.ts'
import { isUuid } from './system-admins.ts'
import { type Task, taskColumns, type TaskRow, toCompleteTask } from './tasks.ts'

/** Why a task cannot be assigned to a repository its project does not pull issues from (FR-141). */
export const NOT_PULLED_MESSAGE =
  'A task can be assigned only to one of the repositories its project pulls issues from'

/**
 * The task repository assignment of the service layer (DD-039, SC-036): it sets the repository a
 * task is assigned to (FR-141, SRC-168), accepting only one of the repositories the task's project
 * pulls issues from (SRC-175), as the project repository approvals (SC-110) say it does at that
 * moment. A repository the project does not pull from, whether registered or not, is refused as
 * invalid, and the task stays as it was.
 *
 * Who may assign is not stated; it is held to the rule for editing the plan, so the project's
 * read-write members and admins may and its contributors may not (FR-108), and someone with no
 * role in the project is told it is not visible to them (FR-017). This awaits the owner's
 * confirmation. Each assignment is recorded in the audit log, in the task's project, in the
 * transaction that makes it (FR-116).
 *
 * Not stated, and awaiting the owner's answer: whether a task assigned to a repository can be
 * assigned to another one its project pulls from (it can: the done criterion accepts any such
 * repository), and whether an assignment can be taken back (it is not offered). Assigning a task
 * to the repository it is already assigned to changes nothing. A task keeps its repository when
 * the project stops pulling from it (FR-178). Creating the task's GitHub issue once it is
 * assigned (SRC-168) is the GitHub planning mirror's business (SC-022, SC-060), not this one's.
 */
export class TaskRepositoryService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService
  readonly #projectRepositories: ProjectRepositoryService
  readonly #assignments: TaskAssignments

  constructor(
    db: Database,
    audit: AuditLogService,
    roles: ProjectRoleService,
    projectRepositories: ProjectRepositoryService,
  ) {
    this.#db = db
    this.#audit = audit
    this.#roles = roles
    this.#projectRepositories = projectRepositories
    this.#assignments = new TaskAssignments(roles)
  }

  /**
   * Assigns the task to the repository `repositoryId`, by its id in the tool, and answers the task
   * as it now is. Refused as not found if there is no such task, as not visible to someone with no
   * role in its project, as forbidden to someone whose role there does not allow editing the plan,
   * and as invalid unless the task's project pulls issues from the repository.
   */
  async assignRepository(caller: Caller, taskId: string, repositoryId: unknown): Promise<Task> {
    return this.#db.transaction(async (tx) => {
      // The role is checked before the task is locked, so that someone who may not assign it
      // cannot hold it up; a task never changes project, so the check still holds once it is.
      const found = await this.#find(tx, taskId, false)
      await this.#roles.permissions.require(caller, found.projectId, 'edit-plan', tx)
      const current = await this.#find(tx, taskId, true)
      // The approval is locked until the assignment is made, so that a withdrawal waits for it.
      if (
        typeof repositoryId !== 'string' ||
        !(await this.#projectRepositories.pulls(current.projectId, repositoryId, {
          executor: tx,
          lock: true,
        }))
      ) {
        throw new ServiceError('invalid', NOT_PULLED_MESSAGE)
      }
      if (current.repositoryId === repositoryId) return this.#out(tx, current)
      const [updated] = await tx
        .update(tasks)
        .set({ repositoryId })
        .where(eq(tasks.id, taskId))
        .returning(taskColumns)
      if (!updated) throw new Error('The assigned task was not returned')
      await this.#audit.record(tx, caller, {
        action: 'task.repository-assigned',
        subject: { type: 'task', id: taskId },
        projectId: current.projectId,
        details: { repositoryId, previous: current.repositoryId },
      })
      return this.#out(tx, updated)
    })
  }

  #out(executor: Executor, row: TaskRow): Promise<Task> {
    return toCompleteTask(this.#assignments, executor, row)
  }

  async #find(executor: Executor, taskId: string, lock: boolean): Promise<TaskRow> {
    if (!isUuid(taskId)) throw noSuchTask()
    const query = executor.select(taskColumns).from(tasks).where(eq(tasks.id, taskId))
    const [task] = lock ? await query.for('update') : await query
    if (!task) throw noSuchTask()
    return task
  }
}

function noSuchTask(): ServiceError {
  return new ServiceError('not-found', 'There is no such task')
}
