import { jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { projects } from './core.ts'

/** What a red flag shows, by its kind; the service layer's red flag register defines each shape. */
export type RedFlagDetail = Record<string, unknown>

/**
 * The kinds of red flag (DD-029): a person overloaded on a day (FR-042, FR-043), a task its
 * assigned people cannot do in its time (FR-020), and the two milestone and dependency
 * violations (FR-013, FR-019, FR-147).
 */
export const RED_FLAG_KINDS = [
  'overload',
  'assignee-unavailable',
  'fixed-date-milestone-pushed',
  'cross-project-dependency',
] as const

export const redFlagKind = pgEnum('red_flag_kind', RED_FLAG_KINDS)

/**
 * The red flag register (SC-043): the red flags currently raised, each as one project sees it,
 * since a flag can concern several projects (FR-043, FR-147). `key` names the conflict behind
 * the flag within its kind, so that the same conflict found again is the same flag; `detail` is
 * what the flag shows, which can change while the flag stays raised. `raised_at` is when the flag
 * appeared in the project. A flag's row is deleted once the conflict behind it is gone (FR-021).
 */
export const redFlags = pgTable(
  'red_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    kind: redFlagKind('kind').notNull(),
    key: text('key').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull(),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('red_flags_project_id_key_key').on(table.projectId, table.key)],
)
