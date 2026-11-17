import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'scripts/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
      reporter: ['text', 'html', 'json-summary'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'image',
          include: ['test/image/**/*.test.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          testTimeout: 90_000,
          hookTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'windows',
          include: ['test/windows/**/*.test.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          testTimeout: 180_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          // The live GitHub tests (SC-126): against the test deployment and a real repository, run
          // on demand only, with npm run test:live, never by CI on a pull request.
          name: 'live',
          include: ['test/live/**/*.test.ts'],
          testTimeout: 20 * 60_000,
          hookTimeout: 5 * 60_000,
        },
      },
    ],
  },
})
