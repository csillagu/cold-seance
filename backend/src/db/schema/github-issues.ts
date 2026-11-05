// The GitHub issues linked to tasks (SC-022, SC-060).
import { bigint, integer, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { repositories, tasks } from './core.ts'

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
  },
  (table) => [
    uniqueIndex('task_issues_repository_number_key').on(table.repositoryId, table.number),
    uniqueIndex('task_issues_github_id_key').on(table.githubId),
  ],
)
