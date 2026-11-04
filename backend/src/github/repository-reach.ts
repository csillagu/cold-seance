import type { Repository } from './app-tokens.ts'
import {
  GitHubCallError,
  GitHubTokenRefusedError,
  GitHubUnreachableError,
  type GitHubClient,
} from './client.ts'

/** A repository the tool reaches on GitHub, as GitHub names it. */
export interface ReachedRepository {
  /** GitHub's own id for the repository, which stays the same when it is renamed. */
  githubId: number
  owner: string
  name: string
}

/**
 * Whether the tool can reach a repository on GitHub (FR-167): through the GitHub App installed on
 * it or the personal access token given for reading issues (DD-060), the function every project
 * that uses a repository needs first.
 */
export interface RepositoryReach {
  /**
   * The repository as GitHub names it, or `undefined` if the tool cannot reach it: the App is not
   * installed on it, the token is not given it, or it does not exist. Rejects with a
   * `GitHubUnavailableError` when GitHub cannot tell: it cannot be reached, it refuses the tool's
   * token as expired or revoked, or it answers something else.
   */
  reach(repository: Repository): Promise<ReachedRepository | undefined>
}

/** GitHub could not tell whether the tool reaches a repository. */
export class GitHubUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GitHubUnavailableError'
  }
}

/**
 * Asks GitHub for the repository through `client`, which is called on the first question only, so
 * that the GitHub client is built when the tool first needs it.
 */
export function gitHubRepositoryReach(client: () => GitHubClient): RepositoryReach {
  let built: GitHubClient | undefined
  return {
    async reach(repository) {
      built ??= client()
      let data: unknown
      try {
        ;({ data } = await built.rest('readIssues', repository, { method: 'GET', path: [] }))
      } catch (error) {
        if (error instanceof GitHubTokenRefusedError) {
          throw new GitHubUnavailableError(error.message, { cause: error })
        }
        if (error instanceof GitHubUnreachableError) return undefined
        if (error instanceof GitHubCallError) {
          throw new GitHubUnavailableError(error.message, { cause: error })
        }
        throw error
      }
      const reached = reachedRepository(data)
      if (reached === undefined) {
        throw new GitHubUnavailableError(
          `GitHub answered something that is not a repository for ${repository.owner}/${repository.name}`,
        )
      }
      return reached
    },
  }
}

function reachedRepository(data: unknown): ReachedRepository | undefined {
  const id = field(data, 'id')
  const name = field(data, 'name')
  const owner = field(field(data, 'owner'), 'login')
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) return undefined
  if (typeof name !== 'string' || typeof owner !== 'string') return undefined
  return { githubId: id, owner, name }
}

function field(json: unknown, name: string): unknown {
  if (typeof json !== 'object' || json === null) return undefined
  const value: unknown = Reflect.get(json, name)
  return value
}
