import { asc, eq } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { repositories, taskIssues } from '../db/schema.ts'
import type { Repository } from './app-tokens.ts'
import type { GitHubChangeHandler } from './change-handler.ts'

export interface RecheckOptions {
  /** Told of each linked issue the re-check could not take in, such as while GitHub cannot be reached. */
  onError?: (error: unknown, issue: Repository & { number: number }) => void
}

/** What the re-check calls: the change handler (SC-023) and the planning mirror (SC-022). */
export interface RecheckParts {
  handler: Pick<GitHubChangeHandler, 'issueChanged'>
  mirror: { mirrorAll(): Promise<void> }
}

/**
 * The re-check of all linked issues (SC-024, FR-101), which the re-check timer runs: each linked
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
