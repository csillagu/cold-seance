import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'
import { startBackend, type Backend } from '../../src/start.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { localServerSettings } from './settings.ts'

/** The re-check interval of the started server, in minutes: there is no webhook to wait for. */
const RECHECK_MINUTES = 1

/**
 * The global setup of `npm run test:live:local` (SC-128, DD-063): starts the tool's backend in this
 * process, on a fresh database on `TEST_DATABASE_URL`'s server, with the GitHub App and the classic
 * Projects token of the test deployment, and gives the tests its address and its first system
 * admin. No webhook reaches it, so a change made on GitHub reaches it at its re-check, every
 * minute. A setting that is missing stops the run before the server starts, naming it.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  let database: TestDatabase | undefined
  let keyDir: string | undefined
  let backend: Backend | undefined
  const stop = async () => {
    await backend?.app.close()
    await database?.drop()
    if (keyDir) await rm(keyDir, { recursive: true, force: true })
  }
  try {
    const { github, server } = localServerSettings()
    database = await createTestDatabase({ migrate: false })
    // The tool reads the App's private key from a file; the setting holds its contents.
    keyDir = await mkdtemp(join(tmpdir(), 'cold-seance-live-'))
    const keyFile = join(keyDir, 'github-app.pem')
    await writeFile(keyFile, server.app.privateKey + '\n', { mode: 0o600 })
    const admin = { username: 'root', password: randomBytes(24).toString('base64url') }
    const app = { APP_ID: String(server.app.id), PRIVATE_KEY_FILE: keyFile }
    const env: Record<string, string> = {
      COLD_SEANCE_DATABASE_URL: database.url,
      ...Object.fromEntries(
        ['READ_ISSUES', 'WRITE_ISSUES'].flatMap((fn) =>
          Object.entries(app).map(([name, value]) => [
            `COLD_SEANCE_GITHUB_APPS_${fn}_${name}`,
            value,
          ]),
        ),
      ),
      COLD_SEANCE_GITHUB_TOKENS_PROJECTS_STATUS: github.projectsToken,
      COLD_SEANCE_GITHUB_RECHECK_INTERVAL_MINUTES: String(RECHECK_MINUTES),
      COLD_SEANCE_GITHUB_STATUS_FIELD_NAME: github.statusField.name,
      COLD_SEANCE_GITHUB_STATUS_FIELD_STARTED: github.statusField.started,
      COLD_SEANCE_GITHUB_STATUS_FIELD_ON_HOLD: github.statusField.onHold,
      COLD_SEANCE_FIRST_ADMIN_USERNAME: admin.username,
      COLD_SEANCE_FIRST_ADMIN_PASSWORD: admin.password,
    }
    // Only these settings: no configuration file is read, and no COLD_SEANCE_ variable of the
    // machine's own reaches the server.
    backend = await startBackend({ env, cwd: keyDir, server: { logger: { level: 'warn' } } })
    const url = await backend.app.listen({ host: '127.0.0.1', port: 0 })
    project.provide('liveServer', {
      url,
      admin,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      // Three re-checks: a change made on GitHub reaches the server only at one.
      waitMs: 3 * RECHECK_MINUTES * 60_000,
    })
    return stop
  } catch (error) {
    await stop().catch(() => {})
    // Vitest 5 loses the message of an error thrown from a global setup while printing its stack,
    // so the reason is written out here before the run is stopped.
    console.error(`\nThe live suite cannot start its server: ${String(error)}\n`)
    throw new Error('The live suite could not start; see the message above.', { cause: error })
  }
}
