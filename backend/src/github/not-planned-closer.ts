import { and, eq, ne } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { projectRepositoryRequests, repositories, taskIssues, tasks } from '../db/schema.ts'
import type { GitHubClient } from './client.ts'
import { stringField } from './json.ts'

/**
 * The GitHub not-planned closer (SC-061): when a task is cancelled in the tool, it closes the
 * task's GitHub issue with the reason "not planned" (FR-130, DD-001). The issue is closed, never
 * deleted, and never closed as completed.
 *
 * An issue closed as not planned already is left as it is; one that is open, or closed with any
 * other reason, is closed as not planned, the plan being held in the tool. The issue of a task its
 * project kept after the approval for the repository was withdrawn is left alone (FR-182). A task
 * with no linked issue, or not cancelled, is not its business.
 *
 * The GitHub planning mirror (SC-022) calls it for each task it is told of, after mirroring it.
 */
export class GitHubNotPlannedCloser {
  readonly #db: Database
  readonly #github: () => GitHubClient

  /** `github` is called when the closer first calls GitHub, so that the client is built then. */
  constructor(db: Database, github: () => GitHubClient) {
    this.#db = db
    this.#github = github
  }

  /**
   * Closes the cancelled task's linked issue as not planned, unless it is so already. Resolves to
   * whether it closed it; rejects with what GitHub refused.
   */
  async close(taskId: string): Promise<boolean> {
    const [task] = await this.#db
      .select({
        owner: repositories.owner,
        name: repositories.name,
        number: taskIssues.number,
      })
      .from(tasks)
      .innerJoin(taskIssues, eq(taskIssues.taskId, tasks.id))
      .innerJoin(repositories, eq(repositories.id, taskIssues.repositoryId))
      .innerJoin(
        projectRepositoryRequests,
        and(
          eq(projectRepositoryRequests.projectId, tasks.projectId),
          eq(projectRepositoryRequests.repositoryId, taskIssues.repositoryId),
          eq(projectRepositoryRequests.state, 'approved'),
        ),
      )
      .where(
        and(
          eq(tasks.id, taskId),
          eq(tasks.status, 'cancelled'),
          // An issue deleted on GitHub has nothing left to close (FR-136, SC-023).
          ne(taskIssues.seenState, 'deleted'),
        ),
      )
    if (!task) return false
    const repository = { owner: task.owner, name: task.name }
    const client = this.#github()
    const { data: issue } = await client.rest('readIssues', repository, {
      method: 'GET',
      path: ['issues', task.number],
    })
    if (
      stringField(issue, 'state') === 'closed' &&
      stringField(issue, 'state_reason') === 'not_planned'
    ) {
      return false
    }
    await client.rest('writeIssues', repository, {
      method: 'PATCH',
      path: ['issues', task.number],
      body: { state: 'closed', state_reason: 'not_planned' },
    })
    return true
  }
}
