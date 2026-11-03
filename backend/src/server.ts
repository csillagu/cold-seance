import { ConfigError } from './config/config.ts'
import { MigrationError } from './db/migrate.ts'
import { startBackend } from './start.ts'

let backend
try {
  backend = await startBackend({ server: { logger: true } })
} catch (error) {
  if (!(error instanceof ConfigError || error instanceof MigrationError)) throw error
  console.error(error.message)
  process.exit(1)
}

// The listen address is not a setting named so far (DD-059), so the server keeps listening on
// localhost:3000 until a solution component names one.
await backend.app.listen({ host: '127.0.0.1', port: 3000 })
