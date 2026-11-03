import type { FastifyInstance, FastifyServerOptions } from 'fastify'
import { buildApp } from './app.ts'
import { loadConfig, type Config, type LoadConfigOptions } from './config/config.ts'
import { createDatabase, type Database } from './db/client.ts'

export interface Backend {
  config: Config
  db: Database
  app: FastifyInstance
}

/**
 * Prepares the backend from its configuration (SC-109): loads the settings, which throws a
 * `ConfigError` naming each missing or invalid one, opens the database given in them (FR-177)
 * and builds the HTTP application. Closing the application closes the database pool.
 */
export function startBackend(
  options: LoadConfigOptions & { server?: FastifyServerOptions } = {},
): Backend {
  const config = loadConfig(options)
  const { db, close } = createDatabase(config.database.url)
  const app = buildApp(options.server)
  app.addHook('onClose', close)
  return { config, db, app }
}
