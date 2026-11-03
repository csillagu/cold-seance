import { Client } from 'pg'
import { testServerUrl } from '../helpers/database.ts'

/** Fails the integration run at once, with a clear message, if PostgreSQL cannot be reached. */
export default async function setup(): Promise<void> {
  try {
    const client = new Client({ connectionString: testServerUrl() })
    try {
      await client.connect()
    } finally {
      await client.end().catch(() => {})
    }
  } catch (error) {
    // Vitest 5 loses the message of an error thrown from a global setup while printing its stack,
    // so the reason is written out here before the run is stopped.
    console.error(`\nIntegration tests cannot start: ${String(error)}\n`)
    throw new Error('Integration test setup failed; see the message above.', { cause: error })
  }
}
