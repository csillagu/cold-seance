import { MILESTONE_VARIANTS, TASK_STATUSES } from '../db/schema.ts'
import { peopleOf } from './assignment.ts'
import { isDate } from './dates.ts'
import { ServiceError } from './errors.ts'
import { isUuid } from './system-admins.ts'
import type { Task } from './tasks.ts'
import { characters } from './text.ts'

/**
 * A person a filter names: someone by their account's id, or whoever is viewing the view
 * (FR-058), so that one saved view shows each viewer their own tasks.
 */
export type FilterPerson = { accountId: string } | { viewer: true }

/**
 * The task fields a filter can name (FR-057): every field a task is created or edited with, its
 * status, its actual dates, its project, its repository and its linked issue. The person-load
 * percentages are left out: they follow from the AI share and the assignment, which can be
 * filtered on.
 */
export const FILTER_FIELDS = [
  'title',
  'description',
  'status',
  'plannedStart',
  'plannedFinish',
  'actualStart',
  'actualFinish',
  'durationWorkingDays',
  'effort',
  'aiShare',
  'milestone',
  'eligibility',
  'assignees',
  'project',
  'repository',
  'githubIssue',
] as const

export type FilterField = (typeof FILTER_FIELDS)[number]

/** What a condition compares a task's field with. */
export const FILTER_OPERATORS = ['is', 'is-not', 'contains', 'at-most', 'at-least'] as const

export type FilterOperator = (typeof FILTER_OPERATORS)[number]

/**
 * One condition of a saved view's filter, on one task field (FR-057). A task is shown when it
 * meets every condition of the filter; an empty filter shows every task.
 */
export interface FilterCondition {
  field: FilterField
  operator: FilterOperator
  value: string | number | FilterPerson | null
}

type Kind = 'text' | 'status' | 'date' | 'number' | 'people' | 'id' | 'issue' | 'milestone'

/** The kind of value each field holds. */
const KIND_OF: Record<FilterField, Kind> = {
  title: 'text',
  description: 'text',
  status: 'status',
  plannedStart: 'date',
  plannedFinish: 'date',
  actualStart: 'date',
  actualFinish: 'date',
  durationWorkingDays: 'number',
  effort: 'number',
  aiShare: 'number',
  milestone: 'milestone',
  eligibility: 'people',
  assignees: 'people',
  project: 'id',
  repository: 'id',
  githubIssue: 'issue',
}

/** The operators each kind of field takes. */
const OPERATORS: Record<Kind, readonly FilterOperator[]> = {
  text: ['is', 'is-not', 'contains'],
  status: ['is', 'is-not'],
  date: ['is', 'is-not', 'at-most', 'at-least'],
  number: ['is', 'is-not', 'at-most', 'at-least'],
  people: ['contains'],
  id: ['is', 'is-not'],
  issue: ['is', 'is-not'],
  milestone: ['is', 'is-not'],
}

/** The most conditions one filter can have, so that a saved filter stays a filter. */
export const MAX_FILTER_CONDITIONS = 50

/** The longest text a condition can compare with, in characters. */
export const MAX_FILTER_TEXT_LENGTH = 1000

function invalid(message: string): ServiceError {
  return new ServiceError('invalid', message)
}

/**
 * The filter `input` holds, checked: a list of conditions, each naming a task field, an operator
 * that field takes and a value of that field's kind. Refused, as invalid, if it is anything else.
 * `null` and `undefined` are the empty filter.
 */
export function parseFilter(input: unknown): FilterCondition[] {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) throw invalid('A filter is a list of conditions')
  if (input.length > MAX_FILTER_CONDITIONS) {
    throw invalid(`A filter can have at most ${MAX_FILTER_CONDITIONS} conditions`)
  }
  return input.map((condition: unknown, index) => parseCondition(condition, index + 1))
}

function parseCondition(input: unknown, position: number): FilterCondition {
  const at = `Condition ${position} of the filter`
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw invalid(`${at} must be an object with a field, an operator and a value`)
  }
  const given = new Map<string, unknown>(Object.entries(input))
  if ([...given.keys()].some((key) => !['field', 'operator', 'value'].includes(key))) {
    throw invalid(`${at} has only a field, an operator and a value`)
  }
  const field = FILTER_FIELDS.find((known) => known === given.get('field'))
  if (field === undefined) {
    throw invalid(`${at} names a field that is not one of ${FILTER_FIELDS.join(', ')}`)
  }
  const kind = KIND_OF[field]
  const operator = OPERATORS[kind].find((known) => known === given.get('operator'))
  if (operator === undefined) {
    throw invalid(`${at}: ${field} can be compared only by ${OPERATORS[kind].join(', ')}`)
  }
  return { field, operator, value: parseValue(kind, operator, given.get('value'), at) }
}

function parseValue(
  kind: Kind,
  operator: FilterOperator,
  value: unknown,
  at: string,
): FilterCondition['value'] {
  // `is` and `is-not` with null ask whether the field is empty, for the fields that can be.
  if (value === null && (operator === 'is' || operator === 'is-not')) {
    if (kind === 'text' || kind === 'status') throw invalid(`${at} needs a value`)
    return null
  }
  if (kind === 'text') {
    if (typeof value !== 'string') throw invalid(`${at} needs a text value`)
    if (characters(value) > MAX_FILTER_TEXT_LENGTH) {
      throw invalid(`${at} can compare with at most ${MAX_FILTER_TEXT_LENGTH} characters`)
    }
    return value
  }
  if (kind === 'status') {
    const status = TASK_STATUSES.find((known) => known === value)
    if (status === undefined) {
      throw invalid(`${at} needs a status, one of ${TASK_STATUSES.join(', ')}`)
    }
    return status
  }
  if (kind === 'date') {
    if (!isDate(value)) throw invalid(`${at} needs a date, YYYY-MM-DD`)
    return value
  }
  if (kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(`${at} needs a number`)
    return value
  }
  if (kind === 'issue') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
      throw invalid(`${at} needs an issue number`)
    }
    return value
  }
  if (kind === 'id') {
    if (typeof value !== 'string' || !isUuid(value)) throw invalid(`${at} needs an id`)
    return value
  }
  if (kind === 'milestone') {
    const variant = MILESTONE_VARIANTS.find((known) => known === value)
    if (variant === undefined) {
      throw invalid(`${at} needs a milestone variant, one of ${MILESTONE_VARIANTS.join(', ')}`)
    }
    return variant
  }
  return parsePerson(value, at)
}

function parsePerson(value: unknown, at: string): FilterPerson {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const entries = Object.entries(value)
    const [entry] = entries
    if (entry !== undefined && entries.length === 1) {
      const [key, given] = entry
      if (key === 'viewer' && given === true) return { viewer: true }
      if (key === 'accountId' && typeof given === 'string' && isUuid(given)) {
        return { accountId: given }
      }
    }
  }
  throw invalid(`${at} needs a person: { "accountId": <id> } or { "viewer": true }`)
}

/** The value of the task's field, as a condition compares it. */
function fieldOf(task: Task, field: FilterField): string | number | null | readonly string[] {
  switch (field) {
    case 'eligibility':
      return peopleOf(task.eligibility)
    case 'assignees':
      return task.assignees
    case 'project':
      return task.projectId
    case 'repository':
      return task.repositoryId
    case 'githubIssue':
      return task.githubIssue?.number ?? null
    case 'milestone':
      return task.milestone?.variant ?? null
    default:
      return task[field]
  }
}

/**
 * Whether the task meets every condition of the filter, for the person `viewerId` viewing it: a
 * condition on the person viewing compares with them (FR-058). An empty field meets no `contains`,
 * `at-most` or `at-least`.
 */
export function matchesFilter(
  task: Task,
  filter: readonly FilterCondition[],
  viewerId: string,
): boolean {
  return filter.every((condition) => meets(fieldOf(task, condition.field), condition, viewerId))
}

function meets(
  actual: string | number | null | readonly string[],
  { operator, value }: FilterCondition,
  viewerId: string,
): boolean {
  if (typeof actual === 'object' && actual !== null) {
    // The people fields, which take only `contains` with a person.
    if (typeof value !== 'object' || value === null) return false
    return actual.includes('viewer' in value ? viewerId : value.accountId)
  }
  if (operator === 'is') return actual === value
  if (operator === 'is-not') return actual !== value
  if (operator === 'contains') {
    return (
      typeof actual === 'string' &&
      typeof value === 'string' &&
      actual.toLocaleLowerCase().includes(value.toLocaleLowerCase())
    )
  }
  const order = compare(actual, value)
  if (order === undefined) return false
  return operator === 'at-most' ? order <= 0 : order >= 0
}

/** How `actual` orders against `value`, if both are numbers or both are dates. */
function compare(actual: unknown, value: unknown): number | undefined {
  if (typeof actual === 'number' && typeof value === 'number') return actual - value
  if (typeof actual === 'string' && typeof value === 'string') {
    // Dates, `YYYY-MM-DD`, order as text.
    return actual < value ? -1 : actual > value ? 1 : 0
  }
  return undefined
}
