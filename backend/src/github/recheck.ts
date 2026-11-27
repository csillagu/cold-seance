import { asc, eq } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { repositories, taskIssues } from '../db/schema.ts'
import type { Repository } from './app-tokens.ts'
import type { GitHubChangeHandler } from './change-handler.ts'
import type { GitHubClient } from './client.ts'
import { takeInUnknownIssues } from './unknown-issues.ts'

export interface RecheckOptions {
  /**
   * Told of each issue the re-check could not take in, linked or found with no task linked to it,
   * such as while GitHub cannot be reached.
   */
  onError?: (error: unknown, issue: Repository & { number: number }) => void
  /** Told of each repository whose list of issues the re-check could not read. */
  onRepositoryError?: (error: unknown, repository: Repository) => void
}

/**
 * What the re-check calls: GitHub, for the lists of issues, the change handler (SC-023) and the
 * planning mirror (SC-022).
 */
export interface RecheckParts {
  github: () => GitHubClient
  handler: Pick<GitHubChangeHandler, 'issueChanged' | 'issueFound'>
  mirror: { mirrorAll(): Promise<void> }
}

/**
 * The re-check (SC-024), which the re-check timer runs. First it takes in the issues of the
 * repositories projects pull from that no task is linked to, opened since their repository was
 * given to a project (FR-214, `takeInUnknownIssues`), whether or not a webhook is configured, so
 * that a new issue becomes a task without one. Then it re-checks all linked issues (FR-101): each linked
 * issue is handed to the GitHub change handler as changed, with no sender, so that a difference it
 * finds is handled exactly as if the change had just arrived (SRC-152), and recorded as made by
 * whoever GitHub names for it; then the planning mirror brings every task's issue into line again,
 * putting right what it failed to write since (DD-051). An issue that fails is told to `onError`,
 * and the re-check goes on with the next.
 */
export function recheckLinkedIssues(
  db: Database,
  parts: RecheckParts,
  options: RecheckOptions = {},
): () => Promise<void> {
  const onError = options.onError ?? (() => {})
  return async () => {
    await takeInUnknownIssues(db, parts.github, parts.handler, {
      onError,
      ...(options.onRepositoryError ? { onRepositoryError: options.onRepositoryError } : {}),
    })
    const linked = await db
      .select({ owner: repositories.owner, name: repositories.name, number: taskIssues.number })
      .from(taskIssues)
      .innerJoin(repositories, eq(repositories.id, taskIssues.repositoryId))
      .orderBy(asc(repositories.owner), asc(repositories.name), asc(taskIssues.number))
    for (const issue of linked) {
      try {
        await parts.handler.issueChanged({ owner: issue.owner, name: issue.name }, issue.number)
      } catch (error) {
        onError(error, issue)
      }
    }
    await parts.mirror.mirrorAll()
  }
}
