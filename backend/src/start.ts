import type { FastifyInstance, FastifyServerOptions } from 'fastify'
import { sessionAuthenticator } from './api/session-auth.ts'
import { tokenAuthenticator } from './api/token-auth.ts'
import { buildApp } from './app.ts'
import { loadConfig, type Config, type LoadConfigOptions } from './config/config.ts'
import { createDatabase, type Database } from './db/client.ts'
import { applyMigrations } from './db/migrate.ts'
import { defaultFrontendDir, hasFrontend } from './frontend.ts'
import { createGitHubClient, type GitHubClient } from './github/client.ts'
import { GitHubPlanningMirror } from './github/planning-mirror.ts'
import { gitHubRepositoryReach } from './github/repository-reach.ts'
import { setUpFirstAdmin } from './service/first-admin.ts'
import { createServices } from './service/services.ts'

export interface Backend {
  config: Config
  db: Database
  app: FastifyInstance
}

export interface StartOptions extends LoadConfigOptions {
  server?: FastifyServerOptions
  /** The migrations to apply; the backend's own (`backend/drizzle/`) unless given. */
  migrationsFolder?: string
  /** The built frontend to serve; `frontend/dist/` unless given (SC-028). */
  frontendDir?: string
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
  const github = () =>
    (client ??= createGitHubClient(config.github, {
      // Every system admin is notified of a token GitHub refuses (FR-186, SC-012).
      onTokenRefused: (refusal) =>
        services.notifications.notifyTokenRefused(refusal.function).catch((error: unknown) => {
          app?.log.error(
            { err: error },
            'The system admins could not be notified: ' + refusal.message,
          )
        }),
    }))
  // The mirror's failures are logged; the re-check puts them right (SC-022, DD-051). The app's log
  // is there by the time the mirror first runs, after a request has changed a task.
  let app: FastifyInstance | undefined
  const planningMirror = new GitHubPlanningMirror(db, github, {
    onError: (error, taskId) =>
      app?.log.error({ err: error, taskId }, "A task's planning could not be mirrored to GitHub"),
  })
  const services = createServices(db, {
    github: gitHubRepositoryReach(github),
    planningChanges: planningMirror,
  })
  app = buildApp(
    options.server,
    // Each channel's own way of saying who makes a request: the API tokens (SC-055) and the
    // browser's session cookie (SC-107). A token is asked first, so a token that does not work is
    // refused even beside a live session's cookie.
    {
      services,
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
  // What the mirror is doing is finished before the database pool closes.
  app.addHook('onClose', () => planningMirror.idle())
  app.addHook('onClose', close)
  return { config, db, app }
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
