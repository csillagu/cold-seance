import { and, eq, sql } from 'drizzle-orm'
import type { Database, Transaction } from '../db/client.ts'
import { projectRepositoryRequests, taskIssues, tasks } from '../db/schema.ts'
import type { ISSUE_SEEN_STATES } from '../db/schema.ts'
import type { AuditLogService, GitHubUser } from './audit.ts'
import { lockPlan, PlanScheduling } from './plan-scheduling.ts'
import type { ProjectRepositoryService } from './project-repositories.ts'
import type { ReceivingProjectService } from './receiving-projects.ts'
import { refreshRedFlags } from './red-flags.ts'
import { localToday } from './task-status.ts'

/**
 * The class of the transaction-level advisory locks on a repository's issue links; the
 * repository's id picks the lock within it. A two-key lock, so that it never meets the one-key
 * locks.
 */
const ISSUE_LINKS_LOCK_CLASS = 0x5c_00_23

/**
 * Takes the lock on the repository's issue links until the transaction ends. Whoever creates an
 * issue for a task and links it (SC-060, SC-023) holds it from before the issue is created until
 * the link is stored, and whoever turns a new issue into a task holds it while it checks that the
 * issue is linked to no task: so an issue the tool itself opened is never taken for a new one.
 */
export async function lockIssueLinks(tx: Transaction, repositoryId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${ISSUE_LINKS_LOCK_CLASS}::integer, hashtext(${repositoryId}))`,
  )
}

/** A new issue opened on GitHub, as the GitHub change handler (SC-023) read it. */
export interface NewIssue {
  repositoryId: string
  number: number
  /** GitHub's own id for the issue. */
  githubId: number
  title: string
}

/**
 * An issue the re-check (SC-024) found that no task is linked to (FR-214), as the GitHub change
 * handler read it from its repository's list of issues.
 */
export interface FoundIssue extends NewIssue {
  /** When it was opened, as GitHub records it. */
  openedAt: Date
  /** Open, closed (as completed, or for any reason but not planned), or closed as not planned. */
  state: Exclude<(typeof ISSUE_SEEN_STATES)[number], 'deleted'>
  /** When it was closed, as GitHub records it; null for an open issue. */
  closedAt: Date | null
}

/**
 * Whether an issue opened at `openedAt` was opened since `since`. GitHub records when an issue was
 * opened to the whole second, so `since` is taken to the whole second too: an issue opened in the
 * second its repository was given to a project was opened since.
 */
export function openedSince(openedAt: Date, since: Date): boolean {
  return openedAt.getTime() >= wholeSecond(since).getTime()
}

/** The time, to the whole second below it. */
export function wholeSecond(time: Date): Date {
  return new Date(Math.floor(time.getTime() / 1000) * 1000)
}

/** The title of a task made from an issue whose title is blank. */
export const UNTITLED_ISSUE_TITLE = 'Untitled issue'

/**
 * The tasks the service layer makes from new GitHub issues (DD-039, SC-023): each issue opened in
 * a repository is added, as an unscheduled task linked to it, to the repository's receiving
 * project (FR-100, FR-157), whoever opened it, as long as that project still pulls issues from the
 * repository; once it has stopped pulling, the issue goes to no project (SRC-215). A repository
 * with no receiving project sends its new issues to the one project that pulls from it, if only
 * one does (FR-100), and to none while several do (FR-157). The task has the issue's title and nothing else: no planned dates, no duration and
 * no assigned people, whatever the issue holds on GitHub (FR-156). It is assigned to the
 * repository, so that it is synced with its issue as a task assigned there in the tool is.
 *
 * An issue the re-check found that no task is linked to is added the same way (FR-214, SRC-297),
 * but only if it was opened since the receiving project was given the repository, that is since
 * its request for the repository was approved; older issues are left to seeding. One already
 * closed is added as a done task, whatever the reason it was closed, with the day it was closed,
 * in the backend's time zone, as its actual finish, as seeding does (FR-104).
 *
 * The creation is recorded in the audit log under the GitHub login of whoever opened the issue
 * (SRC-251, SRC-253), through the GitHub channel.
 */
export class GitHubIssueTaskService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #repositories: ProjectRepositoryService
  readonly #receiving: ReceivingProjectService
  readonly #scheduling: PlanScheduling

  constructor(
    db: Database,
    audit: AuditLogService,
    repositories: ProjectRepositoryService,
    receiving: ReceivingProjectService,
  ) {
    this.#db = db
    this.#audit = audit
    this.#repositories = repositories
    this.#receiving = receiving
    this.#scheduling = new PlanScheduling(audit)
  }

  /**
   * Adds the new issue to its repository's receiving project as an unscheduled task linked to
   * it, and answers the task's id; answers null, changing nothing, if the issue is linked to a
   * task already, or no project is to receive it.
   */
  createFromIssue(user: GitHubUser, issue: NewIssue): Promise<string | null> {
    return this.#create(user, issue)
  }

  /**
   * Adds the issue the re-check found to its repository's receiving project, as an unscheduled
   * task if it is open and a done one if it is closed, and answers the task's id; answers null,
   * changing nothing, if the issue is linked to a task already, no project is to receive it, or
   * it was opened before that project was given the repository.
   */
  createFromFoundIssue(user: GitHubUser, issue: FoundIssue): Promise<string | null> {
    return this.#create(user, issue, issue)
  }

  async #create(user: GitHubUser, issue: NewIssue, found?: FoundIssue): Promise<string | null> {
    return this.#db.transaction(async (tx) => {
      await lockIssueLinks(tx, issue.repositoryId)
      const [linked] = await tx
        .select({ taskId: taskIssues.taskId })
        .from(taskIssues)
        .where(eq(taskIssues.githubId, issue.githubId))
      if (linked) return null
      const projectId =
        (await this.#receiving.receivingProjectOf(issue.repositoryId, {
          executor: tx,
          lock: true,
        })) ?? (await soleProject(tx, issue.repositoryId))
      if (projectId === null) return null
      const pulls = await this.#repositories.pulls(projectId, issue.repositoryId, {
        executor: tx,
        lock: true,
      })
      if (!pulls) return null
      if (found !== undefined) {
        const since = await approvedAt(tx, projectId, issue.repositoryId)
        if (since === null || !openedSince(found.openedAt, since)) return null
      }

      await lockPlan(tx, projectId)
      const title = issue.title.normalize('NFC').trim() || UNTITLED_ISSUE_TITLE
      const done = found !== undefined && found.state !== 'open'
      const actualFinish = done ? localToday(found.closedAt ?? undefined) : null
      const [created] = await tx
        .insert(tasks)
        .values({
          projectId,
          title,
          repositoryId: issue.repositoryId,
          ...(done ? { status: 'done' as const, actualFinish } : {}),
        })
        .returning({ id: tasks.id })
      if (!created) throw new Error('The new task was not returned')
      await tx.insert(taskIssues).values({
        taskId: created.id,
        repositoryId: issue.repositoryId,
        number: issue.number,
        githubId: issue.githubId,
        ...(found !== undefined ? { seenState: found.state } : {}),
      })
      const cause = { action: 'task.created', taskId: created.id }
      await this.#scheduling.reschedule(tx, user, projectId, [created.id], cause, created.id)
      await refreshRedFlags(tx)
      await this.#audit.record(tx, user, {
        action: 'task.created',
        subject: { type: 'task', id: created.id },
        projectId,
        details: {
          title,
          repositoryId: issue.repositoryId,
          issueNumber: issue.number,
          ...(done ? { status: 'done', actualFinish } : {}),
        },
      })
      return created.id
    })
  }
}

/** The one project that pulls issues from the repository, or null if none or several do. */
async function soleProject(tx: Transaction, repositoryId: string): Promise<string | null> {
  const rows = await tx
    .select({ projectId: projectRepositoryRequests.projectId })
    .from(projectRepositoryRequests)
    .where(
      and(
        eq(projectRepositoryRequests.repositoryId, repositoryId),
        eq(projectRepositoryRequests.state, 'approved'),
      ),
    )
    .for('share')
  const [only] = rows
  return rows.length === 1 && only !== undefined ? only.projectId : null
}

/**
 * When the project's request for the repository was approved, so that the project pulls issues
 * from it; null if it does not.
 */
async function approvedAt(
  tx: Transaction,
  projectId: string,
  repositoryId: string,
): Promise<Date | null> {
  const [row] = await tx
    .select({ decidedAt: projectRepositoryRequests.decidedAt })
    .from(projectRepositoryRequests)
    .where(
      and(
        eq(projectRepositoryRequests.projectId, projectId),
        eq(projectRepositoryRequests.repositoryId, repositoryId),
        eq(projectRepositoryRequests.state, 'approved'),
      ),
    )
  return row?.decidedAt ?? null
}
