// The in-app notifications and the subscriptions to issues and projects (SC-012).
import { index, jsonb, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { accounts, projects } from './core.ts'
import { taskIssues } from './github-issues.ts'

/**
 * What a notification is about (SC-012): a new red flag (FR-083, FR-084), a proposal waiting for
 * review (FR-085), a project's request for a repository (FR-173), and a personal access token
 * GitHub refused (FR-186).
 */
export const NOTIFICATION_KINDS = [
  'red-flag',
  'proposal-waiting',
  'repository-request',
  'token-refused',
] as const

export const notificationKind = pgEnum('notification_kind', NOTIFICATION_KINDS)

/**
 * The notifications delivered in the app (FR-082, DD-003): each one is a row for the one person it
 * is sent to. `detail` is what it tells, by its kind; the notification module of the service layer
 * defines each shape. Reading a notification leaves it in place.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    kind: notificationKind('kind').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('notifications_account_id_idx').on(table.accountId, table.createdAt)],
)

/**
 * The projects people subscribed to by hand (FR-133). Everyone with the read-write or admin role in
 * a project is subscribed to it by that role (FR-134), with no row here. At most one row for each
 * person and project.
 */
export const projectSubscriptions = pgTable(
  'project_subscriptions',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A unique index rather than a composite primary key, for the reason given at project_members.
    uniqueIndex('project_subscriptions_key').on(table.accountId, table.projectId),
    index('project_subscriptions_project_id_idx').on(table.projectId),
  ],
)

/**
 * The GitHub issues people subscribed to (FR-133): each the issue linked to a task (DD-001), known
 * by its task, since a task has at most one issue and keeps it. At most one row for each person
 * and issue.
 */
export const issueSubscriptions = pgTable(
  'issue_subscriptions',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => taskIssues.taskId),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('issue_subscriptions_key').on(table.accountId, table.taskId),
    index('issue_subscriptions_task_id_idx').on(table.taskId),
  ],
)
