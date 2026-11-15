import type { FastifyInstance, FastifyServerOptions } from 'fastify'
import { sessionAuthenticator } from './api/session-auth.ts'
import { tokenAuthenticator } from './api/token-auth.ts'
import { buildApp } from './app.ts'
import { loadConfig, type Config, type LoadConfigOptions } from './config/config.ts'
import { createDatabase, type Database } from './db/client.ts'
import { applyMigrations } from './db/migrate.ts'
import { defaultFrontendDir, hasFrontend } from './frontend.ts'
import { GitHubChangeHandler } from './github/change-handler.ts'
import { createGitHubClient, type GitHubClient } from './github/client.ts'
import { GitHubPlanningMirror } from './github/planning-mirror.ts'
import { recheckLinkedIssues } from './github/recheck.ts'
import { RecheckTimer } from './github/recheck-timer.ts'
import { gitHubRepositoryReach, type RepositoryReach } from './github/repository-reach.ts'
import { GitHubRevertCommenter } from './github/revert-commenter.ts'
import { gitHubSeedingSource } from './github/seeding-source.ts'
import { GitHubWebhookReceiver } from './github/webhooks.ts'
import { setUpFirstAdmin } from './service/first-admin.ts'
import { createServices } from './service/services.ts'

export interface Backend {
  config: Config
  db: Database
  app: FastifyInstance
  /** The re-check timer (SC-024), started once the application is ready unless told otherwise. */
  recheck: RecheckTimer
}

export interface StartOptions extends LoadConfigOptions {
  server?: FastifyServerOptions
  /** The migrations to apply; the backend's own (`backend/drizzle/`) unless given. */
  migrationsFolder?: string
  /** The built frontend to serve; `frontend/dist/` unless given (SC-028). */
  frontendDir?: string
  /**
   * The current time; the system clock unless given. Proposals expire by it (SC-046), so that a
   * test deployment can set its clock forward, as TC-115 and TC-116 need.
   */
  now?: () => Date
  /**
   * How the repository registry asks whether the tool reaches a repository on GitHub (SC-019);
   * GitHub itself, through the GitHub client, unless given, so that a test deployment can answer
   * from a fake GitHub, as the browser tests of FR-167 need.
   */
  repositoryReach?: RepositoryReach
  /**
   * The GitHub client the planning mirror and the repository registry call (SC-106); built from
   * the configuration unless given, so that a test deployment can call a fake GitHub instead, as
   * the browser tests that assign a task to a repository need (SC-098, TC-208).
   */
  githubClient?: () => GitHubClient
  /**
   * Whether the re-check timer runs (SC-024); it does unless told otherwise, so that a test
   * deployment can run the re-check itself, through `Backend.recheck`, when its test case says.
   */
  recheckTimer?: boolean
}

/**
 * Prepares the backend from its configuration: loads the settings (SC-109), which throws a
 * `ConfigError` naming each missing or invalid one; applies the pending migrations over the direct
 * connection (SC-074, DD-057), which throws a `MigrationError` if one fails; and only then opens
 * the database given in the settings (FR-177), creates the first system admin the settings name while there is none
 * (SC-053), which throws a `FirstAdminError` if it cannot, and builds the HTTP application. The caller starts
 * listening once this resolves, so no request is served before the schema is up to date. Closing
 * the application closes the database pool.
 */
export async function startBackend(options: StartOptions = {}): Promise<Backend> {
  const config = loadConfig(options)
  await applyMigrations(config.database.directUrl, options.migrationsFolder)
  const { db, close } = createDatabase(config.database.url)
  let firstAdmin
  if (config.firstAdmin !== undefined) {
    try {
      firstAdmin = await setUpFirstAdmin(db, config.firstAdmin)
    } catch (error) {
      await close()
      throw error
    }
  }
  const frontendDir = options.frontendDir ?? defaultFrontendDir
  const servesFrontend = hasFrontend(frontendDir)
  // The GitHub client is built when the tool first asks GitHub something (SC-106, SC-019), once
  // for the registry and the planning mirror together.
  let client: GitHubClient | undefined
  const github =
    options.githubClient ??
    (() =>
      (client ??= createGitHubClient(config.github, {
        // Every system admin is notified of a token GitHub refuses (FR-186, SC-012).
        onTokenRefused: (refusal) =>
          services.notifications.notifyTokenRefused(refusal.function).catch((error: unknown) => {
            app?.log.error(
              { err: error },
              'The system admins could not be notified: ' + refusal.message,
            )
          }),
      })))
  // The mirror's failures are logged; the re-check puts them right (SC-022, DD-051). The app's log
  // is there by the time the mirror first runs, after a request has changed a task.
  let app: FastifyInstance | undefined
  // Each change reverted on GitHub is explained on its issue, and its subscribers notified
  // (SC-062); what fails is logged.
  const reverts = new GitHubRevertCommenter(db, github, {
    onError: (error, revert) =>
      app?.log.error({ err: error, revert }, 'A revert on GitHub could not be reported'),
  })
  const planningMirror = new GitHubPlanningMirror(db, github, {
    onError: (error, taskId) =>
      app?.log.error({ err: error, taskId }, "A task's planning could not be mirrored to GitHub"),
    reverts,
  })
  const services = createServices(db, {
    github: options.repositoryReach ?? gitHubRepositoryReach(github),
    planningChanges: planningMirror,
    seeding: gitHubSeedingSource(github, { statusField: config.github.statusField }),
    ...(options.now ? { now: options.now } : {}),
  })
  // Changes made on GitHub reach the change handler (SC-023) by the webhook endpoint (SC-105) and
  // the re-check (SC-024); what either fails to take in is logged, for the next re-check.
  const changeHandler = new GitHubChangeHandler(db, github, planningMirror, services, {
    statusField: config.github.statusField,
    reverts,
  })
  const webhooks = new GitHubWebhookReceiver(db, config.github, changeHandler, github, {
    onError: (error, event) =>
      app?.log.error({ err: error, event }, 'A GitHub webhook delivery could not be taken in'),
  })
  const recheck = new RecheckTimer(
    db,
    recheckLinkedIssues(
      db,
      { handler: changeHandler, mirror: planningMirror },
      {
        onError: (error, issue) =>
          app?.log.error({ err: error, issue }, 'The re-check could not take in a linked issue'),
      },
    ),
    {
      intervalMinutes: config.github.recheckIntervalMinutes,
      ...(options.now ? { now: options.now } : {}),
      onError: (error) => app?.log.error({ err: error }, 'The re-check failed'),
    },
  )
  app = buildApp(
    options.server,
    // Each channel's own way of saying who makes a request: the API tokens (SC-055) and the
    // browser's session cookie (SC-107). A token is asked first, so a token that does not work is
    // refused even beside a live session's cookie.
    {
      services,
      webhooks,
      authenticators: [
        tokenAuthenticator(services.apiTokens),
        sessionAuthenticator(services.sessions),
      ],
    },
    servesFrontend ? { frontendDir } : {},
  )
  // Running from the repository without building the frontend is normal in development, where
  // Vite serves it; in the Docker image the frontend is always there.
  if (!servesFrontend) app.log.warn(`No built frontend in ${frontendDir}; only the API is served`)
  if (firstAdmin === 'created') app.log.info('The first system admin was created')
  // The re-check runs at once on start if it is due (DD-051), and at each interval after.
  if (options.recheckTimer !== false) app.addHook('onReady', async () => recheck.start())
  // What the re-check, the webhooks and the mirror are doing is finished before the pool closes.
  app.addHook('onClose', async () => {
    await recheck.stop()
    await webhooks.idle()
    await planningMirror.idle()
  })
  app.addHook('onClose', close)
  return { config, db, app, recheck }
}

/** Starts listening on the address in the settings (`server.host`, `server.port`). */
export function listen(backend: Backend): Promise<string> {
  const { host, port } = backend.config.server
  return backend.app.listen({ host, port })
}

/**
 * Closes the backend, its database pool included, on the first of `signals`, so that a container
 * stopped by Docker (SIGTERM) ends cleanly instead of being killed when its grace period runs out.
 * The process then exits by itself, once nothing is left open.
 */
export function closeOnSignals(
  app: FastifyInstance,
  signals: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'],
  target: NodeJS.EventEmitter = process,
): void {
  const onSignal = (signal: NodeJS.Signals) => {
    for (const s of signals) target.off(s, onSignal)
    app.log.info(`${signal} received; closing`)
    app.close().catch((error: unknown) => {
      app.log.error(error, 'The backend could not be closed cleanly')
      process.exitCode = 1
    })
  }
  for (const s of signals) target.on(s, onSignal)
}
