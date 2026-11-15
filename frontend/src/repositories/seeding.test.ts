import { describe, expect, it } from 'vitest'
import { ApiError } from '../api.ts'
import { failedOutcome, seededOutcome } from './seeding.ts'

const REPO = '00000000-0000-4000-8000-000000000002'
const task = (n: number) => ({ taskId: `t${n}`, repositoryId: REPO, issueNumber: n })

describe('seededOutcome', () => {
  it('says how many tasks were imported', () => {
    expect(seededOutcome({ projectId: 'p', imported: [task(1)], skipped: [] })).toBe(
      'The seeding succeeded: 1 task imported.',
    )
    expect(
      seededOutcome({ projectId: 'p', imported: [task(1), task(2), task(3)], skipped: [] }),
    ).toBe('The seeding succeeded: 3 tasks imported.')
  })

  it('says how many issues were skipped, if any', () => {
    expect(
      seededOutcome({
        projectId: 'p',
        imported: [],
        skipped: [{ repositoryId: REPO, issueNumber: 1, reason: 'already-in-project' }],
      }),
    ).toBe('The seeding succeeded: 0 tasks imported, 1 issue skipped.')
  })
})

describe('failedOutcome', () => {
  it("keeps the API's words when they say nothing was imported", () => {
    const message = 'The seeding failed: GitHub could not be read. Nothing was imported.'
    expect(
      failedOutcome(new ApiError(503, { statusCode: 503, error: 'Service Unavailable', message })),
    ).toBe(message)
  })

  it("adds that nothing was imported to the API's words for a refusal (FR-137)", () => {
    expect(
      failedOutcome(
        new ApiError(409, {
          error: 'Conflict',
          message: 'The tool cannot reach csillagu/tc-closed on GitHub',
        }),
      ),
    ).toBe('The tool cannot reach csillagu/tc-closed on GitHub. Nothing was imported.')
  })

  it('says the seeding failed for an answer that is not the API’s', () => {
    expect(failedOutcome(new ApiError(502, undefined))).toBe(
      'The seeding failed. Nothing was imported.',
    )
    expect(failedOutcome(new TypeError('Failed to fetch'))).toBe(
      'The seeding failed. Nothing was imported.',
    )
  })
})
