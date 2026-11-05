import { defineConfig, devices } from '@playwright/test'

// The browser tests (node P01 of the work graph): the browser steps of the test cases, run
// against the real backend serving the built frontend, each test on a fresh test deployment of
// its own (see fixtures.ts). `npm run test:e2e` builds the frontend first.
export default defineConfig({
  testDir: 'tests',
  globalSetup: './global-setup.ts',
  // Every test has its own database and backend, so tests run in parallel, within files too.
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
