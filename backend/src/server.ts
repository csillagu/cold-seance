import { ConfigError } from './config/config.ts'
import { MigrationError } from './db/migrate.ts'
import { closeOnSignals, listen, startBackend } from './start.ts'

let backend
try {
  backend = await startBackend({ server: { logger: true } })
} catch (error) {
  if (!(error instanceof ConfigError || error instanceof MigrationError)) throw error
  console.error(error.message)
  process.exit(1)
}

closeOnSignals(backend.app)
await listen(backend)
