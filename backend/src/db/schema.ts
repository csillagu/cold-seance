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
 * The projects in each group (SRC-139): a project can be in several groups and a group can hold
 * several projects. Each member of a group holds their group role on every project in it (FR-111).
 * Anyone adds a new project to a group, and only a project's admin an existing one (FR-123,
 * SC-058). At most one row for each project in each group.
 */
export const groupProjects = pgTable(
  'group_projects',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
  },
  (table) => [
    // A unique index rather than a composite primary key, for the reason given at project_members.
    uniqueIndex('group_projects_key').on(table.groupId, table.projectId),
    index('group_projects_project_id_idx').on(table.projectId),
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
 * (FR-191); a fixed-date milestone's only date is the one it is pinned to. A floating milestone's
 * date, `floating_date`, is not given but set by the scheduler (FR-195, SC-004): the day the last
 * of its blockers finishes, or none.
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
    /**
     * The person-load percentage given to an AI-only task (FR-149, SC-039): any number of zero or
     * more, unrounded. Null for any other task, whose percentage is 100% minus its AI share
     * (FR-032), and for an AI-only task given none, which then has that default.
     */
    aiOnlyLoad: doublePrecision('ai_only_load'),
    milestoneVariant: milestoneVariant('milestone_variant'),
    milestoneDate: date('milestone_date', { mode: 'string' }),
    /** The date the scheduler places a floating milestone on (FR-195, SC-004), if any. */
    floatingDate: date('floating_date', { mode: 'string' }),
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
    /**
     * The registered repository the task is assigned to (FR-141, SC-036), or null while it is
     * assigned to none. The task repository assignment sets it, only to a repository the task's
     * project pulls issues from when it is set; a later withdrawal of that approval leaves it as it
     * is (FR-178).
     */
    repositoryId: uuid('repository_id').references((): AnyPgColumn => repositories.id),
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
      'tasks_ai_only_load',
      sql`${table.aiOnlyLoad} is null or (${table.aiShare} is not distinct from 100 and ${table.aiOnlyLoad} >= 0)`,
    ),
    check(
      'tasks_milestone_date_iff_fixed',
      sql`(${table.milestoneVariant} is not distinct from 'fixed-date') = (${table.milestoneDate} is not null)`,
    ),
    check(
      'tasks_floating_date_only_floating',
      sql`${table.floatingDate} is null or ${table.milestoneVariant} = 'floating'`,
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
    /**
     * The person-load percentage that replaces the task's for this person alone (FR-033, DD-010,
     * SC-039), a number of zero or more; null when the task's own applies.
     */
    loadOverride: doublePrecision('load_override'),
  },
  (table) => [
    // A unique index rather than a composite primary key, for the reason given at project_members.
    uniqueIndex('task_assignees_key').on(table.taskId, table.accountId),
    uniqueIndex('task_assignees_position_key').on(table.taskId, table.position),
    index('task_assignees_account_id_idx').on(table.accountId),
    check('task_assignees_load_override_not_negative', sql`${table.loadOverride} >= 0`),
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

/**
 * The GitHub repositories registered in the tool (FR-166, SC-019), each an item of its own,
 * separate from the projects that use it. Anyone with an account registers one the tool can reach
 * on GitHub (FR-167). It is known by GitHub's own id for it, unique so that a repository is
 * registered once, under whatever name or case it is asked for; `owner` and `name` are as GitHub
 * named it when it was registered. `registered_by` is who registered it.
 */
export const repositories = pgTable(
  'repositories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    githubId: bigint('github_id', { mode: 'number' }).notNull(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    registeredBy: uuid('registered_by')
      .notNull()
      .references(() => accounts.id),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('repositories_github_id_key').on(table.githubId),
    // GitHub names ignore case; registration looks a repository up by name before asking GitHub.
    index('repositories_full_name_idx').on(sql`lower(${table.owner})`, sql`lower(${table.name})`),
  ],
)

/**
 * The admins of each registered repository (FR-166): whoever registered it (FR-167), and those its
 * admins (FR-174) or a system admin (FR-169) made admins since. A repository always has at least
 * one (FR-175), which the repository registry keeps (SC-019).
 */
export const repositoryAdmins = pgTable(
  'repository_admins',
  {
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
  },
  (table) => [
    // A unique index rather than a composite primary key, for the reason given at project_members.
    uniqueIndex('repository_admins_key').on(table.repositoryId, table.accountId),
    index('repository_admins_account_id_idx').on(table.accountId),
  ],
)

/**
 * The states of a project's request to add a repository (SC-110): `requested`, waiting for one of
 * the repository's admins (FR-168); `approved`, so the project pulls the repository's issues
 * (FR-142), whether an admin approved it or the requester was admin of both (FR-170); `rejected`
 * by one of its admins (FR-171); `withdrawn`, an approval one of its admins took back (FR-172).
 */
export const PROJECT_REPOSITORY_STATES = ['requested', 'approved', 'rejected', 'withdrawn'] as const

export const projectRepositoryState = pgEnum('project_repository_state', PROJECT_REPOSITORY_STATES)

/**
 * Each project's requests to add a registered repository, and what became of them (SC-110). A
 * project pulls issues from a repository while it has an `approved` row for it (FR-142, FR-181). A
 * rejected or withdrawn row stays, as the record of it, and can no longer change; a project has at
 * most one row for a repository that is requested or approved. `decided_by` is the repository admin
 * who approved or rejected the request, or the requester when they were admin of both;
 * `withdrawn_by` the one who withdrew the approval.
 */
export const projectRepositoryRequests = pgTable(
  'project_repository_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id),
    state: projectRepositoryState('state').notNull(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => accounts.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid('decided_by').references(() => accounts.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    withdrawnBy: uuid('withdrawn_by').references(() => accounts.id),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  },
  (table) => [
    // One open request or approval for each project and repository: two people asking at once
    // cannot both succeed.
    uniqueIndex('project_repository_requests_open_key')
      .on(table.projectId, table.repositoryId)
      .where(sql`${table.state} in ('requested', 'approved')`),
    index('project_repository_requests_repository_id_idx').on(table.repositoryId),
    check(
      'project_repository_requests_decided',
      sql`(${table.state} = 'requested') = (${table.decidedBy} is null) and (${table.decidedBy} is null) = (${table.decidedAt} is null)`,
    ),
    check(
      'project_repository_requests_withdrawn',
      sql`(${table.state} = 'withdrawn') = (${table.withdrawnBy} is not null) and (${table.withdrawnBy} is null) = (${table.withdrawnAt} is null)`,
    ),
  ],
)

/**
 * Each repository's receiving project (SC-111): the one project that gets the repository's new
 * issues (FR-143, FR-157). The repository is the key, so a repository never has two (FR-179); the
 * row is deleted when the receiving project's admin gives the role up (FR-180), and the audit log
 * keeps the history. The row stays when the project stops pulling from the repository, so that no
 * project receives its new issues until the role is given up (SRC-215). Who marked it, and when,
 * is in the audit log.
 */
export const repositoryReceivingProjects = pgTable(
  'repository_receiving_projects',
  {
    repositoryId: uuid('repository_id')
      .primaryKey()
      .references(() => repositories.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
  },
  (table) => [index('repository_receiving_projects_project_id_idx').on(table.projectId)],
)

/**
 * The baselines (SC-009, DD-036): each a named snapshot of every task's planned start and finish
 * in a project, as they stood when it was saved, kept to compare the plan against later. A project
 * keeps several, each under a name no other baseline of the project has (FR-153). Who saved one is
 * `created_by`; the saving is also in the audit log.
 */
export const baselines = pgTable(
  'baselines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => accounts.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // On the name's MD5 rather than the name, for the reason given at projects_name_key. The project
  // is given as an expression too: with it as a plain column next to the expression, drizzle-kit
  // finds the index in the migrated database different from the schema's (schema-migrations test).
  (table) => [
    uniqueIndex('baselines_project_name_key').on(sql`${table.projectId}`, sql`md5(${table.name})`),
  ],
)

/**
 * The dates a baseline holds: one row for each task the project had when the baseline was saved,
 * with its planned start and finish as they were then (FR-064). A milestone, which takes no time,
 * holds the day it lay on as both; a task with no planned dates holds none. The rows are never
 * changed, so later changes to the plan leave the baseline as it was saved.
 */
export const baselineTasks = pgTable(
  'baseline_tasks',
  {
    baselineId: uuid('baseline_id')
      .notNull()
      .references(() => baselines.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id),
    plannedStart: date('planned_start', { mode: 'string' }),
    plannedFinish: date('planned_finish', { mode: 'string' }),
  },
  (table) => [
    uniqueIndex('baseline_tasks_key').on(table.baselineId, table.taskId),
    index('baseline_tasks_task_id_idx').on(table.taskId),
  ],
)
