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
  },
  (table) => [uniqueIndex('accounts_username_key').on(sql`lower(${table.username})`)],
)

/** The channels a change can come through (FR-116): the UI, the REST API, the MCP server, GitHub. */
export const CHANNELS = ['ui', 'rest-api', 'mcp', 'github'] as const

export const auditChannel = pgEnum('audit_channel', CHANNELS)

/**
 * The audit log (FR-116, SC-013): one row for each change, with who made it, when and through
 * which channels. A change an approved AI proposal applies has two, the one the proposal was made
 * through and the one it was approved through (FR-164). Rows are only ever added. `project_id` is
 * the project a change belongs to, for the project's part of the log (FR-138), and empty for a
 * change outside any project, such as to an account; it gets its foreign key once the projects
 * table exists (SC-017).
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
    projectId: uuid('project_id'),
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
