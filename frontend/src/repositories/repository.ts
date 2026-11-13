/** An admin of a registered repository, as the REST API lists them. */
export interface RepositoryAdmin {
  accountId: string
  username: string
}

/** A registered repository as `GET /api/repositories` lists it, with its admins by username. */
export interface Repository {
  id: string
  githubId: number
  owner: string
  name: string
  admins: RepositoryAdmin[]
}

/** The repository's name as GitHub writes it: `owner/name`. */
export function fullName(repository: { owner: string; name: string }): string {
  return `${repository.owner}/${repository.name}`
}

/**
 * The owner and name in `text`, written as GitHub writes a repository's name, `owner/name`, with
 * spaces around either part left off; `undefined` unless it holds exactly one `/` with something
 * on both sides of it. Whether such a repository exists, and whether the tool reaches it, is for
 * the REST API to say.
 */
export function parseFullName(text: string): { owner: string; name: string } | undefined {
  const parts = text.trim().split('/')
  if (parts.length !== 2) return undefined
  const [owner = '', name = ''] = parts.map((part) => part.trim())
  if (owner === '' || name === '') return undefined
  return { owner, name }
}
