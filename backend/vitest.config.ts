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
          provide: { liveTarget: 'deployment' },
          // One file at a time: a project that pulls from the test repository takes each new
          // issue in as its own task (FR-100), so a file's projects would take another's issues.
          fileParallelism: false,
          testTimeout: 20 * 60_000,
          hookTimeout: 5 * 60_000,
        },
      },
      {
        extends: true,
        test: {
          // The same live tests against a backend the run starts itself (SC-128, DD-063), with
          // npm run test:live:local, and by CI on each pull request (SC-129). No webhook reaches
          // that backend: a change made on GitHub, and a new issue opened there (FR-214), reach it
          // at its re-check.
          name: 'live-local',
          include: ['test/live/**/*.test.ts'],
          globalSetup: ['test/live/local-server.ts'],
          provide: { liveTarget: 'local' },
          fileParallelism: false,
          testTimeout: 20 * 60_000,
          hookTimeout: 5 * 60_000,
        },
      },
    ],
  },
})
