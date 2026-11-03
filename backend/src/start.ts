import type { FastifyInstance, FastifyServerOptions } from 'fastify'
import { buildApp } from './app.ts'
import { loadConfig, type Config, type LoadConfigOptions } from './config/config.ts'
import { createDatabase, type Database } from './db/client.ts'
import { applyMigrations } from './db/migrate.ts'
import { defaultFrontendDir, hasFrontend } from './frontend.ts'

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
 * the database given in the settings (FR-177) and builds the HTTP application. The caller starts
 * listening once this resolves, so no request is served before the schema is up to date. Closing
 * the application closes the database pool.
 */
export async function startBackend(options: StartOptions = {}): Promise<Backend> {
  const config = loadConfig(options)
  await applyMigrations(config.database.directUrl, options.migrationsFolder)
  const { db, close } = createDatabase(config.database.url)
  const frontendDir = options.frontendDir ?? defaultFrontendDir
  const servesFrontend = hasFrontend(frontendDir)
  const app = buildApp(options.server, {}, servesFrontend ? { frontendDir } : {})
  // Running from the repository without building the frontend is normal in development, where
  // Vite serves it; in the Docker image the frontend is always there.
  if (!servesFrontend) app.log.warn(`No built frontend in ${frontendDir}; only the API is served`)
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
