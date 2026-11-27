import { and, asc, eq, min } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { projectRepositoryRequests, repositories, taskIssues } from '../db/schema.ts'
import type { Repository } from './app-tokens.ts'
import type { GitHubChangeHandler } from './change-handler.ts'
import type { GitHubClient } from './client.ts'
import { openedSince, wholeSecond } from '../service/github-issue-tasks.ts'
import { numberField, objectField, stringField } from './json.ts'

export interface UnknownIssueOptions {
  /** Told of each repository whose issues could not be listed, such as while GitHub cannot be reached. */
  onRepositoryError?: (error: unknown, repository: Repository) => void
  /** Told of each issue found that could not be taken in. */
  onError?: (error: unknown, issue: Repository & { number: number }) => void
}

/**
 * The re-check's search for issues no task is linked to (SC-024, FR-214, SRC-297), whether or not
 * a webhook is configured: for each registered repository that a project pulls issues from, it
 * lists the repository's issues, open and closed, and hands each that no task is linked to, and
 * that was opened since the earliest approval of a project's request for the repository, to the
 * GitHub change handler (SC-023), which adds it to the receiving project if that project was given
 * the repository before the issue was opened. Pull requests, which GitHub lists among the issues,
 * are left out.
 *
 * GitHub's `since` keeps only issues updated since then, and an issue opened since then has been
 * updated since, so it is asked for the issues updated since the earliest approval. A repository
 * whose list cannot be read is told to `onRepositoryError`, and an issue that cannot be taken in to
 * `onError`; the search goes on with the next.
 */
export async function takeInUnknownIssues(
  db: Database,
  github: () => GitHubClient,
  handler: Pick<GitHubChangeHandler, 'issueFound'>,
  options: UnknownIssueOptions = {},
): Promise<void> {
  const onRepositoryError = options.onRepositoryError ?? (() => {})
  const onError = options.onError ?? (() => {})
  const pulled = await db
    .select({
      id: repositories.id,
      owner: repositories.owner,
      name: repositories.name,
      since: min(projectRepositoryRequests.decidedAt),
    })
    .from(repositories)
    .innerJoin(
      projectRepositoryRequests,
      and(
        eq(projectRepositoryRequests.repositoryId, repositories.id),
        eq(projectRepositoryRequests.state, 'approved'),
      ),
    )
    .groupBy(repositories.id, repositories.owner, repositories.name)
    .orderBy(asc(repositories.owner), asc(repositories.name))
  let client: GitHubClient | undefined
  for (const { id, owner, name, since } of pulled) {
    if (since === null) continue
    const repository = { owner, name }
    let listed: unknown[]
    try {
      client ??= github()
      listed = await client.restPages('readIssues', repository, {
        path: ['issues'],
        // GitHub takes the time to the whole second, as `YYYY-MM-DDTHH:MM:SSZ`.
        query: {
          state: 'all',
          since: wholeSecond(since)
            .toISOString()
            .replace(/\.\d{3}Z$/, 'Z'),
          per_page: 100,
        },
      })
    } catch (error) {
      onRepositoryError(error, repository)
      continue
    }
    const linked = new Set(
      (
        await db
          .select({ githubId: taskIssues.githubId })
          .from(taskIssues)
          .where(eq(taskIssues.repositoryId, id))
      ).map((row) => row.githubId),
    )
    const found = listed
      .flatMap((data) => {
        const number = numberField(data, 'number')
        const githubId = numberField(data, 'id')
        const opened = stringField(data, 'created_at')
        if (objectField(data, 'pull_request') !== undefined) return []
        if (number === undefined || githubId === undefined || opened === undefined) return []
        const openedAt = new Date(opened)
        if (linked.has(githubId) || !openedSince(openedAt, since)) return []
        const closed = stringField(data, 'state') === 'closed'
        const closedAt = stringField(data, 'closed_at')
        return [
          {
            number,
            githubId,
            title: stringField(data, 'title') ?? '',
            openedAt,
            openedBy: stringField(objectField(data, 'user'), 'login'),
            state: !closed
              ? ('open' as const)
              : stringField(data, 'state_reason') === 'not_planned'
                ? ('not-planned' as const)
                : ('closed' as const),
            closedAt: closed && closedAt !== undefined ? new Date(closedAt) : null,
          },
        ]
      })
      .sort((a, b) => a.number - b.number)
    for (const issue of found) {
      try {
        await handler.issueFound(repository, issue)
      } catch (error) {
        onError(error, { ...repository, number: issue.number })
      }
    }
  }
}
