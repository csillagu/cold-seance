import { asc, eq, inArray } from 'drizzle-orm'
import type { Database, Executor, Transaction } from '../db/client.ts'
import {
  PROPOSABLE_STATUSES,
  PROPOSABLE_TASK_FIELDS,
  PROPOSAL_CHANGE_KINDS,
  type ProposableStatus,
  type ProposedChange,
  type ProposedTaskFields,
  proposalChanges,
  proposalGroups,
  proposalProjects,
  proposals,
  type TaskRef,
  tasks,
} from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller, Channel } from './caller.ts'
import { notVisible, ServiceError } from './errors.ts'
import { allows } from './permissions.ts'
import type { ProjectRoleService } from './project-roles.ts'
import { isUuid } from './system-admins.ts'
import { characters } from './text.ts'

export {
  PROPOSABLE_STATUSES,
  PROPOSABLE_TASK_FIELDS,
  type ProposableStatus,
  type ProposedChange,
  type ProposedTaskFields,
  type TaskRef,
}

/** The kinds of change a proposal can hold: every change to a project's tasks (FR-205). */
export type ProposalChangeKind = (typeof PROPOSAL_CHANGE_KINDS)[number]

/** A change as it is stored, with its id and the project it changes. */
export type StoredChange = ProposedChange & { id: string; projectId: string }

/** A group of changes kept, edited or dropped as one (FR-070, DD-023). */
export interface ProposalGroup {
  id: string
  changes: StoredChange[]
}

/**
 * Where a proposal stands: waiting for review, rejected (FR-075), or expired, having been left
 * unedited for more than 24 hours (FR-081, DD-024).
 */
export type ProposalStatus = 'waiting' | 'rejected' | 'expired'

/** How long a proposal lives after its last edit, in milliseconds (DD-024). */
export const PROPOSAL_LIFETIME_MS = 24 * 60 * 60 * 1000

/**
 * The expiry rule (SC-046, DD-050): a proposal is expired when its last edit is more than 24
 * hours before `now`. A rejected proposal stays rejected, whenever it was last edited. Applied
 * whenever a proposal is read; nothing stores that a proposal expired.
 */
export function proposalStatus(
  proposal: { lastEditedAt: Date; rejectedAt: Date | null },
  now: Date,
): ProposalStatus {
  if (proposal.rejectedAt !== null) return 'rejected'
  return now.getTime() - proposal.lastEditedAt.getTime() > PROPOSAL_LIFETIME_MS
    ? 'expired'
    : 'waiting'
}

/** A proposal as the service layer hands it out (SC-010). */
export interface Proposal {
  id: string
  /** Who created it. */
  createdBy: string
  /** The channel it was created through: the REST API or the MCP server (FR-204). */
  channel: Channel
  createdAt: Date
  /** When it was created or last edited, which its expiry is counted from (DD-024). */
  lastEditedAt: Date
  /** Where it stands, the expiry rule applied as it is read (SC-046). */
  status: ProposalStatus
  /** When it was rejected, if it was (FR-075). */
  rejectedAt: Date | null
  /** Who rejected it, if anyone did. */
  rejectedBy: string | null
  /** The projects it changes, in the order of their ids (DD-025). */
  projectIds: string[]
  groups: ProposalGroup[]
}

/** A proposal as a channel hands it over: its groups of changes, each value still unchecked. */
export interface ProposalInput {
  readonly groups?: unknown
}

/** The channels a proposal can be created through (FR-204, SRC-246). */
const PROPOSING_CHANNELS: ReadonlySet<Channel> = new Set(['rest-api', 'mcp'])

/** The longest key a new task can be given in a proposal, in characters. */
export const NEW_TASK_KEY_MAX_LENGTH = 100

const CHANNEL_REFUSAL = 'A proposal is created through the REST API or the MCP server, not the UI'

/** Why a proposal is refused to someone whose role in a project it changes does not allow it. */
const ROLE_REFUSAL =
  "Only the project's read-write members and admins can create a proposal that changes it"

const invalid = (message: string) => new ServiceError('invalid', message)

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value)

/** A change with the project it changes and the projects of the other tasks it names. */
export interface LocatedChange {
  change: ProposedChange
  projectId: string
  reads: string[]
}

/**
 * The proposal store of the service layer (SC-010, DD-039). It records a proposal as a set of
 * changes against the current plan (FR-069), in the groups it was given, each kept, edited or
 * dropped as one (FR-070, DD-023), holding only the inputs each change gives, never a date the
 * scheduler derives (FR-154, DD-020). A proposal can change anything in a project's plan, that is
 * its tasks (FR-205): create a task, change its fields, its parent, its blockers, its status or
 * its repository, or cancel it.
 *
 * A proposal is created through the REST API or the MCP server, never the UI (FR-204), by someone
 * who holds the read-write or admin role in each project it changes (FR-203); it may change
 * several projects (DD-025). Creating one changes nothing in the plan (FR-071). Its changes are
 * checked here for what they are and which tasks they name; whether each can be made, against the
 * plan as it is then, is decided when it is previewed (SC-011) and approved (SC-048), by the rules
 * of the change made directly. The creation is recorded in the audit log, in each project it
 * changes (FR-116).
 *
 * Anyone with a role in every project a proposal changes may read it (FR-106). Whenever it is
 * read, the expiry rule says whether it has expired (SC-046, DD-050); `now` is the clock it is
 * read by, and the clock a new proposal's creation is recorded by.
 */
export class ProposalService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService
  readonly #now: () => Date

  constructor(
    db: Database,
    audit: AuditLogService,
    roles: ProjectRoleService,
    now: () => Date = () => new Date(),
  ) {
    this.#db = db
    this.#audit = audit
    this.#roles = roles
    this.#now = now
  }

  /**
   * Creates a proposal of the given groups of changes. Refused as forbidden through the UI
   * (FR-204); as invalid if it has no group, a group has no change, or a change is not one a
   * proposal can hold (`validGroups`); as not found if it names a task that does not exist; as not
   * visible if a project it names is not visible to the caller (FR-017); and as forbidden if the
   * caller's role in a project it changes is not read-write or admin (FR-203). Nothing of a
   * refused proposal is stored.
   */
  async createProposal(caller: Caller, proposal: ProposalInput): Promise<Proposal> {
    if (!PROPOSING_CHANNELS.has(caller.channel)) {
      throw new ServiceError('forbidden', CHANNEL_REFUSAL)
    }
    const groups = validGroups(proposal.groups)
    return this.#db.transaction(async (tx) => {
      const located = await locate(tx, groups)
      const all = located.flat()
      const changed = [...new Set(all.map((change) => change.projectId))].sort()
      for (const projectId of changed) {
        const role = await this.#roles.roleOf(caller.accountId, projectId, tx)
        if (role === undefined) throw notVisible()
        if (!allows(role, 'edit-plan')) throw new ServiceError('forbidden', ROLE_REFUSAL)
      }
      for (const projectId of new Set(all.flatMap((change) => change.reads))) {
        await this.#roles.permissions.require(caller, projectId, 'read', tx)
      }
      const id = await this.#store(tx, caller, changed, located)
      for (const projectId of changed) {
        await this.#audit.record(tx, caller, {
          action: 'proposal.created',
          subject: { type: 'proposal', id },
          projectId,
          details: {
            groups: located.length,
            changes: all.filter((change) => change.projectId === projectId).length,
          },
        })
      }
      return this.#read(tx, id)
    })
  }

  /**
   * The proposal, for anyone with a role in every project it changes (FR-106). Refused as not
   * found if there is no such proposal, and as not visible to someone with no role in one of the
   * projects it changes (FR-017).
   */
  async getProposal(caller: Caller, proposalId: string): Promise<Proposal> {
    const rows = isUuid(proposalId) ? await projectsOf(this.#db, [proposalId]) : []
    if (rows.length === 0) throw new ServiceError('not-found', 'There is no such proposal')
    for (const { projectId } of rows) {
      await this.#roles.permissions.require(caller, projectId, 'read')
    }
    return this.#read(this.#db, proposalId)
  }

  /**
   * The proposals that change the project, oldest first, for anyone with a role in it (FR-106);
   * one that changes other projects too, only if the caller has a role in each of them. Refused
   * as not visible to someone with no role in the project (FR-017).
   */
  async listProposals(caller: Caller, projectId: string): Promise<Proposal[]> {
    await this.#roles.permissions.require(caller, projectId, 'read')
    const rows = await this.#db
      .select({ id: proposals.id })
      .from(proposals)
      .innerJoin(proposalProjects, eq(proposalProjects.proposalId, proposals.id))
      .where(eq(proposalProjects.projectId, projectId))
      .orderBy(asc(proposals.createdAt), asc(proposals.id))
    const ids = rows.map((row) => row.id)
    const readable = await this.#roles.readableProjects(caller.accountId)
    const changed = await projectsOf(this.#db, ids)
    const shown = ids.filter((id) =>
      changed.every((row) => row.proposalId !== id || readable.has(row.projectId)),
    )
    const result: Proposal[] = []
    for (const id of shown) result.push(await this.#read(this.#db, id))
    return result
  }

  async #store(
    tx: Transaction,
    caller: Caller,
    changed: string[],
    located: LocatedChange[][],
  ): Promise<string> {
    const now = this.#now()
    const [created] = await tx
      .insert(proposals)
      .values({
        createdBy: caller.accountId,
        channel: caller.channel,
        createdAt: now,
        lastEditedAt: now,
      })
      .returning({ id: proposals.id })
    if (!created) throw new Error('The new proposal was not returned')
    await tx
      .insert(proposalProjects)
      .values(changed.map((projectId) => ({ proposalId: created.id, projectId })))
    for (const [position, group] of located.entries()) {
      const [stored] = await tx
        .insert(proposalGroups)
        .values({ proposalId: created.id, position })
        .returning({ id: proposalGroups.id })
      if (!stored) throw new Error('The new group was not returned')
      await insertChanges(tx, stored.id, group)
    }
    return created.id
  }

  async #read(executor: Executor, proposalId: string): Promise<Proposal> {
    const [proposal] = await executor
      .select({
        id: proposals.id,
        createdBy: proposals.createdBy,
        channel: proposals.channel,
        createdAt: proposals.createdAt,
        lastEditedAt: proposals.lastEditedAt,
        rejectedAt: proposals.rejectedAt,
        rejectedBy: proposals.rejectedBy,
      })
      .from(proposals)
      .where(eq(proposals.id, proposalId))
    if (!proposal) throw new ServiceError('not-found', 'There is no such proposal')
    const status = proposalStatus(proposal, this.#now())
    const projectIds = (await projectsOf(executor, [proposalId])).map((row) => row.projectId)
    const rows = await executor
      .select({
        groupId: proposalGroups.id,
        id: proposalChanges.id,
        projectId: proposalChanges.projectId,
        change: proposalChanges.change,
      })
      .from(proposalGroups)
      .innerJoin(proposalChanges, eq(proposalChanges.groupId, proposalGroups.id))
      .where(eq(proposalGroups.proposalId, proposalId))
      .orderBy(asc(proposalGroups.position), asc(proposalChanges.position))
    const groups: ProposalGroup[] = []
    for (const row of rows) {
      let group = groups.at(-1)
      if (group?.id !== row.groupId) {
        group = { id: row.groupId, changes: [] }
        groups.push(group)
      }
      group.changes.push({ ...row.change, id: row.id, projectId: row.projectId })
    }
    return { ...proposal, status, projectIds, groups }
  }
}

/**
 * The project each change changes, and the projects of the other tasks it names, which the
 * caller must be able to read. Refused as not found for a task that does not exist.
 */
export async function locate(
  tx: Transaction,
  groups: ProposedChange[][],
): Promise<LocatedChange[][]> {
  const named = new Set<string>()
  for (const change of groups.flat()) {
    for (const ref of refsOf(change)) if ('taskId' in ref) named.add(ref.taskId)
  }
  const found =
    named.size > 0
      ? await tx
          .select({ id: tasks.id, projectId: tasks.projectId })
          .from(tasks)
          .where(inArray(tasks.id, [...named]))
      : []
  const projectOfTask = new Map(found.map((task) => [task.id, task.projectId]))
  for (const taskId of named) {
    if (!projectOfTask.has(taskId)) throw new ServiceError('not-found', 'There is no such task')
  }
  return groups.map((group) => {
    const projectOfKey = new Map<string, string>()
    for (const change of group) {
      if (change.kind === 'create-task') projectOfKey.set(change.key, change.projectId)
    }
    const projectOf = (ref: TaskRef): string => {
      const projectId =
        'taskId' in ref ? projectOfTask.get(ref.taskId) : projectOfKey.get(ref.newTask)
      if (projectId === undefined) throw new Error('A task the proposal names was not found')
      return projectId
    }
    return group.map((change) => ({
      change,
      projectId: change.kind === 'create-task' ? change.projectId : projectOf(change.task),
      reads: otherRefsOf(change).map(projectOf),
    }))
  })
}

/** Stores a group's changes, in the order given, in the group `groupId`. */
export async function insertChanges(tx: Transaction, groupId: string, group: LocatedChange[]) {
  await tx.insert(proposalChanges).values(
    group.map(({ change, projectId }, index) => ({
      groupId,
      position: index,
      kind: change.kind,
      projectId,
      ...subjectOf(change),
      change,
    })),
  )
}

/** The projects the proposals change, by proposal, each project in the order of its id. */
export async function projectsOf(executor: Executor, proposalIds: string[]) {
  if (proposalIds.length === 0) return []
  return executor
    .select({ proposalId: proposalProjects.proposalId, projectId: proposalProjects.projectId })
    .from(proposalProjects)
    .where(inArray(proposalProjects.proposalId, proposalIds))
    .orderBy(asc(proposalProjects.projectId))
}

/** The tasks a change names: the one it changes, if it is not creating it, and any other. */
function refsOf(change: ProposedChange): TaskRef[] {
  return change.kind === 'create-task' ? [] : [change.task, ...otherRefsOf(change)]
}

/** The tasks a change names besides the one it changes: a parent or a blocker. */
function otherRefsOf(change: ProposedChange): TaskRef[] {
  if (change.kind === 'set-parent') return change.parent === null ? [] : [change.parent]
  if (change.kind === 'add-blocker' || change.kind === 'remove-blocker') return [change.blocker]
  return []
}

/** The columns that name the task a change changes or creates. */
function subjectOf(change: ProposedChange): { taskId: string | null; newTaskKey: string | null } {
  if (change.kind === 'create-task') return { taskId: null, newTaskKey: change.key }
  return 'taskId' in change.task
    ? { taskId: change.task.taskId, newTaskKey: null }
    : { taskId: null, newTaskKey: change.task.newTask }
}

/**
 * The groups of changes `value` gives: at least one group, each `{ "changes": [...] }` with at
 * least one change, each checked by `validChange`. Each new task has a key no other new task of the
 * proposal has, and a change names a new task only in the group that creates it, without which it
 * makes no sense (DD-023).
 */
export function validGroups(value: unknown): ProposedChange[][] {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalid('A proposal needs at least one group of changes')
  }
  const groups = value.map((group: unknown, index) => {
    const which = `Group ${index + 1} of the proposal`
    if (!isObject(group) || !Array.isArray(group.changes) || group.changes.length === 0) {
      throw invalid(`${which} needs at least one change`)
    }
    unknownKeys(group, ['changes'], which)
    return group.changes.map((change: unknown) => validChange(change))
  })
  const keys = new Set<string>()
  for (const group of groups) {
    const created = new Set<string>()
    for (const change of group) {
      if (change.kind !== 'create-task') continue
      if (keys.has(change.key)) {
        throw invalid(`Two new tasks of the proposal have the key ${change.key}`)
      }
      keys.add(change.key)
      created.add(change.key)
    }
    for (const ref of group.flatMap(refsOf)) {
      if ('newTask' in ref && !created.has(ref.newTask)) {
        throw invalid(`The new task ${ref.newTask} is not created in the group that names it`)
      }
    }
  }
  return groups
}

type ChangeCheck = (value: Record<string, unknown>) => ProposedChange

/** For each kind of change, what it has and how what it gives is checked. */
const CHANGE_CHECKS: Record<ProposalChangeKind, ChangeCheck> = {
  'create-task': (value) => {
    unknownKeys(value, ['kind', 'key', 'projectId', 'fields'], 'A create-task change')
    const fields = validFields(value.fields)
    if (fields.title === undefined) throw invalid('A new task needs a title')
    return {
      kind: 'create-task',
      key: validKey(value.key),
      projectId: validId(value.projectId, 'project'),
      fields,
    }
  },
  'update-task': (value) => {
    unknownKeys(value, ['kind', 'task', 'fields'], 'An update-task change')
    const fields = validFields(value.fields)
    if (Object.keys(fields).length === 0) {
      throw invalid('An update-task change must change at least one field')
    }
    return { kind: 'update-task', task: validRef(value.task), fields }
  },
  'set-parent': (value) => {
    unknownKeys(value, ['kind', 'task', 'parent'], 'A set-parent change')
    if (value.parent === undefined) throw invalid('A set-parent change needs a parent, or null')
    return {
      kind: 'set-parent',
      task: validRef(value.task),
      parent: value.parent === null ? null : validRef(value.parent),
    }
  },
  'add-blocker': (value) => {
    unknownKeys(value, ['kind', 'task', 'blocker'], 'An add-blocker change')
    return { kind: 'add-blocker', task: validRef(value.task), blocker: validRef(value.blocker) }
  },
  'remove-blocker': (value) => {
    unknownKeys(value, ['kind', 'task', 'blocker'], 'A remove-blocker change')
    return { kind: 'remove-blocker', task: validRef(value.task), blocker: validRef(value.blocker) }
  },
  'set-status': (value) => {
    unknownKeys(value, ['kind', 'task', 'status'], 'A set-status change')
    if (!isOneOf(PROPOSABLE_STATUSES, value.status)) {
      throw invalid(`A set-status change's status must be one of ${PROPOSABLE_STATUSES.join(', ')}`)
    }
    return { kind: 'set-status', task: validRef(value.task), status: value.status }
  },
  'cancel-task': (value) => {
    unknownKeys(value, ['kind', 'task'], 'A cancel-task change')
    return { kind: 'cancel-task', task: validRef(value.task) }
  },
  'assign-repository': (value) => {
    unknownKeys(value, ['kind', 'task', 'repositoryId'], 'An assign-repository change')
    return {
      kind: 'assign-repository',
      task: validRef(value.task),
      repositoryId: validId(value.repositoryId, 'repository'),
    }
  },
}

/**
 * One change as `value` gives it: `{ "kind": ... }` with what that kind has, and nothing else.
 * The values a change gives a task's fields are kept as they were given; they are checked when it
 * is applied, by the rules of the change made directly.
 */
export function validChange(value: unknown): ProposedChange {
  if (!isObject(value)) throw invalid('A change must be an object')
  if (!isOneOf(PROPOSAL_CHANGE_KINDS, value.kind)) {
    throw invalid(`A change's kind must be one of ${PROPOSAL_CHANGE_KINDS.join(', ')}`)
  }
  return CHANGE_CHECKS[value.kind](value)
}

function unknownKeys(value: Record<string, unknown>, known: readonly string[], what: string) {
  const extra = Object.keys(value).filter((key) => !known.includes(key))
  if (extra.length > 0) throw invalid(`${what} cannot have ${extra.join(', ')}`)
}

/**
 * The task fields a change gives: only those a task is created with or changed by in the live
 * plan, all of them planning inputs (FR-154). A date the scheduler derives, such as a floating
 * milestone's date or an actual start, is not among them, so a change cannot give one.
 */
function validFields(value: unknown): ProposedTaskFields {
  if (!isObject(value)) throw invalid("A change's fields must be an object")
  unknownKeys(value, PROPOSABLE_TASK_FIELDS, "A change's fields")
  const fields: ProposedTaskFields = {}
  for (const field of PROPOSABLE_TASK_FIELDS) {
    if (value[field] !== undefined) fields[field] = value[field]
  }
  return fields
}

function validRef(value: unknown): TaskRef {
  if (isObject(value) && Object.keys(value).length === 1) {
    if (value.taskId !== undefined) return { taskId: validId(value.taskId, 'task') }
    if (value.newTask !== undefined) return { newTask: validKey(value.newTask) }
  }
  throw invalid(
    'A task is named as { "taskId": <id> } for an existing task, or { "newTask": <key> } for one ' +
      'the proposal creates',
  )
}

function validId(value: unknown, what: string): string {
  if (typeof value !== 'string' || !isUuid(value)) throw invalid(`A ${what} is named by its id`)
  return value.toLowerCase()
}

function validKey(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid("A new task's key must be a non-empty string")
  }
  if (characters(value) > NEW_TASK_KEY_MAX_LENGTH) {
    throw invalid(`A new task's key can have at most ${NEW_TASK_KEY_MAX_LENGTH} characters`)
  }
  return value
}
