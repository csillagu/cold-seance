/**
 * The live GitHub test suite's settings (SC-126, SC-128, DD-062, DD-063), from the environment.
 * The suite runs against a real test repository and one of two targets, which the command names:
 * `npm run test:live` runs it against the test deployment, `npm run test:live:local` against a
 * backend the run starts itself (`local-server.ts`). Neither falls back to the other. A setting the
 * target needs that is missing stops the run before any test runs, naming it.
 */
export interface LiveSettings {
  /** The tool's address: the deployment's (Terraform's `url` output), or the started server's. */
  url: string
  /** The tool's first system admin, whom the suite acts as in the tool. */
  admin: { username: string; password: string }
  /** The test repository, which the GitHub App is installed on. */
  repository: { owner: string; name: string }
  /**
   * The fine-grained personal access token the suite acts on the test repository with, standing
   * for the GitHub users the test cases name.
   */
  githubToken: string
  /**
   * The classic token, with the project scope, the suite sets the Project's status field with: a
   * fine-grained token cannot reach a Project owned by a user. It is the one the tool reads it with.
   */
  projectsToken: string
  /** The GitHub Project, owned by `projectOwner`, whose status field the tool reads. */
  project: { owner: string; number: number }
  statusField: { name: string; started: string; onHold: string }
  /** The tool's time zone, in which it records actual starts and finishes. */
  timeZone: string
  /**
   * How long a test waits for a change made on GitHub to reach the tool: by the webhook, in
   * seconds, or at the tool's next re-check.
   */
  waitMs: number
}

/** What the suite runs against, as its command names it. */
export type LiveTarget = 'deployment' | 'local'

/** The backend the local target's global setup started (`local-server.ts`), for the tests. */
export interface LocalServer {
  url: string
  admin: { username: string; password: string }
  timeZone: string
  waitMs: number
}

declare module 'vitest' {
  export interface ProvidedContext {
    liveTarget: LiveTarget
    liveServer: LocalServer
  }
}

/** The settings the local target's server is started with, besides the suite's GitHub settings. */
export interface LocalServerSettings {
  /** The PostgreSQL server the run creates the tool's database on, as the integration tests do. */
  databaseServerUrl: string
  /** The GitHub App the tool reads and writes issues with: the deployment's. */
  app: { id: number; privateKey: string }
}

type GitHubSettings = Omit<LiveSettings, 'url' | 'admin' | 'timeZone' | 'waitMs'>

/** Reads settings from `env`, gathering the names of the required ones that are missing. */
class Reader {
  readonly missing: string[] = []
  readonly #env: NodeJS.ProcessEnv

  constructor(env: NodeJS.ProcessEnv) {
    this.#env = env
  }

  optional(name: string): string | undefined {
    const v = this.#env[name]?.trim()
    return v === '' ? undefined : v
  }

  required(name: string): string {
    const v = this.optional(name)
    if (v === undefined) this.missing.push(name)
    return v ?? ''
  }

  /** Throws naming every missing setting, if any is. */
  done(target: LiveTarget): void {
    if (this.missing.length === 0) return
    const command = target === 'local' ? 'npm run test:live:local' : 'npm run test:live'
    throw new Error(
      `${command} needs ${this.missing.join(', ')} (see "Live GitHub tests" in docs/development/live-tests.md)`,
    )
  }
}

function gitHubSettings(read: Reader): () => GitHubSettings {
  const repository = read.required('LIVE_GITHUB_REPOSITORY')
  const githubToken = read.required('LIVE_GITHUB_TOKEN')
  const projectsToken = read.required('LIVE_GITHUB_PROJECTS_TOKEN')
  const projectNumber = read.required('LIVE_GITHUB_PROJECT_NUMBER')
  const projectOwner = read.optional('LIVE_GITHUB_PROJECT_OWNER')
  const statusField = {
    name: read.optional('LIVE_STATUS_FIELD_NAME') ?? 'Status',
    started: read.optional('LIVE_STATUS_FIELD_STARTED') ?? 'In Progress',
    onHold: read.optional('LIVE_STATUS_FIELD_ON_HOLD') ?? 'On Hold',
  }
  // Checked once every missing setting is known, so that one run names them all.
  return () => {
    const [owner, name, ...rest] = repository.split('/')
    if (!owner || !name || rest.length > 0) {
      throw new Error(`LIVE_GITHUB_REPOSITORY is owner/name, not ${repository}`)
    }
    const number = Number(projectNumber)
    if (!Number.isInteger(number) || number < 1) {
      throw new Error('LIVE_GITHUB_PROJECT_NUMBER is the number of a GitHub Project')
    }
    return {
      repository: { owner, name },
      githubToken,
      projectsToken,
      project: { owner: projectOwner ?? owner, number },
      statusField,
    }
  }
}

/** The settings of a run against the test deployment (`npm run test:live`). */
export function deploymentSettings(env: NodeJS.ProcessEnv = process.env): LiveSettings {
  const read = new Reader(env)
  const url = read.required('LIVE_URL')
  const password = read.required('LIVE_ADMIN_PASSWORD')
  const github = gitHubSettings(read)
  read.done('deployment')
  const waitMinutes = Number(read.optional('LIVE_WAIT_MINUTES') ?? 6)
  if (!(waitMinutes > 0)) throw new Error('LIVE_WAIT_MINUTES is a number of minutes')
  return {
    url: url.replace(/\/+$/, ''),
    admin: { username: read.optional('LIVE_ADMIN_USERNAME') ?? 'root', password },
    ...github(),
    timeZone: read.optional('LIVE_TIMEZONE') ?? 'UTC',
    waitMs: waitMinutes * 60_000,
  }
}

/**
 * The settings the local target's global setup starts the server with, and checks before it does:
 * every setting of the run, its tests' included, so that a missing one stops it before the start.
 */
export function localServerSettings(env: NodeJS.ProcessEnv = process.env): {
  github: GitHubSettings
  server: LocalServerSettings
} {
  const read = new Reader(env)
  const databaseServerUrl = read.required('TEST_DATABASE_URL')
  const appId = read.required('LIVE_GITHUB_APP_ID')
  const privateKey = read.required('LIVE_GITHUB_APP_PRIVATE_KEY')
  const github = gitHubSettings(read)
  read.done('local')
  const id = Number(appId)
  if (!Number.isInteger(id) || id < 1) throw new Error('LIVE_GITHUB_APP_ID is a GitHub App id')
  return { github: github(), server: { databaseServerUrl, app: { id, privateKey } } }
}

/** The settings of a run against the server the local target's global setup started. */
export function localSettings(
  server: LocalServer,
  env: NodeJS.ProcessEnv = process.env,
): LiveSettings {
  const { github } = localServerSettings(env)
  return { ...github, ...server }
}

/** Today's date, YYYY-MM-DD, in `timeZone`. */
export function today(timeZone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone })
}

/**
 * Calls `check` until it stops throwing, every 10 seconds, for at most `timeoutMs`; then throws its
 * last error.
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
