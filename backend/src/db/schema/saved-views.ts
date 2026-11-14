import { sql } from 'drizzle-orm'
import {
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
import { accounts, groups, projects } from './core.ts'

/** The view kinds that have saved views: Kanban and Gantt, and no other (FR-054). */
export const SAVED_VIEW_KINDS = ['kanban', 'gantt'] as const

export const savedViewKind = pgEnum('saved_view_kind', SAVED_VIEW_KINDS)

/**
 * The saved views (SC-020): named Kanban and Gantt views (FR-054), each kept in exactly one place
 * (FR-055): a project (`project_id`), a group (`group_id`) or personally, by its owner
 * (`owner_id`). `filter` is the view's filter on task fields and on the person viewing it
 * (FR-057, FR-058), as the saved view module checked it; `created_by` is who saved it. The
 * projects it covers are in `saved_view_projects`. A group's views are deleted with the group
 * (FR-161, SC-059).
 */
export const savedViews = pgTable(
  'saved_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    kind: savedViewKind('kind').notNull(),
    projectId: uuid('project_id').references(() => projects.id),
    groupId: uuid('group_id').references(() => groups.id),
    ownerId: uuid('owner_id').references(() => accounts.id),
    filter: jsonb('filter').$type<unknown[]>().notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => accounts.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'saved_views_one_place',
      sql`num_nonnulls(${table.projectId}, ${table.groupId}, ${table.ownerId}) = 1`,
    ),
    index('saved_views_project_id_idx').on(table.projectId),
    index('saved_views_group_id_idx').on(table.groupId),
    index('saved_views_owner_id_idx').on(table.ownerId),
  ],
)

/**
 * The projects each saved view covers (FR-056): only its own project for a view kept in a
 * project, some of the group's projects for one kept in a group, and some of those its owner can
 * read for a personal one. At most one row for each project in each view; a view's rows go with
 * it.
 */
export const savedViewProjects = pgTable(
  'saved_view_projects',
  {
    viewId: uuid('view_id')
      .notNull()
      .references(() => savedViews.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
  },
  (table) => [
    uniqueIndex('saved_view_projects_key').on(table.viewId, table.projectId),
    index('saved_view_projects_project_id_idx').on(table.projectId),
  ],
)
