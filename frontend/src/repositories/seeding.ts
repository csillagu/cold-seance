import { ApiError } from '../api.ts'

/** What `POST /api/projects/<id>/seeding` answers once the import has succeeded (SC-025). */
export interface SeedingResult {
  projectId: string
  /** The tasks created, one for each issue brought in. */
  imported: { taskId: string; repositoryId: string; issueNumber: number }[]
  /** The issues left out, with why. */
  skipped: { repositoryId: string; issueNumber: number; reason: string }[]
}

/** `count` of `one`, as `1 task` or `3 tasks`. */
function counted(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? '' : 's'}`
}

/** What the seeding screen says of an import that succeeded as a whole (FR-102, FR-137). */
export function seededOutcome(result: SeedingResult): string {
  const imported = `${counted(result.imported.length, 'task')} imported`
  const skipped =
    result.skipped.length === 0 ? '' : `, ${counted(result.skipped.length, 'issue')} skipped`
  return `The seeding succeeded: ${imported}${skipped}.`
}

const NOTHING_IMPORTED = 'Nothing was imported.'

/**
 * What the seeding screen says of an import that failed: the REST API's own words for why, which
 * it gives for a refusal and for GitHub not being readable (503), and then that the import failed
 * as a whole and brought nothing in (FR-137), unless the API's words say so already.
 */
export function failedOutcome(error: unknown): string {
  const reason =
    error instanceof ApiError && error.error !== undefined && error.status !== 500
      ? error.message
      : 'The seeding failed.'
  if (reason.includes(NOTHING_IMPORTED)) return reason
  return `${/[.!?]$/.test(reason) ? reason : `${reason}.`} ${NOTHING_IMPORTED}`
}
