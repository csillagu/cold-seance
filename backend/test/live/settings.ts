/**
 * The live GitHub test suite's settings (SC-126, DD-062), from the environment. The suite runs
 * against the test deployment and a real test repository, so it needs both their addresses and
 * credentials; a missing one stops it before any test runs, naming it.
 */
export interface LiveSettings {
  /** The deployment's address, such as https://1-2-3-4.sslip.io: Terraform's `url` output. */
  url: string
  /** The deployment's first system admin, whom the suite acts as in the tool. */
  admin: { username: string; password: string }
  /** The test repository, which the deployment's GitHub App is installed on. */
  repository: { owner: string; name: string }
  /**
   * The personal access token the suite acts on GitHub with, standing for the GitHub users the
   * test cases name: a classic token with the repo, project and delete_repo scopes, or none of
   * delete_repo if its owner administers the repository.
   */
  githubToken: string
  /** The GitHub Project, owned by `projectOwner`, whose status field the deployment reads. */
  project: { owner: string; number: number }
  statusField: { name: string; started: string; onHold: string }
  /** The deployment's time zone, in which it records actual starts and finishes. */
  timeZone: string
  /** How long a test waits for the deployment's re-check to take in a change made on GitHub. */
  waitMs: number
}

const REQUIRED = [
  'LIVE_URL',
  'LIVE_ADMIN_PASSWORD',
  'LIVE_GITHUB_REPOSITORY',
  'LIVE_GITHUB_TOKEN',
  'LIVE_GITHUB_PROJECT_NUMBER',
] as const

export function liveSettings(env: NodeJS.ProcessEnv = process.env): LiveSettings {
  const value = (name: string) => {
    const v = env[name]?.trim()
    return v === '' ? undefined : v
  }
  const missing = REQUIRED.filter((name) => value(name) === undefined)
  if (missing.length > 0) {
    throw new Error(
      `The live GitHub test suite needs ${missing.join(', ')} (see "Live GitHub tests" in the README)`,
    )
  }
  const repository = value('LIVE_GITHUB_REPOSITORY')!
  const [owner, name, ...rest] = repository.split('/')
  if (!owner || !name || rest.length > 0) {
    throw new Error(`LIVE_GITHUB_REPOSITORY is owner/name, not ${repository}`)
  }
  const projectNumber = Number(value('LIVE_GITHUB_PROJECT_NUMBER'))
  if (!Number.isInteger(projectNumber) || projectNumber < 1) {
    throw new Error('LIVE_GITHUB_PROJECT_NUMBER is the number of a GitHub Project')
  }
  const waitMinutes = Number(value('LIVE_WAIT_MINUTES') ?? 6)
  if (!(waitMinutes > 0)) throw new Error('LIVE_WAIT_MINUTES is a number of minutes')
  return {
    url: value('LIVE_URL')!.replace(/\/+$/, ''),
    admin: {
      username: value('LIVE_ADMIN_USERNAME') ?? 'root',
      password: value('LIVE_ADMIN_PASSWORD')!,
    },
    repository: { owner, name },
    githubToken: value('LIVE_GITHUB_TOKEN')!,
    project: {
      owner: value('LIVE_GITHUB_PROJECT_OWNER') ?? owner,
      number: projectNumber,
    },
    statusField: {
      name: value('LIVE_STATUS_FIELD_NAME') ?? 'Status',
      started: value('LIVE_STATUS_FIELD_STARTED') ?? 'In Progress',
      onHold: value('LIVE_STATUS_FIELD_ON_HOLD') ?? 'On Hold',
    },
    timeZone: value('LIVE_TIMEZONE') ?? 'UTC',
    waitMs: waitMinutes * 60_000,
  }
}

/** Today's date, YYYY-MM-DD, in `timeZone`. */
export function today(timeZone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone })
}

/**
 * Calls `check` until it stops throwing, every 10 seconds, for at most `timeoutMs`; then throws its
 * last error. A change made on GitHub reaches the deployment only at its next re-check.
 */
export async function eventually<T>(
  check: () => Promise<T>,
  timeoutMs: number,
  intervalMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      return await check()
    } catch (error) {
      if (Date.now() + intervalMs > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
}
