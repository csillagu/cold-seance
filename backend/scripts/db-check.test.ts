import { afterEach, expect, it, vi } from 'vitest'

vi.mock('./schema-drift.ts', () => ({ main: vi.fn<() => Promise<number>>(async () => 1) }))

afterEach(() => {
  process.exitCode = undefined
})

it("exits with the check's result, so a schema change without its migration fails the run", async () => {
  await import('./db-check.ts')
  expect(process.exitCode).toBe(1)
})
