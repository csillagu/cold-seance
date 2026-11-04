import { describe, expect, it, vi } from 'vitest'
import {
  GitHubRequestError,
  GitHubTokenRefusedError,
  GitHubUnreachableError,
  type GitHubClient,
} from './client.ts'
import { gitHubRepositoryReach, GitHubUnavailableError } from './repository-reach.ts'

const REPO = { owner: 'csillagu', name: 'tc-repo' }

/** A GitHub client whose REST calls answer as `rest` does; nothing else of it is used. */
function client(rest: GitHubClient['rest']): GitHubClient {
  return {
    via: () => 'app',
    rest,
    restPages: () => Promise.reject(new Error('not used')),
    graphql: () => Promise.reject(new Error('not used')),
  }
}

describe('gitHubRepositoryReach', () => {
  it('asks GitHub for the repository as reading issues, and hands back its id and name as GitHub gives them', async () => {
    const rest = vi.fn<GitHubClient['rest']>().mockResolvedValue({
      status: 200,
      data: {
        id: 7001,
        name: 'TC-Repo',
        full_name: 'Csillagu/TC-Repo',
        owner: { login: 'Csillagu' },
      },
    })
    const reach = gitHubRepositoryReach(() => client(rest))
    expect(await reach.reach(REPO)).toEqual({ githubId: 7001, owner: 'Csillagu', name: 'TC-Repo' })
    expect(rest).toHaveBeenCalledWith('readIssues', REPO, { method: 'GET', path: [] })
  })

  it('builds the client on the first question only, and not before', async () => {
    const build = vi.fn<() => GitHubClient>(() =>
      client(async () => ({ status: 200, data: { id: 1, name: 'r', owner: { login: 'o' } } })),
    )
    const reach = gitHubRepositoryReach(build)
    expect(build).not.toHaveBeenCalled()
    await reach.reach(REPO)
    await reach.reach(REPO)
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('answers undefined for a repository the App or token cannot reach', async () => {
    const reach = gitHubRepositoryReach(() =>
      client(() =>
        Promise.reject(
          new GitHubUnreachableError('readIssues', 'app', REPO, 'the App is not installed on it'),
        ),
      ),
    )
    expect(await reach.reach(REPO)).toBeUndefined()
  })

  it.each([
    ['a refused token', new GitHubTokenRefusedError('readIssues', REPO)],
    [
      'any other refusal or failure',
      new GitHubRequestError('readIssues', 'app', REPO, 'GitHub answered 502', { status: 502 }),
    ],
  ])('rejects %s as GitHub being unavailable, keeping it as the cause', async (_, error) => {
    const reach = gitHubRepositoryReach(() => client(() => Promise.reject(error)))
    const rejected = await reach.reach(REPO).then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(rejected).toBeInstanceOf(GitHubUnavailableError)
    expect(rejected).toMatchObject({ message: error.message, cause: error })
  })

  it('lets anything that is not a GitHub call failing through as it is', async () => {
    const bug = new TypeError('csillagu/../x is not a GitHub repository name')
    const reach = gitHubRepositoryReach(() => client(() => Promise.reject(bug)))
    await expect(reach.reach(REPO)).rejects.toBe(bug)
  })

  it.each([
    ['nothing', undefined],
    ['a list', [1, 2]],
    ['no id', { name: 'tc-repo', owner: { login: 'csillagu' } }],
    [
      'an id that is not a whole number',
      { id: 1.5, name: 'tc-repo', owner: { login: 'csillagu' } },
    ],
    ['an id given as text', { id: '7001', name: 'tc-repo', owner: { login: 'csillagu' } }],
    ['no name', { id: 7001, owner: { login: 'csillagu' } }],
    ['no owner', { id: 7001, name: 'tc-repo' }],
    ['an owner without a login', { id: 7001, name: 'tc-repo', owner: 'csillagu' }],
  ])('rejects an answer with %s as GitHub being unavailable', async (_, data) => {
    const reach = gitHubRepositoryReach(() => client(async () => ({ status: 200, data })))
    await expect(reach.reach(REPO)).rejects.toThrow(
      new GitHubUnavailableError(
        'GitHub answered something that is not a repository for csillagu/tc-repo',
      ),
    )
  })
})
