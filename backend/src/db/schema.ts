// The Drizzle schema (DD-057). Each backend block adds its tables here and generates its
// migration with `npm run db:generate` (SC-073).
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
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
  },
  (table) => [
    uniqueIndex('accounts_username_key').on(sql`lower(${table.username})`),
    uniqueIndex('accounts_github_login_key').on(sql`lower(${table.githubLogin})`),
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
