// The GitHub issues linked to tasks (SC-022, SC-060).
import { bigint, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { repositories, tasks } from './core.ts'

/**
 * What a linked issue was on GitHub when the tool last took it in (SC-023): open, closed (as
 * completed, or for any reason but not planned), closed as not planned, or deleted.
 */
export const ISSUE_SEEN_STATES = ['open', 'closed', 'not-planned', 'deleted'] as const

export const issueSeenState = pgEnum('issue_seen_state', ISSUE_SEEN_STATES)

/**
 * The GitHub issue linked to each task (DD-001): the issue the GitHub issue creator (SC-060)
 * opens for a task once it is assigned to a repository, at most one for each task. The issue is
 * known by its repository and number, as people see it, and by GitHub's own id for it, which the
 * sub-issue and blocked-by relations name it by. The link stays when the task's project stops
 * pulling issues from the repository (FR-178); the GitHub planning mirror (SC-022) then leaves the
 * issue alone (FR-182).
 *
 * `milestone_number` is the GitHub milestone the planning mirror holds a fixed-date milestone's
 * date in (FR-089), once it has made one; null for any other task.
 *
 * `seen_state` and `seen_status` are what the GitHub change handler (SC-023) last took in of the
 * issue: its state, and the option of the configured Projects status field it was in (SRC-252),
 * null for none. The handler acts on a change from what it last took in, not on what the issue
 * is, so that a status set in the tool is not set back from an issue GitHub has not changed.
 */
export const taskIssues = pgTable(
  'task_issues',
  {
    taskId: uuid('task_id')
      .primaryKey()
      .references(() => tasks.id),
    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id),
    number: integer('number').notNull(),
    githubId: bigint('github_id', { mode: 'number' }).notNull(),
    milestoneNumber: integer('milestone_number'),
    seenState: issueSeenState('seen_state').notNull().default('open'),
    seenStatus: text('seen_status'),
  },
  (table) => [
    uniqueIndex('task_issues_repository_number_key').on(table.repositoryId, table.number),
    uniqueIndex('task_issues_github_id_key').on(table.githubId),
  ],
)
