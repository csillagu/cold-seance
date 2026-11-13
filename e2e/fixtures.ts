import { fileURLToPath } from 'node:url'
import { test as base } from '@playwright/test'
import type { Database } from '../backend/src/db/client.ts'
import { startBackend } from '../backend/src/start.ts'
import { seedAccount, storedAccount } from '../backend/test/helpers/accounts.ts'
import { createConfigFixture } from '../backend/test/helpers/config.ts'
import { createTestDatabase } from '../backend/test/helpers/database.ts'
import { fakeGitHub, type FakeGitHub } from '../backend/test/helpers/github.ts'

/** The built frontend the backend serves to the browser (SC-028). */
export const frontendDir = fileURLToPath(new URL('../frontend/dist', import.meta.url))

/** The first system admin of every test deployment, as the test cases name them. */
export const ROOT = { username: 'root', password: 'root-password' } as const

/** An account of a test deployment. */
export interface Account {
  id: string
  username: string
  password: string
}

/**
 * A fresh test deployment, as the test cases' inputs begin: an empty database with every
 * migration applied, the first system admin `root` created at start (FR-165), the default global
 * calendar of Saturday and Sunday as the weekend and no holidays, and the backend serving the
 * built frontend.
 */
export interface Deployment {
  /** Where the backend listens, such as `http://127.0.0.1:41234`. */
  url: string
  /** The deployment's database, to put in place what a test case's inputs give. */
  db: Database
  root: Account
  /**
   * The GitHub the deployment reaches repositories on when one is registered (FR-167): a fake, on
   * which a test creates the test cases' "GitHub test repository", with or without the tool's
   * GitHub App installed.
   */
  github: FakeGitHub
  /** The deployment's clock: the system clock, unless `setClock` set it. Proposals expire by it. */
  now: () => Date
  /** Sets the deployment's clock to `at`, or back to the system clock with `undefined`. */
  setClock(at: Date | undefined): void
  /**
   * Puts an account into the database, with the password given, or `<username>-password`, as the
   * test cases' "account `alice`" needs.
   */
  seedAccount(
    username: string,
    options?: { password?: string; systemAdmin?: boolean },
  ): Promise<Account>
}

export const test = base.extend<{ deployment: Deployment }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern; it has none
  deployment: async ({}, use) => {
    const database = await createTestDatabase()
    const config = createConfigFixture()
    const github = fakeGitHub()
    let clock: Date | undefined
    const now = () => clock ?? new Date()
    try {
      const backend = await startBackend({
        env: {
          COLD_SEANCE_DATABASE_URL: database.url,
          COLD_SEANCE_FIRST_ADMIN_USERNAME: ROOT.username,
          COLD_SEANCE_FIRST_ADMIN_PASSWORD: ROOT.password,
          ...config.githubEnv,
        },
        cwd: config.dir,
        frontendDir,
        server: { logger: false },
        now,
        repositoryReach: github.reach,
      })
      try {
        // Any free port, so that tests can run side by side.
        const url = await backend.app.listen({ host: '127.0.0.1', port: 0 })
        const root = await storedAccount(database.db, ROOT.username)
        if (!root) throw new Error('The first system admin was not created')
        await use({
          url,
          db: database.db,
          root: { id: root.id, username: ROOT.username, password: ROOT.password },
          github,
          now,
          setClock(at) {
            clock = at
          },
          async seedAccount(username, options = {}) {
            const password = options.password ?? `${username}-password`
            const seeded = await seedAccount(database.db, {
              username,
              password,
              systemAdmin: options.systemAdmin ?? false,
            })
            return { id: seeded.id, username, password }
          },
        })
      } finally {
        await backend.app.close()
      }
    } finally {
      await database.drop()
      config.remove()
    }
  },
  // Pages are opened relative to the test's own deployment: `page.goto('/')`.
  baseURL: async ({ deployment }, use) => {
    await use(deployment.url)
  },
})

export { expect } from '@playwright/test'
