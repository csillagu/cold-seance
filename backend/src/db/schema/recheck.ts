import { sql } from 'drizzle-orm'
import { check, integer, pgTable, timestamp } from 'drizzle-orm/pg-core'

/**
 * When the re-check of linked issues (SC-024, DD-051) last ran: one row, written at the end of
 * each run, so that a restart runs it at once only if the last run is older than the interval.
 */
export const recheckRuns = pgTable(
  'recheck_runs',
  {
    /** Always 1: the table holds the one row. */
    id: integer('id').primaryKey().default(1),
    /** When the last run that finished started. */
    lastRunAt: timestamp('last_run_at', { withTimezone: true }).notNull(),
  },
  (table) => [check('recheck_runs_one_row', sql`${table.id} = 1`)],
)
