import { existsSync } from 'node:fs'
import checkDatabase from '../backend/test/integration/global-setup.ts'
import { frontendDir } from './fixtures.ts'

/**
 * Fails the run at once, with a clear message, if PostgreSQL cannot be reached or the frontend has
 * not been built: every test needs both.
 */
export default async function setup(): Promise<void> {
  await checkDatabase()
  if (!existsSync(`${frontendDir}/index.html`)) {
    throw new Error(
      `No built frontend in ${frontendDir}. Build it with \`npm run build -w frontend\`, or run ` +
        'the tests with `npm run test:e2e`, which builds it first.',
    )
  }
}
