import type { FastifyInstance, FastifyServerOptions } from 'fastify'
import { buildApp } from './app.ts'
import { loadConfig, type Config, type LoadConfigOptions } from './config/config.ts'
import { createDatabase, type Database } from './db/client.ts'
import { applyMigrations } from './db/migrate.ts'

export interface Backend {
  config: Config
  db: Database
  app: FastifyInstance
}

export interface StartOptions extends LoadConfigOptions {
  server?: FastifyServerOptions
  /** The migrations to apply; the backend's own (`backend/drizzle/`) unless given. */
  migrationsFolder?: string
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
  const app = buildApp(options.server)
  app.addHook('onClose', close)
  return { config, db, app }
}
