// The Drizzle schema (DD-057). Each backend block adds its tables here and generates its
// migration with `npm run db:generate` (SC-073).
import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
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

/**
 * The accounts held in the tool itself (DD-027), which system admins create (FR-117, SC-015). A
 * password is kept only as its Argon2id hash (DD-056). A username is unique regardless of case, so
 * `erin` and `Erin` cannot be two people.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    systemAdmin: boolean('system_admin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * The name of the person's GitHub account, which they or a system admin linked it to (FR-135,
     * SC-054); none until linked. GitHub names ignore case, so one GitHub account is linked to at
     * most one account here.
     */
    githubLogin: text('github_login'),
    /**
     * The person's capacity, as a whole percentage of full time, such as 100 for full-time or 80
     * for part-time (FR-037, SC-008). The person or a system admin sets it (FR-150).
     */
    capacity: integer('capacity').notNull().default(100),
  },
  (table) => [
    uniqueIndex('accounts_username_key').on(sql`lower(${table.username})`),
    uniqueIndex('accounts_github_login_key').on(sql`lower(${table.githubLogin})`),
    check('accounts_capacity_percentage', sql`${table.capacity} between 0 and 100`),
  ],
)

/**
 * The projects (SC-017). Anyone with an account can create one (FR-119) and becomes its admin
 * (FR-158); `created_by` is who created it. Each has a name no other project has (FR-120).
 */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => accounts.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // No two projects have the same name (FR-120, SC-056). The index holds the name's MD5 rather
  // than the name: a name of 200 characters can take more bytes than a btree entry can hold.
  (table) => [uniqueIndex('projects_name_key').on(sql`md5(${table.name})`)],
)

/** The channels a change can come through (FR-116): the UI, the REST API, the MCP server, GitHub. */
export const CHANNELS = ['ui', 'rest-api', 'mcp', 'github'] as const

export const auditChannel = pgEnum('audit_channel', CHANNELS)

/**
 * The audit log (FR-116, SC-013): one row for each change, with who made it, when and through
 * which channels. A change an approved AI proposal applies has two, the one the proposal was made
 * through and the one it was approved through (FR-164). Rows are only ever added. `project_id` is
 * the project a change belongs to, for the project's part of the log (FR-138), and empty for a
 * change outside any project, such as to an account.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorAccountId: uuid('actor_account_id')
      .notNull()
      .references(() => accounts.id),
    channels: auditChannel('channels').array().notNull(),
    projectId: uuid('project_id').references(() => projects.id),
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index('audit_log_project_id_idx').on(table.projectId, table.id),
    check('audit_log_channels_not_empty', sql`cardinality(${table.channels}) > 0`),
  ],
)

/** The four roles a person can hold in a project, lowest first (FR-105). */
export const PROJECT_ROLES = ['read-only', 'contributor', 'read-write', 'admin'] as const

export const projectRole = pgEnum('project_role', PROJECT_ROLES)

/**
 * The roles people hold in projects directly (FR-105, SC-014): at most one role for each person in
 * each project. Roles that come through groups are held with the groups (SC-057, SC-058).
 */
export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    role: projectRole('role').notNull(),
  },
  (table) => [
    // A unique index, not a composite primary key: drizzle-kit's `pushSchema`, which the schema
    // check uses, sends its query for a composite key's name without the query's parameters.
    uniqueIndex('project_members_key').on(table.projectId, table.accountId),
    index('project_members_account_id_idx').on(table.accountId),
  ],
)

/**
 * The groups (SC-018): sets of people, each holding a role in the group (SRC-139). Anyone with an
 * account can create one (FR-121) and becomes its admin (FR-159); `created_by` is who created it.
 * Every group is shown to everyone (FR-122). Each has a name no other group has, as the owner
 * decided in the review of SC-018 (2026-11-04).
 */
export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => accounts.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // On the name's MD5 rather than the name, for the reason given at projects_name_key.
  (table) => [uniqueIndex('groups_name_key').on(sql`md5(${table.name})`)],
)

/**
 * The members of each group, with the role each holds in it (SRC-139): read, contributor, write
 * or admin, the same four roles a person can hold in a project directly, which a member then holds
 * on every project in the group (FR-111, SC-058). At most one role for each person in each group.
 * Group creation (SC-018) adds the creator as admin; group membership (SC-057) adds the others.
 */
export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    role: projectRole('role').notNull(),
  },
  (table) => [
    // A unique index rather than a composite primary key, for the reason given at project_members.
    uniqueIndex('group_members_key').on(table.groupId, table.accountId),
    index('group_members_account_id_idx').on(table.accountId),
  ],
)

/**
 * The personal access tokens people create for the REST API and the MCP server (DD-048, SC-016).
 * A token's secret is kept only as its hash, unique so that a request's secret finds its token; a
 * revoked token is deleted. A token with no expiry date never expires.
 */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    secretHash: text('secret_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('api_tokens_secret_hash_key').on(table.secretHash),
    index('api_tokens_account_id_idx').on(table.accountId),
  ],
)

/**
 * The sign-in sessions (DD-054, SC-052): one for each time a person signed in in a browser, until
 * they sign out. The browser holds only the session's random id, in a cookie; the database holds
 * only that id's hash, unique so that a cookie finds its session.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    secretHash: text('secret_hash').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_secret_hash_key').on(table.secretHash),
    index('sessions_account_id_idx').on(table.accountId),
  ],
)

/**
 * The statuses a task can be in, the one definition the task modules (SC-001, SC-003, SC-038) and
 * the permission checks (SC-049) take over. A new task is not started.
 */
export const TASK_STATUSES = ['not-started', 'in-progress', 'on-hold', 'done', 'cancelled'] as const

export const taskStatus = pgEnum('task_status', TASK_STATUSES)

/**
 * The two kinds of milestone (FR-190, SRC-236): one pinned to a fixed date, and one that floats,
 * coming once the things it needs are done. A task that is not a milestone has neither.
 */
export const MILESTONE_VARIANTS = ['fixed-date', 'floating'] as const

export const milestoneVariant = pgEnum('milestone_variant', MILESTONE_VARIANTS)

/**
 * The tasks (FR-001, SC-001), each in its project. A task's planned start, planned finish and
 * duration are each optional: a task with no planned dates is an unscheduled task of its project,
 * kept with its other tasks (FR-003). A duration is a whole number of working days (DD-006,
 * FR-002); the planned finish it gives is derived by the scheduler (FR-144, SC-004). Effort is a
 * number in the unit the tool states for it; the AI share is a percentage.
 *
 * A task can be made a milestone when it is created (FR-190): `milestone_variant` says whether it
 * is pinned to a fixed date, `milestone_date`, or floating, and is null for a task that is not a
 * milestone. A milestone takes no time, so it has no planned dates, duration, effort or AI share
 * (FR-191); a fixed-date milestone's only date is the one it is pinned to.
 *
 * `parent_id` makes a task a subtask of another task of its project (SC-002); a task has at most
 * one parent, and subtasks nest. The task relation module keeps the nesting free of cycles and
 * keeps milestones out of it (FR-193); any other module that writes `parent_id` takes its
 * `lockRelations` first. Nothing deletes a task yet, so the reference does not say what happens
 * to a deleted parent's subtasks.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: taskStatus('status').notNull().default('not-started'),
    plannedStart: date('planned_start', { mode: 'string' }),
    plannedFinish: date('planned_finish', { mode: 'string' }),
    durationWorkingDays: integer('duration_working_days'),
    effort: doublePrecision('effort'),
    aiShare: doublePrecision('ai_share'),
    milestoneVariant: milestoneVariant('milestone_variant'),
    milestoneDate: date('milestone_date', { mode: 'string' }),
    /** The date the task was started, recorded by the status transitions (SC-003, FR-022). */
    actualStart: date('actual_start', { mode: 'string' }),
    /** The date the task was finished, recorded by the status transitions (SC-003, FR-023). */
    actualFinish: date('actual_finish', { mode: 'string' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => tasks.id),
    /**
     * Who can do the task (FR-028, SC-005): an AND/OR expression over people, at most two levels
     * deep, stored as a tree (DD-038), such as `{"all": [A, {"any": [B, C, D]}]}`, each person
     * by their account's id. Null when the task has none; a milestone never has one (FR-192).
     */
    eligibility: jsonb('eligibility').$type<Eligibility>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tasks_project_id_idx').on(table.projectId, table.createdAt),
    index('tasks_parent_id_idx').on(table.parentId),
    check('tasks_not_own_parent', sql`${table.parentId} <> ${table.id}`),
    check('tasks_duration_whole_days', sql`${table.durationWorkingDays} >= 1`),
    check('tasks_finish_not_before_start', sql`${table.plannedFinish} >= ${table.plannedStart}`),
    check('tasks_effort_not_negative', sql`${table.effort} >= 0`),
    check('tasks_ai_share_percentage', sql`${table.aiShare} between 0 and 100`),
    check(
      'tasks_milestone_date_iff_fixed',
      sql`(${table.milestoneVariant} is not distinct from 'fixed-date') = (${table.milestoneDate} is not null)`,
    ),
    check(
      'tasks_milestone_has_no_eligibility',
      sql`${table.milestoneVariant} is null or ${table.eligibility} is null`,
    ),
    check(
      'tasks_milestone_takes_no_time',
      sql`${table.milestoneVariant} is null or (${table.plannedStart} is null and ${table.plannedFinish} is null and ${table.durationWorkingDays} is null and ${table.effort} is null and ${table.aiShare} is null)`,
    ),
  ],
)

/**
 * An eligibility expression as it is stored (DD-038): a person, by their account's id, or an AND
 * (`all`) or OR (`any`) of operands, each a person or, one level down, an AND or OR of people.
 * The eligibility and assignment module (SC-005) checks every expression before it is stored.
 */
export type Eligibility = string | { all: EligibilityOperand[] } | { any: EligibilityOperand[] }

/** An operand of an eligibility expression's top-level AND or OR. */
export type EligibilityOperand = string | { all: string[] } | { any: string[] }

/**
 * Who will do each task (FR-029, SC-005): a concrete list of people, kept apart from the task's
 * eligibility, in the order it was given (`position`). Anyone in it can read the task's project
 * when they are added (FR-031), whether or not the eligibility expression names them (FR-030). A
 * milestone has nobody in it (FR-192); the eligibility and assignment module keeps it so.
 */
export const taskAssignees = pgTable(
  'task_assignees',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    position: integer('position').notNull(),
  },
  (table) => [
    // A unique index rather than a composite primary key, for the reason given at project_members.
    uniqueIndex('task_assignees_key').on(table.taskId, table.accountId),
    uniqueIndex('task_assignees_position_key').on(table.taskId, table.position),
    index('task_assignees_account_id_idx').on(table.accountId),
  ],
)

/**
 * The blocked-by relations (SC-002): `task_id` is blocked by `blocker_id`. The blocker is a task
 * of the same project, or a milestone of another project (FR-015). Either way the relation is the
 * blocked task's, so it is held in that task's project and never in the blocker's. The task
 * relation module keeps the relations free of cycles (FR-014); any other module that writes
 * them, such as passing a cancelled task's blockers on (FR-128), takes its `lockRelations` first.
 * Nothing deletes a task yet, so the references do not say what happens to its relations.
 */
export const taskBlockedBy = pgTable(
  'task_blocked_by',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => tasks.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('task_blocked_by_key').on(table.taskId, table.blockerId),
    index('task_blocked_by_blocker_id_idx').on(table.blockerId),
    check('task_blocked_by_not_self', sql`${table.taskId} <> ${table.blockerId}`),
  ],
)

/** The days of the week, Monday first, as the global calendar names its weekend days (FR-131). */
export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

export const weekday = pgEnum('weekday', WEEKDAYS)

/**
 * The one global calendar's weekend (FR-040, FR-131, SC-008): which days of the week are the
 * weekend, as system admins set them. The table holds at most one row, keyed by `id`, which can
 * only be true; until a system admin first sets the weekend there is no row, and the calendar
 * module answers its default. The global calendar's company holidays are in `company_holidays`.
 */
export const globalCalendar = pgTable(
  'global_calendar',
  {
    id: boolean('id').primaryKey().default(true),
    weekendDays: weekday('weekend_days').array().notNull(),
  },
  (table) => [check('global_calendar_one_row', sql`${table.id}`)],
)

/**
 * The company holidays of the global calendar (FR-040, SC-008), one row a day, which only system
 * admins add and remove (FR-041).
 */
export const companyHolidays = pgTable('company_holidays', {
  date: date('date', { mode: 'string' }).primaryKey(),
})

/**
 * Each person's own calendar (FR-039, SC-008): the holidays they, or a system admin for them
 * (FR-150), entered, one row a day, as many as they want. A person's own calendar has no weekend
 * of its own; the weekend is the global calendar's (SRC-162).
 */
export const personalHolidays = pgTable(
  'personal_holidays',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    date: date('date', { mode: 'string' }).notNull(),
  },
  (table) => [
    // A unique index rather than a composite primary key, for the reason given at project_members.
    uniqueIndex('personal_holidays_key').on(table.accountId, table.date),
  ],
)

/**
 * Each person's absences, such as vacation or sick leave (FR-038, SC-008), each a run of whole
 * days (DD-011) from `starts_on` to `ends_on`, both included, which the person or a system admin
 * for them (FR-150) records. On those days the person's capacity is 0 (SRC-042).
 */
export const absences = pgTable(
  'absences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('absences_account_id_idx').on(table.accountId),
    check('absences_end_not_before_start', sql`${table.endsOn} >= ${table.startsOn}`),
  ],
)
