import { asc, inArray } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { accounts } from '../db/schema.ts'
import { peopleOf } from './assignment.ts'
import type { Caller } from './caller.ts'
import type { TaskService } from './tasks.ts'

/** A person in a task's eligibility or assignment, as the editors name and mark them. */
export interface TaskPerson {
  accountId: string
  username: string
  /** Whether they can read the task's project; the editors mark those who cannot (FR-199). */
  canReadProject: boolean
}

/**
 * The people on a task (SC-099, SC-100): everyone its eligibility expression or assignment names,
 * by username, and whether each can read its project. The editors need it to name and mark someone
 * who has lost read access (FR-199): the project's members no longer list them. Anyone who can read
 * the task can read it, as they already see these people's ids on the task.
 */
export class TaskPeopleService {
  readonly #db: Database
  readonly #tasks: TaskService

  constructor(db: Database, tasks: TaskService) {
    this.#db = db
    this.#tasks = tasks
  }

  /**
   * The people on the task, by username. Refused as the task read is refused: as not visible to
   * someone who cannot read its project (FR-017).
   */
  async peopleOnTask(caller: Caller, taskId: string): Promise<TaskPerson[]> {
    const task = await this.#tasks.getTask(caller, taskId)
    const ids = [...new Set([...peopleOf(task.eligibility), ...task.assignees])]
    if (ids.length === 0) return []
    const without = new Set(task.withoutReadAccess)
    const rows = await this.#db
      .select({ accountId: accounts.id, username: accounts.username })
      .from(accounts)
      .where(inArray(accounts.id, ids))
      .orderBy(asc(accounts.username))
    return rows.map((row) => ({ ...row, canReadProject: !without.has(row.accountId) }))
  }
}
