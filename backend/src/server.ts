import { ConfigError } from './config/config.ts'
import { MigrationError } from './db/migrate.ts'
import { FirstAdminError } from './service/first-admin.ts'
import { closeOnSignals, listen, startBackend } from './start.ts'

// Until the backend is up, a stop (docker stop sends SIGTERM) ends the start at once: as the
// container's first process, Node would otherwise ignore it. A migration cut short this way is
// rolled back with its transaction.
const stopStart = (signal: NodeJS.Signals) => {
  console.error(`${signal} received while starting; the tool does not start`)
  process.exit(1)
}
process.once('SIGTERM', stopStart)
process.once('SIGINT', stopStart)

let backend
try {
  backend = await startBackend({ server: { logger: true } })
} catch (error) {
  if (!(
    error instanceof ConfigError ||
    error instanceof MigrationError ||
    error instanceof FirstAdminError
  )) {
    throw error
  }
  console.error(error.message)
  process.exit(1)
}

process.off('SIGTERM', stopStart)
process.off('SIGINT', stopStart)
closeOnSignals(backend.app)
try {
  await listen(backend)
} catch (error) {
  const { host, port } = backend.config.server
  const reason = error instanceof Error && 'code' in error ? String(error.code) : String(error)
  console.error(
    `The backend cannot listen on ${host}:${port}, so the tool does not start: ${reason}`,
  )
  await backend.app.close()
  process.exit(1)
}
