import { eq, inArray, sql } from 'drizzle-orm'
import type { Executor } from '../db/client.ts'
import {
  accounts,
  type Eligibility,
  type EligibilityOperand,
  taskAssignees,
  tasks,
} from '../db/schema.ts'
import { ServiceError } from './errors.ts'
import { keptLoadOverrides, type LoadOverrides, validLoadOverrides } from './person-load.ts'
import { allows, type RoleSource } from './permissions.ts'
import { isUuid } from './system-admins.ts'

export type { Eligibility, EligibilityOperand }

/** Who can do a task and who will (SRC-029): the two kept apart (FR-029). */
export interface Assignment {
  /** Who can do it, as a tree of AND (`all`) and OR (`any`) over account ids; `null` for none. */
  eligibility: Eligibility | null
  /** Who will do it: their account ids, in the order given; empty while nobody is assigned. */
  assignees: string[]
  /**
   * The person-load percentages that replace the task's for single assignees (FR-033, SC-039),
   * by account id, in the order of their ids; empty while none does.
   */
  loadOverrides: LoadOverrides
}

/** The parts of an assignment as a channel hands them over: any may be left out. */
export interface AssignmentInput {
  readonly eligibility?: unknown
  readonly assignees?: unknown
  readonly loadOverrides?: unknown
}

/**
 * The column a task's assignees are read with, next to its own columns: their account ids, in
 * their order, as text so that every driver hands them over as strings.
 */
export const assigneesColumn = sql<string[]>`coalesce((
  select array_agg(${taskAssignees.accountId}::text order by ${taskAssignees.position})
  from ${taskAssignees} where ${taskAssignees.taskId} = ${tasks.id}
), '{}')`

/**
 * The column a task's person-load overrides are read with (FR-033): an object from assignee's
 * account id to their percentage, for those assignees who have one. Its keys come in the order of
 * their ids, as `jsonb` orders keys of one length.
 */
export const loadOverridesColumn = sql<LoadOverrides>`coalesce((
  select jsonb_object_agg(${taskAssignees.accountId}::text, ${taskAssignees.loadOverride})
  from ${taskAssignees}
  where ${taskAssignees.taskId} = ${tasks.id} and ${taskAssignees.loadOverride} is not null
), '{}'::jsonb)`

/**
 * The eligibility and assignment module of the service layer (DD-039, SC-005). It stores who can
 * do a task as an AND/OR expression over people, at most two levels deep (FR-028), held as a tree
 * (DD-038), and who will do it as a concrete list of people, apart from the expression (FR-029).
 *
 * - Anyone may be assigned whom the expression does not name: that is accepted, with no warning
 *   (DD-031, FR-030).
 * - No one can be made eligible for, or assigned to, a task in a project they cannot read
 *   (DD-013, FR-031). Only the people a change adds are checked: someone who loses read access
 *   after being written in stays, and can be removed, but cannot be added again (FR-198).
 * - It tells who in a task's eligibility and assignment cannot read the project, so that the
 *   editors can mark them (FR-199, `withoutReadAccess`).
 * - An expression deeper than two levels (FR-197), and a person assigned twice (FR-200), are
 *   refused.
 * - A milestone has neither an expression nor assignees (FR-192).
 * - Each assignment can override the task's person-load percentage for that person alone (FR-033,
 *   SC-039); the rules of the percentages are in `person-load.ts`.
 *
 * The task record module (SC-001) calls it inside the transaction that creates or edits a task,
 * after it has checked that the caller may edit the project's plan, so every channel is held to
 * the same rules.
 */
export class TaskAssignments {
  readonly #roles: RoleSource

  constructor(roles: RoleSource) {
    this.#roles = roles
  }

  /**
   * The task's assignment once `input` is applied to `current`: each part given in `input` checked,
   * each part left out kept. Refused as invalid if a part is not valid (see `validEligibility`,
   * `validAssignees` and `validLoadOverrides`), if the task is a milestone and would have either
   * of the first two (FR-192), or if a person it adds has no account or cannot read the project
   * (FR-031). Overrides left out are kept for the people who stay assigned, and dropped for those
   * who do not.
   */
  async check(
    executor: Executor,
    projectId: string,
    milestone: boolean,
    input: AssignmentInput,
    current: Assignment,
  ): Promise<Assignment> {
    const assignees =
      input.assignees === undefined ? current.assignees : validAssignees(input.assignees)
    const next: Assignment = {
      eligibility:
        input.eligibility === undefined ? current.eligibility : validEligibility(input.eligibility),
      assignees,
      loadOverrides:
        input.loadOverrides === undefined
          ? keptLoadOverrides(current.loadOverrides, assignees)
          : validLoadOverrides(input.loadOverrides, assignees),
    }
    if (milestone && next.assignees.length > 0) {
      throw invalid('A milestone takes no time: nobody can be assigned to it')
    }
    if (milestone && next.eligibility !== null) {
      throw invalid('A milestone takes no time: it has no eligibility expression')
    }
    const before = new Set(peopleOf(current.eligibility))
    const madeEligible = peopleOf(next.eligibility).filter((person) => !before.has(person))
    const assigned = next.assignees.filter((person) => !current.assignees.includes(person))
    await this.#requireReaders(executor, projectId, madeEligible, 'made eligible for')
    await this.#requireReaders(executor, projectId, assigned, 'assigned to')
    return next
  }

  /** Replaces the task's assignees with those of `assignment`, in their order, with their overrides. */
  async store(
    executor: Executor,
    taskId: string,
    { assignees, loadOverrides }: Pick<Assignment, 'assignees' | 'loadOverrides'>,
  ): Promise<void> {
    await executor.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId))
    if (assignees.length === 0) return
    await executor.insert(taskAssignees).values(
      assignees.map((accountId, position) => ({
        taskId,
        accountId,
        position,
        loadOverride: loadOverrides[accountId] ?? null,
      })),
    )
  }

  /**
   * Those of `people` who cannot read the project: who hold no role in it, directly or through a
   * group, that lets them read it (FR-199). Their roles are read in one query.
   */
  async withoutReadAccess(
    executor: Executor,
    projectId: string,
    people: Iterable<string>,
  ): Promise<Set<string>> {
    const unique = new Set(people)
    const roles = await this.#roles.rolesOf(unique, projectId, executor)
    return new Set([...unique].filter((person) => !allows(roles.get(person), 'read')))
  }

  /** Refuses any of `people` who has no account, or no role in the project that lets them read it. */
  async #requireReaders(
    executor: Executor,
    projectId: string,
    people: readonly string[],
    what: string,
  ): Promise<void> {
    const unique = [...new Set(people)]
    if (unique.length === 0) return
    const known = await executor
      .select({ id: accounts.id })
      .from(accounts)
      .where(inArray(accounts.id, unique))
    const ids = new Set(known.map((row) => row.id))
    const without = await this.withoutReadAccess(executor, projectId, unique)
    for (const person of unique) {
      // Someone with no account is refused as someone who cannot read the project, so that the
      // refusal does not tell which ids are accounts.
      if (!ids.has(person) || without.has(person)) {
        throw invalid(
          `The person ${person} cannot read this project, so cannot be ${what} its tasks`,
        )
      }
    }
  }
}

/** Every person the expression names, each once, in the order it names them. */
export function peopleOf(expression: Eligibility | null): string[] {
  if (expression === null) return []
  const people: string[] = []
  const walk = (item: Eligibility | EligibilityOperand) => {
    if (typeof item === 'string') people.push(item)
    else for (const inner of operandsOf(item)) walk(inner)
  }
  walk(expression)
  return [...new Set(people)]
}

function operandsOf(node: Exclude<Eligibility, string>): readonly EligibilityOperand[] {
  return 'all' in node ? node.all : node.any
}

/**
 * The eligibility expression `value` gives, or `null` for none: a person, by their account's id,
 * or an AND (`{ "all": [...] }`) or OR (`{ "any": [...] }`) of at least one operand, each a person
 * or an AND or OR of at least one person (FR-028, DD-038). An expression deeper than that is
 * refused, as is anything else. It is kept as given, neither flattened nor regrouped; only each
 * id is put in lower case, the form the database gives ids out in.
 */
export function validEligibility(value: unknown): Eligibility | null {
  if (value === null) return null
  if (typeof value === 'string') return personId(value)
  const { operator, operands } = andOr(value)
  // The top level's operands are people or, one level down, ANDs and ORs of people.
  const checked = operands.map(operand)
  return operator === 'all' ? { all: checked } : { any: checked }
}

/** An operand of the top-level AND or OR: a person, or an AND or OR of people only. */
function operand(value: unknown): EligibilityOperand {
  if (typeof value === 'string') return personId(value)
  const { operator, operands } = andOr(value)
  const people = operands.map((inner) => {
    if (typeof inner === 'string') return personId(inner)
    // Anything else in an AND or OR one level down would make the expression three levels deep.
    andOr(inner)
    throw invalid('An eligibility expression is at most two levels deep, such as A AND (B OR C)')
  })
  return operator === 'all' ? { all: people } : { any: people }
}

/** The operator and operands of an AND (`{ "all": [...] }`) or OR (`{ "any": [...] }`). */
function andOr(value: unknown): { operator: 'all' | 'any'; operands: unknown[] } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(
      'An eligibility expression is a person, by account id, or an AND ({"all": [...]}) or ' +
        'OR ({"any": [...]}) of operands',
    )
  }
  const entries = Object.entries(value)
  const [entry] = entries
  if (entries.length !== 1 || !entry || (entry[0] !== 'all' && entry[0] !== 'any')) {
    throw invalid('An AND or OR in an eligibility expression is {"all": [...]} or {"any": [...]}')
  }
  const [operator, operands]: [string, unknown] = entry
  if (!Array.isArray(operands) || operands.length === 0) {
    throw invalid('An AND or OR in an eligibility expression has at least one operand')
  }
  return { operator: operator === 'all' ? 'all' : 'any', operands }
}

/**
 * The assignees `value` gives: a list of people, by account id, each at most once; an empty list
 * for nobody (FR-029).
 */
export function validAssignees(value: unknown): string[] {
  if (!Array.isArray(value)) throw invalid("A task's assignees are a list of people, by account id")
  const people = value.map(personId)
  if (new Set(people).size !== people.length) {
    throw invalid('A person can be assigned to a task only once')
  }
  return people
}

function personId(value: unknown): string {
  if (typeof value !== 'string' || !isUuid(value)) {
    throw invalid('A person is named by their account id')
  }
  return value.toLowerCase()
}

function invalid(message: string): ServiceError {
  return new ServiceError('invalid', message)
}
