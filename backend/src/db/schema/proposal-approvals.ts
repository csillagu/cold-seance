import { pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { accounts, auditChannel, projects } from './core.ts'
import { proposals } from './proposals.ts'

/**
 * The approvals of each project's part of a proposal (SC-048, FR-080, DD-025): who approved the
 * part, through which channel, and when. `proposal_edited_at` is the proposal's last edit the
 * approval was given for: an approval counts only while the proposal is still as it was then, so
 * an edit of the proposal (SC-045) asks for every part to be approved again. One row per part; a
 * new approval of the part replaces the old one.
 */
export const proposalApprovals = pgTable(
  'proposal_approvals',
  {
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    approvedBy: uuid('approved_by')
      .notNull()
      .references(() => accounts.id),
    channel: auditChannel('channel').notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
    proposalEditedAt: timestamp('proposal_edited_at', { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex('proposal_approvals_key').on(table.proposalId, table.projectId)],
)
