import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { accounts, auditChannel, projects, tasks } from './core.ts'

/**
 * The kinds of change a proposal can hold (FR-205, SRC-247): every change that can be made to a
 * project's tasks in the live plan, and nothing else. Each holds only the inputs the change gives,
 * never a date the scheduler derives (FR-154, DD-020).
 */
export const PROPOSAL_CHANGE_KINDS = [
  'create-task',
  'update-task',
  'set-parent',
  'add-blocker',
  'remove-blocker',
  'set-status',
  'cancel-task',
  'assign-repository',
] as const

export const proposalChangeKind = pgEnum('proposal_change_kind', PROPOSAL_CHANGE_KINDS)

/**
 * A task a change names: an existing task, by its id, or a task a `create-task` change of the same
 * group creates, by the key that change gives it.
 */
export type TaskRef = { taskId: string } | { newTask: string }

/** The statuses a proposal can set a task to; cancelling is a change of its own (SC-038). */
export const PROPOSABLE_STATUSES = ['in-progress', 'on-hold', 'done'] as const

export type ProposableStatus = (typeof PROPOSABLE_STATUSES)[number]

/**
 * The fields a proposal can give a task it creates or changes: those a task is created with or
 * changed by in the live plan (`TaskInput`), all of them planning inputs. None is a date the
 * scheduler derives (FR-154, DD-020): a floating milestone's date and a task's actual start and
 * finish are not among them.
 */
export const PROPOSABLE_TASK_FIELDS = [
  'title',
  'description',
  'plannedStart',
  'plannedFinish',
  'durationWorkingDays',
  'effort',
  'aiShare',
  'personLoad',
  'milestone',
  'eligibility',
  'assignees',
  'loadOverrides',
] as const

/** A task's fields as a proposal gives them, each value as it was given. */
export type ProposedTaskFields = Partial<Record<(typeof PROPOSABLE_TASK_FIELDS)[number], unknown>>

/**
 * One change of a proposal (FR-069, FR-205): the inputs it gives, as they were given, and nothing
 * the scheduler would derive from them (FR-154).
 */
export type ProposedChange =
  | { kind: 'create-task'; key: string; projectId: string; fields: ProposedTaskFields }
  | { kind: 'update-task'; task: TaskRef; fields: ProposedTaskFields }
  | { kind: 'set-parent'; task: TaskRef; parent: TaskRef | null }
  | { kind: 'add-blocker'; task: TaskRef; blocker: TaskRef }
  | { kind: 'remove-blocker'; task: TaskRef; blocker: TaskRef }
  | { kind: 'set-status'; task: TaskRef; status: ProposableStatus }
  | { kind: 'cancel-task'; task: TaskRef }
  | { kind: 'assign-repository'; task: TaskRef; repositoryId: string }

/**
 * The proposals (SC-010): each a set of changes to the plan (FR-069), made by `created_by` through
 * `channel`, the REST API or the MCP server (FR-204). `last_edited_at` is when it was created or
 * last edited, which its expiry is counted from (DD-024, SC-046).
 */
export const proposals = pgTable(
  'proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => accounts.id),
    channel: auditChannel('channel').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastEditedAt: timestamp('last_edited_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('proposals_channel', sql`${table.channel} in ('rest-api', 'mcp')`)],
)

/**
 * The projects a proposal changes (DD-025): one row for each, so that a project's proposals can
 * be listed, and each project's part approved there (SC-048).
 */
export const proposalProjects = pgTable(
  'proposal_projects',
  {
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
  },
  (table) => [
    uniqueIndex('proposal_projects_key').on(table.proposalId, table.projectId),
    index('proposal_projects_project_id_idx').on(table.projectId),
  ],
)

/**
 * The groups of a proposal's changes (DD-023, FR-070): the changes that only make sense together,
 * kept, edited or dropped as one. `position` is the group's place in the proposal, from 0.
 */
export const proposalGroups = pgTable(
  'proposal_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id),
    position: integer('position').notNull(),
  },
  (table) => [uniqueIndex('proposal_groups_position_key').on(table.proposalId, table.position)],
)

/**
 * The changes of a proposal, each in its group at its `position` there, from 0, in the order they
 * were given. `change` is the change itself (`ProposedChange`): what it gives, as it was given, the planning inputs only (FR-154). The columns beside it are read off it
 * for finding a project's or a task's changes: `project_id` is the project it changes; `task_id`
 * the existing task it changes, if any; `new_task_key` the key of a task the proposal itself
 * creates, if it changes or creates one.
 */
export const proposalChanges = pgTable(
  'proposal_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => proposalGroups.id),
    position: integer('position').notNull(),
    kind: proposalChangeKind('kind').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    taskId: uuid('task_id').references(() => tasks.id),
    newTaskKey: text('new_task_key'),
    change: jsonb('change').$type<ProposedChange>().notNull(),
  },
  (table) => [
    uniqueIndex('proposal_changes_position_key').on(table.groupId, table.position),
    index('proposal_changes_task_id_idx').on(table.taskId),
    // A change names its task one way: an existing task, or a task the proposal creates.
    check('proposal_changes_one_task', sql`${table.taskId} is null or ${table.newTaskKey} is null`),
  ],
)
