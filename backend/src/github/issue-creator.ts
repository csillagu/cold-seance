import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { projectRepositoryRequests, repositories, taskIssues, tasks } from '../db/schema.ts'
import { lockIssueLinks } from '../service/github-issue-tasks.ts'
import type { GitHubClient } from './client.ts'
import { numberField } from './json.ts'

/**
 * The GitHub issue creator (SC-060): once a task is assigned to a repository, it creates the
 * task's GitHub issue in that repository and links it to the task (FR-088, DD-001). A task not
 * assigned to a repository has no issue, and a task that has one gets no second.
 *
 * The issue is created with the task's title and nothing else; its planning (assignees, parent,
 * blockers, a fixed-date milestone's date) is the GitHub planning mirror's business (SC-022), which
 * runs right after it. An issue is created only while the task's project pulls issues from the
 * repository: a task its project kept after the approval was withdrawn is left alone (FR-182).
 *
 * The planning mirror calls it for each task it is told of, one at a time, so that two calls for
 * one task cannot both create an issue. It holds the repository's issue-links lock from before it
 * creates the issue until the link is stored, so that the GitHub change handler (SC-023) never
 * takes the issue for one opened on GitHub.
 */
export class GitHubIssueCreator {
  readonly #db: Database
  readonly #github: () => GitHubClient

  /** `github` is called when the creator first calls GitHub, so that the client is built then. */
  constructor(db: Database, github: () => GitHubClient) {
    this.#db = db
    this.#github = github
  }

  /**
   * Creates the task's GitHub issue if it is assigned to a repository its project pulls from and
   * has no issue yet, and links it to the task. Resolves to whether it created one; rejects with
   * what GitHub refused.
   */
  async create(taskId: string): Promise<boolean> {
    const [assigned] = await this.#db
      .select({ repositoryId: tasks.repositoryId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
    if (assigned?.repositoryId == null) return false
    const repositoryId = assigned.repositoryId
    return this.#db.transaction(async (tx) => {
      await lockIssueLinks(tx, repositoryId)
      const [task] = await tx
        .select({
          title: tasks.title,
          repositoryId: repositories.id,
          owner: repositories.owner,
          name: repositories.name,
        })
        .from(tasks)
        .innerJoin(repositories, eq(repositories.id, tasks.repositoryId))
        .innerJoin(
          projectRepositoryRequests,
          and(
            eq(projectRepositoryRequests.projectId, tasks.projectId),
            eq(projectRepositoryRequests.repositoryId, tasks.repositoryId),
            eq(projectRepositoryRequests.state, 'approved'),
          ),
        )
        .leftJoin(taskIssues, eq(taskIssues.taskId, tasks.id))
        .where(
          and(
            eq(tasks.id, taskId),
            eq(tasks.repositoryId, repositoryId),
            isNull(taskIssues.taskId),
          ),
        )
      if (!task) return false
      const { data } = await this.#github().rest(
        'writeIssues',
        { owner: task.owner, name: task.name },
        { method: 'POST', path: ['issues'], body: { title: task.title } },
      )
      const number = numberField(data, 'number')
      const githubId = numberField(data, 'id')
      if (number === undefined || githubId === undefined) {
        throw new Error('GitHub answered a created issue without its number or id')
      }
      await tx
        .insert(taskIssues)
        .values({ taskId, repositoryId: task.repositoryId, number, githubId })
      return true
    })
  }
}
