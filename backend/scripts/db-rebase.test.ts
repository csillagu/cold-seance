import { afterEach, expect, it, vi } from 'vitest'

vi.mock('./migration-rebase.ts', () => ({
  BACKEND_REBASE: {},
  rebaseMigrations: vi.fn<() => Promise<number>>(async () => 1),
}))

afterEach(() => {
  process.exitCode = undefined
})

it("exits with the rebase's result, so a rebase that stopped on a conflict fails the run", async () => {
  await import('./db-rebase.ts')
  expect(process.exitCode).toBe(1)
})
