/**
 * A saved view's filter as the filter builder (SC-092) edits it and the REST API takes it: a list
 * of conditions, each on one task field (FR-057), which a task must all meet to be shown. A
 * condition on a person can name the person viewing the view (FR-058), as in "MY kanban".
 *
 * The fields, their kinds and the operators each kind takes are the REST API's
 * (`backend/src/service/saved-view-filter.ts`); the builder offers only what the API accepts.
 */

/** A person a condition names: someone by their account's id, or whoever is viewing the view. */
export type FilterPerson = { accountId: string } | { viewer: true }

/** A condition as the REST API takes and gives it. */
export interface FilterCondition {
  field: FilterField
  operator: FilterOperator
  value: string | number | FilterPerson | null
}

export type FilterOperator = 'is' | 'is-not' | 'contains' | 'at-most' | 'at-least'

/** The kind of value a field holds, which decides how the builder asks for it. */
export type FieldKind =
  | 'text'
  | 'status'
  | 'date'
  | 'number'
  | 'people'
  | 'project'
  | 'repository'
  | 'issue'
  | 'milestone'

/** The task fields a filter can name, with their labels and kinds, in the order offered. */
export const FIELDS = [
  { field: 'title', label: 'Title', kind: 'text' },
  { field: 'description', label: 'Description', kind: 'text' },
  { field: 'status', label: 'Status', kind: 'status' },
  { field: 'plannedStart', label: 'Planned start', kind: 'date' },
  { field: 'plannedFinish', label: 'Planned finish', kind: 'date' },
  { field: 'actualStart', label: 'Actual start', kind: 'date' },
  { field: 'actualFinish', label: 'Actual finish', kind: 'date' },
  { field: 'durationWorkingDays', label: 'Duration (working days)', kind: 'number' },
  { field: 'effort', label: 'Effort', kind: 'number' },
  { field: 'aiShare', label: 'AI share (%)', kind: 'number' },
  { field: 'milestone', label: 'Milestone', kind: 'milestone' },
  { field: 'eligibility', label: 'Eligibility', kind: 'people' },
  { field: 'assignees', label: 'Assigned people', kind: 'people' },
  { field: 'project', label: 'Project', kind: 'project' },
  { field: 'repository', label: 'Repository', kind: 'repository' },
  { field: 'githubIssue', label: 'GitHub issue number', kind: 'issue' },
] as const satisfies readonly { field: string; label: string; kind: FieldKind }[]

export type FilterField = (typeof FIELDS)[number]['field']

/**
 * What the builder offers to compare a field by: the API's operators, and, for the fields that can
 * be empty, whether they are. `empty` and `not-empty` are sent as `is` and `is-not` with `null`.
 */
export type Comparison = FilterOperator | 'empty' | 'not-empty'

const COMPARISON_LABELS: Record<Comparison, string> = {
  is: 'is',
  'is-not': 'is not',
  contains: 'contains',
  'at-most': 'is at most',
  'at-least': 'is at least',
  empty: 'is empty',
  'not-empty': 'is not empty',
}

/** The comparisons each kind of field takes, the first being the one a new condition starts with. */
const COMPARISONS: Record<FieldKind, readonly Comparison[]> = {
  text: ['contains', 'is', 'is-not'],
  status: ['is', 'is-not'],
  date: ['is', 'is-not', 'at-most', 'at-least', 'empty', 'not-empty'],
  number: ['is', 'is-not', 'at-most', 'at-least', 'empty', 'not-empty'],
  people: ['contains'],
  project: ['is', 'is-not'],
  repository: ['is', 'is-not', 'empty', 'not-empty'],
  issue: ['is', 'is-not', 'empty', 'not-empty'],
  milestone: ['is', 'is-not', 'empty', 'not-empty'],
}

/** The task statuses, with their names as the Kanban heads its columns. */
export const STATUSES = [
  { value: 'not-started', label: 'Not started' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'on-hold', label: 'On hold' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

/** The milestone variants. */
export const MILESTONE_VARIANTS = [
  { value: 'fixed-date', label: 'Fixed date' },
  { value: 'floating', label: 'Floating' },
] as const

/** The value of a people condition that names the person viewing the view. */
export const VIEWER = 'viewer'

/**
 * A condition as the builder holds it while it is edited: the value as its input gives it, as
 * text. A people condition's value is an account's id, or `VIEWER`.
 */
export interface DraftCondition {
  field: FilterField
  comparison: Comparison
  value: string
}

export function kindOf(field: FilterField): FieldKind {
  return FIELDS.find((known) => known.field === field)?.kind ?? 'text'
}

export function labelOf(field: FilterField): string {
  return FIELDS.find((known) => known.field === field)?.label ?? field
}

/** The comparisons offered for `field`, with their labels. */
export function comparisonsOf(field: FilterField): { value: Comparison; label: string }[] {
  return COMPARISONS[kindOf(field)].map((value) => ({ value, label: COMPARISON_LABELS[value] }))
}

/** Whether the comparison needs a value; asking whether a field is empty needs none. */
export function needsValue(comparison: Comparison): boolean {
  return comparison !== 'empty' && comparison !== 'not-empty'
}

/** A new condition on `field`, with its first comparison and no value yet. */
export function newCondition(field: FilterField = 'title'): DraftCondition {
  const [first = 'is'] = COMPARISONS[kindOf(field)]
  const kind = kindOf(field)
  const value = kind === 'status' ? 'in-progress' : kind === 'milestone' ? 'fixed-date' : ''
  return { field, comparison: first, value: kind === 'people' ? VIEWER : value }
}

/**
 * The condition changed to `field`: kept as it is if the field is of the same kind, started afresh
 * otherwise, as a value of one kind means nothing to another.
 */
export function withField(condition: DraftCondition, field: FilterField): DraftCondition {
  if (kindOf(field) === kindOf(condition.field)) return { ...condition, field }
  return newCondition(field)
}

/** Why a condition cannot be saved, or `null` if it can. */
export function problemOf(condition: DraftCondition): string | null {
  if (!needsValue(condition.comparison)) return null
  const value = condition.value.trim()
  const label = labelOf(condition.field)
  switch (kindOf(condition.field)) {
    case 'text':
      return value === '' ? `${label} needs a text to compare with` : null
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : `${label} needs a date`
    case 'number':
      return value !== '' && Number.isFinite(Number(value)) ? null : `${label} needs a number`
    case 'issue':
      return /^[1-9]\d*$/.test(value) ? null : `${label} needs an issue number`
    case 'people':
    case 'project':
    case 'repository':
      return value === '' ? `${label} needs a choice` : null
    default:
      // A status or a milestone variant is chosen from a list, so it always has one.
      return null
  }
}

/** The condition as the REST API takes it; to be called on a condition with no problem. */
export function toCondition(condition: DraftCondition): FilterCondition {
  const { field, comparison } = condition
  if (comparison === 'empty') return { field, operator: 'is', value: null }
  if (comparison === 'not-empty') return { field, operator: 'is-not', value: null }
  const value = condition.value.trim()
  switch (kindOf(field)) {
    case 'number':
    case 'issue':
      return { field, operator: comparison, value: Number(value) }
    case 'people':
      return {
        field,
        operator: comparison,
        value: value === VIEWER ? { viewer: true } : { accountId: value },
      }
    default:
      return { field, operator: comparison, value }
  }
}

/** The names the description of a condition needs, by id. */
export interface FilterNames {
  people: ReadonlyMap<string, string>
  projects: ReadonlyMap<string, string>
  repositories: ReadonlyMap<string, string>
}

/** A condition in words, as a saved view shows its filter: "Status is In progress". */
export function describeCondition(condition: FilterCondition, names: FilterNames): string {
  const { field, operator, value } = condition
  const label = labelOf(field)
  if (value === null) return `${label} ${operator === 'is' ? 'is empty' : 'is not empty'}`
  return `${label} ${COMPARISON_LABELS[operator]} ${valueInWords(field, value, names)}`
}

function valueInWords(
  field: FilterField,
  value: string | number | FilterPerson,
  names: FilterNames,
): string {
  if (typeof value === 'object') {
    if ('viewer' in value) return 'the person viewing'
    return names.people.get(value.accountId) ?? 'someone else'
  }
  switch (kindOf(field)) {
    case 'text':
      return `“${value}”`
    case 'status':
      return STATUSES.find((status) => status.value === value)?.label ?? String(value)
    case 'milestone':
      return MILESTONE_VARIANTS.find((variant) => variant.value === value)?.label ?? String(value)
    case 'project':
      return names.projects.get(String(value)) ?? 'a project you cannot read'
    case 'repository':
      return names.repositories.get(String(value)) ?? 'a repository'
    case 'issue':
      return `#${value}`
    default:
      return String(value)
  }
}
