import { defaultStatusField, type StatusFieldConfig } from '../config/config.ts'
import { type SeedIssue, type SeedingSource, SeedingUnreachableError } from '../service/seeding.ts'
import { GitHubUnreachableError, type GitHubClient } from './client.ts'
import { arrayField, numberField, objectField, stringField } from './json.ts'
import { agreed, readProjectItems, same } from './project-items.ts'

/**
 * Reads a repository's issues from GitHub for the seeding importer (SC-025), through the GitHub
 * client (SC-106), which is called on the first read only: every issue, open and closed, without
 * the pull requests GitHub lists among them; for each, its sub-issues and the issues it is blocked
 * by, and the option of the configured Projects status field (SRC-252) its Project items are in.
 * It only reads. A repository the client cannot reach is reported as a `SeedingUnreachableError`;
 * any other failure is passed on as it is.
 */
export function gitHubSeedingSource(
  client: () => GitHubClient,
  options: { statusField?: StatusFieldConfig } = {},
): SeedingSource {
  const field = options.statusField ?? defaultStatusField
  let built: GitHubClient | undefined
  return {
    async issuesOf(repository) {
      built ??= client()
      const github = built
      try {
        const listed = await github.restPages('readIssues', repository, {
          path: ['issues'],
          query: { state: 'all', per_page: 100 },
        })
        const issues: SeedIssue[] = []
        for (const data of listed) {
          if (objectField(data, 'pull_request') !== undefined) continue
          const number = numberField(data, 'number')
          const githubId = numberField(data, 'id')
          if (number === undefined || githubId === undefined) {
            throw new Error('GitHub answered an issue without its number or id')
          }
          const closed = stringField(data, 'state') === 'closed'
          const closedAt = stringField(data, 'closed_at')
          const ids = async (path: (string | number)[]) =>
            (await github.restPages('readIssues', repository, { path })).flatMap((issue) => {
              const id = numberField(issue, 'id')
              return id === undefined ? [] : [id]
            })
          const subIssueIds = await ids(['issues', number, 'sub_issues'])
          const blockedByIds = await ids(['issues', number, 'dependencies', 'blocked_by'])
          let statusOption: string | null = null
          let projectStatus: SeedIssue['projectStatus'] = null
          if (!closed) {
            const value = agreed(await readProjectItems(github, repository, number, field.name))
            statusOption = value ?? null
            if (value !== null && value !== undefined) {
              if (same(value, field.started)) projectStatus = 'started'
              else if (same(value, field.onHold)) projectStatus = 'on-hold'
            }
          }
          issues.push({
            githubId,
            number,
            title: stringField(data, 'title') ?? '',
            state: !closed
              ? 'open'
              : stringField(data, 'state_reason') === 'not_planned'
                ? 'not-planned'
                : 'closed',
            closedAt: closed && closedAt !== undefined ? new Date(closedAt) : null,
            assignees: arrayField(data, 'assignees').flatMap((a) => {
              const login = stringField(a, 'login')
              return login === undefined ? [] : [login]
            }),
            subIssueIds,
            blockedByIds,
            projectStatus,
            statusOption,
          })
        }
        return issues
      } catch (error) {
        if (error instanceof GitHubUnreachableError) {
          throw new SeedingUnreachableError(error.message, { cause: error })
        }
        throw error
      }
    },
  }
}
