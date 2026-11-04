import { ServiceError } from './errors.ts'
import { isUuid } from './system-admins.ts'

/**
 * The person-load percentage rules of the service layer (DD-039, SC-039). A task's person load is
 * a percentage that applies to each person assigned to it over the task's whole duration (DD-009).
 *
 * - By default it is 100% minus the task's AI share: 100% for a normal task, 50% for a 50% AI
 *   task (FR-032). A task with no AI share given is a normal task, at 100%. AI work lowers the
 *   percentage, never the duration.
 * - An AI-only task, one whose AI share is 100%, can be given any person-load percentage instead,
 *   including 0%, fractions of a percent and values above 100% (FR-149). Until one is given it is
 *   the default, 0%. The 1% the UI offers is offered by the UI (SC-100).
 * - One assignment can override the task's percentage for that person alone (DD-010, FR-033).
 * - A milestone takes no time (FR-191), so it has no person load.
 */

/** The AI share of an AI-only task: all of it (FR-149). */
export const AI_ONLY_SHARE = 100

/** The person-load percentages that single assignments override, by assignee's account id. */
export type LoadOverrides = Record<string, number>

/** What a task's own person-load percentage is worked out from. */
export interface LoadSource {
  /** The task's AI share, a percentage, or `null` when not given. */
  aiShare: number | null
  /** The person-load percentage given to an AI-only task, or `null` when none was (FR-149). */
  aiOnlyLoad: number | null
  /** Whether the task is a milestone, which takes no time (FR-191). */
  milestone: boolean
}

/**
 * The task's person-load percentage: the one given to an AI-only task, if any (FR-149), or else
 * 100% minus its AI share (FR-032); `null` for a milestone.
 */
export function taskPersonLoad({ aiShare, aiOnlyLoad, milestone }: LoadSource): number | null {
  if (milestone) return null
  if (aiShare === AI_ONLY_SHARE && aiOnlyLoad !== null) return aiOnlyLoad
  return 100 - (aiShare ?? 0)
}

/**
 * The person-load percentage the task puts on `person`: their assignment's override if it has one
 * (FR-033), the task's own otherwise; `null` if they are not assigned to it, or it is a milestone.
 */
export function assignmentLoad(
  task: { personLoad: number | null; assignees: readonly string[]; loadOverrides: LoadOverrides },
  person: string,
): number | null {
  if (task.personLoad === null || !task.assignees.includes(person)) return null
  return task.loadOverrides[person] ?? task.personLoad
}

/**
 * The person-load percentage given to a task, checked against its AI share once the change is
 * applied: `null` clears it, back to the default; a number is taken only for an AI-only task, and
 * then any number of zero or more, unrounded (FR-149). Any other task's percentage is 100% minus
 * its AI share and cannot be given (FR-032).
 */
export function validAiOnlyLoad(value: unknown, aiShare: number | null): number | null {
  if (value === null) return null
  const load = percentage(value, "A task's person-load percentage")
  if (aiShare !== AI_ONLY_SHARE) {
    throw invalid(
      "A task's person-load percentage is 100% minus its AI share; it can be set only for an " +
        'AI-only task, one whose AI share is 100%',
    )
  }
  return load
}

/**
 * The overrides `value` gives for the task's assignees (FR-033): an object from assignee's
 * account id to the percentage that replaces the task's for that person, a number of zero or more;
 * an empty object for none. Each person must be one of `assignees`. The ids are put in lower case,
 * the form ids are given out in, and the entries in the order of their ids, the order they are
 * read back in, so that two equal sets of overrides compare equal.
 */
export function validLoadOverrides(value: unknown, assignees: readonly string[]): LoadOverrides {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(
      'The person-load overrides are an object from assignee, by account id, to a percentage',
    )
  }
  const overrides: LoadOverrides = {}
  for (const [key, load] of Object.entries(value)) {
    if (!isUuid(key)) throw invalid('A person is named by their account id')
    const person = key.toLowerCase()
    if (person in overrides) throw invalid('A person-load override is given once per assignee')
    if (!assignees.includes(person)) {
      throw invalid(
        `The person ${person} is not assigned to the task, so their load cannot be overridden`,
      )
    }
    overrides[person] = percentage(load, 'A person-load override')
  }
  return sorted(overrides)
}

/**
 * The overrides of those of `assignees` who have one: what is kept of a task's overrides when its
 * assignees change and no overrides are given. Someone no longer assigned loses theirs.
 */
export function keptLoadOverrides(
  overrides: LoadOverrides,
  assignees: readonly string[],
): LoadOverrides {
  return sorted(
    Object.fromEntries(Object.entries(overrides).filter(([person]) => assignees.includes(person))),
  )
}

/** The overrides with their entries in the order of their ids. */
export function sorted(overrides: LoadOverrides): LoadOverrides {
  return Object.fromEntries(
    // Each id is there once, so no two compare equal.
    Object.entries(overrides).sort(([a], [b]) => (a < b ? -1 : 1)),
  )
}

function percentage(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw invalid(`${what} is a percentage of zero or more`)
  }
  return value
}

function invalid(message: string): ServiceError {
  return new ServiceError('invalid', message)
}
