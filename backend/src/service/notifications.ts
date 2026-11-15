import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { Database, Executor } from '../db/client.ts'
import {
  accounts,
  groupMembers,
  groupProjects,
  issueSubscriptions,
  NOTIFICATION_KINDS,
  notifications,
  projectMembers,
  projects,
  projectSubscriptions,
  repositories,
  repositoryAdmins,
  taskIssues,
  tasks,
} from '../db/schema.ts'
import type { GitHubFunction } from '../config/config.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import { allows } from './permissions.ts'
import { highestRole, type ProjectRole, type ProjectRoleService } from './project-roles.ts'
import type { FoundFlag, RedFlagKind } from './red-flags.ts'
import { isUuid } from './system-admins.ts'

/** What a notification is about (SC-012). */
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/** A task a notification names, or `null` where the reader cannot read its project (FR-017). */
export type NotifiedTask = { id: string; projectId: string } | null

/**
 * A notification as its reader gets it. `detail` is what it tells, by its kind:
 *
 * - `red-flag`: a new red flag (FR-083, FR-084): `flagKind`, the projects it is raised in
 *   (`projectIds`), and what the red flag register gives for it (`accountId` and `date` of an
 *   overload; `task`, `overloads` and `holiday` of a task its assigned people cannot do in its
 *   time; `task`, `blocker`, `crossProject`, `start` and `blockerFinish` of a violation).
 * - `proposal-waiting`: a proposal waiting for review (FR-085): `proposalId` and the projects it
 *   changes (`projectIds`).
 * - `repository-request`: a project's request for a repository (FR-173): `requestId`, `project`
 *   (`id`, `name`), `repository` (`id`, `owner`, `name`) and `requestedBy` (`accountId`,
 *   `username`).
 * - `token-refused`: GitHub refused the personal access token of a GitHub function as expired or
 *   revoked (FR-186): `function`.
 * - `github-revert`: a change made on GitHub that the tool reverted (FR-086): the `task` whose
 *   issue it is, the issue (`repository`, with `id`, `owner` and `name`, and `number`), what was
 *   reverted (`change`, a `RevertedChange`) and, for planning, which parts (`parts`).
 *
 * A project the reader cannot read is left out of `projectIds`, and a task of one is given as
 * `null`, so that a notification tells nothing of a project not visible to its reader (FR-017).
 */
export interface Notification {
  id: string
  kind: NotificationKind
  createdAt: Date
  detail: Record<string, unknown>
}

/** A project the person is subscribed to, and whether their role subscribes them (FR-134). */
export interface ProjectSubscription {
  projectId: string
  name: string
  /** Subscribed by their read-write or admin role in it, not by hand. */
  automatic: boolean
}

/** An issue the person subscribed to (FR-133): the GitHub issue linked to a task. */
export interface IssueSubscription {
  taskId: string
  projectId: string
  repository: { id: string; owner: string; name: string }
  number: number
}

export interface Subscriptions {
  projects: ProjectSubscription[]
  issues: IssueSubscription[]
}

/** One notification to be written: who gets it, and what it tells. */
interface Outgoing {
  accountId: string
  kind: NotificationKind
  detail: Record<string, unknown>
}

async function deliver(executor: Executor, outgoing: readonly Outgoing[]): Promise<void> {
  // In chunks well below PostgreSQL's limit on parameters.
  for (let i = 0; i < outgoing.length; i += 1000) {
    await executor.insert(notifications).values(outgoing.slice(i, i + 1000))
  }
}

/**
 * Each person's highest role in each of the projects (FR-112), directly or through groups
 * (FR-111): project id → account id → role. Someone holding no role in a project is not in its
 * map.
 */
async function rolesIn(
  executor: Executor,
  projectIds: Iterable<string>,
): Promise<Map<string, Map<string, ProjectRole>>> {
  const ids = [...new Set(projectIds)]
  const result = new Map<string, Map<string, ProjectRole>>()
  if (ids.length === 0) return result
  const direct = await executor
    .select({
      projectId: projectMembers.projectId,
      accountId: projectMembers.accountId,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .where(inArray(projectMembers.projectId, ids))
  const throughGroups = await executor
    .select({
      projectId: groupProjects.projectId,
      accountId: groupMembers.accountId,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .innerJoin(groupProjects, eq(groupProjects.groupId, groupMembers.groupId))
    .where(inArray(groupProjects.projectId, ids))
  for (const { projectId, accountId, role } of [...direct, ...throughGroups]) {
    let roles = result.get(projectId)
    if (!roles) result.set(projectId, (roles = new Map()))
    const held = roles.get(accountId)
    roles.set(accountId, held === undefined ? role : (highestRole([held, role]) ?? role))
  }
  return result
}

/** Whether the role subscribes its holder to the project by itself (FR-134). */
function subscribesByRole(role: ProjectRole | undefined): boolean {
  return role === 'read-write' || role === 'admin'
}

/**
 * Everyone subscribed to each of the projects, who can still read it: those who subscribed by
 * hand (FR-133) and everyone with the read-write or admin role in it (FR-134).
 */
async function projectSubscribers(
  executor: Executor,
  projectIds: readonly string[],
  roles: Map<string, Map<string, ProjectRole>>,
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>()
  for (const projectId of projectIds) {
    const set = new Set<string>()
    for (const [accountId, role] of roles.get(projectId) ?? []) {
      if (subscribesByRole(role)) set.add(accountId)
    }
    result.set(projectId, set)
  }
  if (projectIds.length === 0) return result
  const rows = await executor
    .select({
      accountId: projectSubscriptions.accountId,
      projectId: projectSubscriptions.projectId,
    })
    .from(projectSubscriptions)
    .where(inArray(projectSubscriptions.projectId, [...projectIds]))
  for (const { accountId, projectId } of rows) {
    if (roles.get(projectId)?.has(accountId)) result.get(projectId)?.add(accountId)
  }
  return result
}

/** The tasks a red flag is about, as its detail names them. */
function tasksOf(flag: FoundFlag): { id: string; projectId: string }[] {
  if (flag.kind === 'overload') return []
  if (flag.kind === 'assignee-unavailable') return [flag.detail.task]
  return [flag.detail.task, flag.detail.blocker]
}

/**
 * Notifies of each new red flag (FR-083) the people subscribed to the projects it is raised in or
 * to the issues of the tasks it is about (FR-162), and, of a task depending on another project's
 * milestone that now lies after its start, the admins of both projects as well (FR-084). The red
 * flag register calls it with the flags each refresh raises, in the refresh's transaction, so a
 * change that is rolled back notifies no one.
 *
 * A red flag found in several projects at once (an overload, a violation across a project
 * boundary) is one notification to each person. A subscriber is notified only if they can read
 * every project whose task the flag names, as the register shows a violation across a project
 * boundary only to those who can read both (FR-059); the admins FR-084 names are notified
 * whatever they can read, and their notification leaves out what they cannot read.
 */
export async function notifyNewRedFlags(
  executor: Executor,
  raised: readonly FoundFlag[],
): Promise<void> {
  if (raised.length === 0) return
  const byKey = new Map<string, { flag: FoundFlag; projectIds: string[] }>()
  for (const flag of raised) {
    const found = byKey.get(flag.key)
    if (found) {
      if (!found.projectIds.includes(flag.projectId)) found.projectIds.push(flag.projectId)
    } else byKey.set(flag.key, { flag, projectIds: [flag.projectId] })
  }
  const groups = [...byKey.values()]
  const flagged = groups.flatMap((group) => group.projectIds)
  const named = groups.flatMap((group) => tasksOf(group.flag))
  const roles = await rolesIn(executor, [...flagged, ...named.map((task) => task.projectId)])
  const subscribers = await projectSubscribers(executor, [...new Set(flagged)], roles)
  const taskIds = [...new Set(named.map((task) => task.id))]
  const issueRows =
    taskIds.length === 0
      ? []
      : await executor
          .select({ accountId: issueSubscriptions.accountId, taskId: issueSubscriptions.taskId })
          .from(issueSubscriptions)
          .where(inArray(issueSubscriptions.taskId, taskIds))
  const reads = (accountId: string, projectId: string) => roles.get(projectId)?.has(accountId)

  const outgoing: Outgoing[] = []
  for (const { flag, projectIds } of groups) {
    const about = tasksOf(flag)
    const candidates = new Set<string>()
    for (const projectId of projectIds) {
      for (const accountId of subscribers.get(projectId) ?? []) candidates.add(accountId)
    }
    for (const { accountId, taskId } of issueRows) {
      if (about.some((task) => task.id === taskId)) candidates.add(accountId)
    }
    const recipients = new Set(
      [...candidates].filter((accountId) =>
        about.every((task) => reads(accountId, task.projectId)),
      ),
    )
    if (flag.kind === 'cross-project-dependency') {
      for (const task of about) {
        for (const [accountId, role] of roles.get(task.projectId) ?? []) {
          if (role === 'admin') recipients.add(accountId)
        }
      }
    }
    const detail = { flagKind: flag.kind satisfies RedFlagKind, projectIds, ...flag.detail }
    for (const accountId of recipients) outgoing.push({ accountId, kind: 'red-flag', detail })
  }
  await deliver(executor, outgoing)
}

/**
 * Notifies the people who can review a proposal now waiting for review (FR-085): everyone whose
 * role in a project it changes is read-write or admin, who may handle its proposals (FR-108,
 * DD-025). The proposal store calls it in the transaction that creates the proposal.
 */
export async function notifyProposalWaiting(
  executor: Executor,
  proposalId: string,
  projectIds: readonly string[],
): Promise<void> {
  const roles = await rolesIn(executor, projectIds)
  const recipients = new Set<string>()
  for (const projectId of projectIds) {
    for (const [accountId, role] of roles.get(projectId) ?? []) {
      if (allows(role, 'handle-proposals')) recipients.add(accountId)
    }
  }
  const detail = { proposalId, projectIds: [...projectIds] }
  await deliver(
    executor,
    [...recipients].map((accountId) => ({ accountId, kind: 'proposal-waiting', detail })),
  )
}

/**
 * What change made on GitHub the tool reverted (SC-023, SC-022): a close (`close`), a deletion
 * (`delete`, the issue is created again), a reopening (`reopen`), a close as not planned
 * (`not-planned`), a move to the started option (`start`), or an edit of the issue's planning
 * (`planning`).
 */
export type RevertedChange = 'close' | 'delete' | 'reopen' | 'not-planned' | 'start' | 'planning'

/** The parts of an issue's planning the planning mirror sets back (FR-097). */
export type PlanningPart = 'assignees' | 'milestone' | 'parent' | 'blocked-by'

/** A change the tool reverted on a task's issue, as its notification tells it (FR-086). */
export interface RevertNotice {
  task: { id: string; projectId: string }
  repository: { id: string; owner: string; name: string }
  /** The issue's number: for a deleted issue, the number of the one created in its place. */
  number: number
  change: RevertedChange
  /** For `planning`, the parts set back. */
  parts?: readonly PlanningPart[]
}

/**
 * Notifies of a change the tool reverted on GitHub (FR-086) the people subscribed to the task's
 * issue or to its project (FR-162), who can read the project: those subscribed by hand (FR-133)
 * and everyone with the read-write or admin role in it (FR-134). The GitHub revert commenter
 * (SC-062) calls it once the revert is made.
 */
export async function notifyGitHubRevert(executor: Executor, revert: RevertNotice): Promise<void> {
  const { projectId } = revert.task
  const roles = await rolesIn(executor, [projectId])
  const recipients = new Set(
    (await projectSubscribers(executor, [projectId], roles)).get(projectId),
  )
  const issueRows = await executor
    .select({ accountId: issueSubscriptions.accountId })
    .from(issueSubscriptions)
    .where(eq(issueSubscriptions.taskId, revert.task.id))
  for (const { accountId } of issueRows) {
    if (roles.get(projectId)?.has(accountId)) recipients.add(accountId)
  }
  const detail: Record<string, unknown> = {
    task: revert.task,
    repository: revert.repository,
    number: revert.number,
    change: revert.change,
    ...(revert.parts === undefined ? {} : { parts: [...revert.parts] }),
  }
  await deliver(
    executor,
    [...recipients].map((accountId) => ({ accountId, kind: 'github-revert', detail })),
  )
}

/** A project's request for a repository, as its notification tells it (FR-173). */
export interface RepositoryRequestNotice {
  requestId: string
  project: { id: string; name: string }
  repository: { id: string; owner: string; name: string }
  requestedBy: { accountId: string; username: string }
}

/**
 * Notifies every admin of the repository of a project's request to add it, waiting for one of
 * them (FR-173). The project repository approvals call it in the transaction that makes the
 * request.
 */
export async function notifyRepositoryRequest(
  executor: Executor,
  request: RepositoryRequestNotice,
): Promise<void> {
  const admins = await executor
    .select({ accountId: repositoryAdmins.accountId })
    .from(repositoryAdmins)
    .where(eq(repositoryAdmins.repositoryId, request.repository.id))
  const detail = { ...request }
  await deliver(
    executor,
    admins.map(({ accountId }) => ({ accountId, kind: 'repository-request', detail })),
  )
}

/** The projects of these kinds' notifications are hidden from a reader who cannot read them. */
function shownTo(detail: Record<string, unknown>, readable: ReadonlySet<string>) {
  const shown: Record<string, unknown> = { ...detail }
  if (Array.isArray(detail.projectIds)) {
    shown.projectIds = detail.projectIds.filter(
      (id): id is string => typeof id === 'string' && readable.has(id),
    )
  }
  for (const field of ['task', 'blocker'] as const) {
    const task: unknown = detail[field]
    if (typeof task === 'object' && task !== null && 'projectId' in task) {
      const { projectId } = task
      shown[field] = typeof projectId === 'string' && readable.has(projectId) ? task : null
    }
  }
  return shown
}

/**
 * The notification module of the service layer (SC-012, DD-039). It delivers notifications in the
 * app only, never by email, Slack or any other outside channel (FR-082, DD-003): a notification is
 * a row for its reader, written in the transaction of the change that causes it, and read through
 * the app, the REST API or the MCP server (FR-087). It keeps the subscriptions people make to
 * projects and issues (FR-133), besides the subscription of everyone with the read-write or admin
 * role in a project to that project (FR-134), and sends each subscriber the notifications for what
 * they subscribed to (FR-162). It offers no way to ask another project for a change; the owners
 * get the notification only (FR-155, DD-012).
 */
export class NotificationService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService
  /** The GitHub functions whose refused token the system admins were notified of since the start. */
  readonly #refusedTokens = new Set<GitHubFunction>()

  constructor(db: Database, audit: AuditLogService, roles: ProjectRoleService) {
    this.#db = db
    this.#audit = audit
    this.#roles = roles
  }

  /**
   * The caller's notifications, newest first. Reading them leaves them in place. What a
   * notification names of a project the caller cannot read is left out (FR-017).
   */
  async notificationsOf(caller: Caller): Promise<Notification[]> {
    if (!isUuid(caller.accountId)) return []
    const rows = await this.#db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        createdAt: notifications.createdAt,
        detail: notifications.detail,
      })
      .from(notifications)
      .where(eq(notifications.accountId, caller.accountId))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
    if (rows.length === 0) return []
    const readable = await this.#roles.readableProjects(caller.accountId)
    return rows.map((row) => ({ ...row, detail: shownTo(row.detail, readable) }))
  }

  /**
   * The projects and issues the caller is subscribed to: the projects they subscribed to by hand
   * and those their read-write or admin role subscribes them to (FR-134), and the issues they
   * subscribed to, each only while they can read its project.
   */
  async subscriptionsOf(caller: Caller): Promise<Subscriptions> {
    if (!isUuid(caller.accountId)) return { projects: [], issues: [] }
    const roles = await this.#rolesOf(caller.accountId)
    const byHand = await this.#db
      .select({ projectId: projectSubscriptions.projectId })
      .from(projectSubscriptions)
      .where(eq(projectSubscriptions.accountId, caller.accountId))
    const subscribed = new Map<string, boolean>()
    for (const [projectId, role] of roles) {
      if (subscribesByRole(role)) subscribed.set(projectId, true)
    }
    for (const { projectId } of byHand) {
      if (roles.has(projectId) && !subscribed.has(projectId)) subscribed.set(projectId, false)
    }
    const names =
      subscribed.size === 0
        ? []
        : await this.#db
            .select({ id: projects.id, name: projects.name })
            .from(projects)
            .where(inArray(projects.id, [...subscribed.keys()]))
    const projectList = names
      .map(({ id, name }) => ({ projectId: id, name, automatic: subscribed.get(id) ?? false }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.projectId.localeCompare(b.projectId))
    const issueRows = await this.#db
      .select({
        taskId: issueSubscriptions.taskId,
        projectId: tasks.projectId,
        repositoryId: repositories.id,
        owner: repositories.owner,
        name: repositories.name,
        number: taskIssues.number,
      })
      .from(issueSubscriptions)
      .innerJoin(taskIssues, eq(taskIssues.taskId, issueSubscriptions.taskId))
      .innerJoin(tasks, eq(tasks.id, issueSubscriptions.taskId))
      .innerJoin(repositories, eq(repositories.id, taskIssues.repositoryId))
      .where(eq(issueSubscriptions.accountId, caller.accountId))
      .orderBy(asc(repositories.owner), asc(repositories.name), asc(taskIssues.number))
    return {
      projects: projectList,
      issues: issueRows
        .filter((row) => roles.has(row.projectId))
        .map(({ taskId, projectId, repositoryId, owner, name, number }) => ({
          taskId,
          projectId,
          repository: { id: repositoryId, owner, name },
          number,
        })),
    }
  }

  /**
   * Subscribes the caller to the project (FR-133), for anyone with a role in it; refused as not
   * visible to anyone else (FR-017). Subscribing again, or to a project their role already
   * subscribes them to, changes nothing. Their role is left as it is.
   */
  async subscribeToProject(caller: Caller, projectId: string): Promise<void> {
    await this.#db.transaction(async (tx) => {
      await this.#roles.permissions.require(caller, projectId, 'read', tx)
      const added = await tx
        .insert(projectSubscriptions)
        .values({ accountId: caller.accountId, projectId })
        .onConflictDoNothing()
        .returning({ projectId: projectSubscriptions.projectId })
      if (added.length === 0) return
      await this.#audit.record(tx, caller, {
        action: 'subscription.project-added',
        subject: { type: 'project', id: projectId },
      })
    })
  }

  /**
   * Ends the caller's subscription to the project made by hand. Refused as not visible to someone
   * with no role in it (FR-017); as a conflict while their read-write or admin role subscribes
   * them to it (FR-134); and as not found if they are not subscribed to it.
   */
  async unsubscribeFromProject(caller: Caller, projectId: string): Promise<void> {
    await this.#db.transaction(async (tx) => {
      await this.#roles.permissions.require(caller, projectId, 'read', tx)
      const role = await this.#roles.roleOf(caller.accountId, projectId, tx)
      if (subscribesByRole(role)) {
        throw new ServiceError(
          'conflict',
          'Everyone with the read-write or admin role in a project is subscribed to it',
        )
      }
      const removed = await tx
        .delete(projectSubscriptions)
        .where(
          and(
            eq(projectSubscriptions.accountId, caller.accountId),
            eq(projectSubscriptions.projectId, projectId),
          ),
        )
        .returning({ projectId: projectSubscriptions.projectId })
      if (removed.length === 0) {
        throw new ServiceError('not-found', 'You are not subscribed to this project')
      }
      await this.#audit.record(tx, caller, {
        action: 'subscription.project-removed',
        subject: { type: 'project', id: projectId },
      })
    })
  }

  /**
   * Subscribes the caller to the GitHub issue linked to the task (FR-133), for anyone with a role
   * in its project. Refused as not found if there is no such task, or it has no issue; as not
   * visible to someone with no role in its project (FR-017). Subscribing again changes nothing; it
   * does not subscribe them to the project.
   */
  async subscribeToIssue(caller: Caller, taskId: string): Promise<void> {
    await this.#db.transaction(async (tx) => {
      await this.#requireIssue(tx, caller, taskId)
      const added = await tx
        .insert(issueSubscriptions)
        .values({ accountId: caller.accountId, taskId })
        .onConflictDoNothing()
        .returning({ taskId: issueSubscriptions.taskId })
      if (added.length === 0) return
      await this.#audit.record(tx, caller, {
        action: 'subscription.issue-added',
        subject: { type: 'task', id: taskId },
      })
    })
  }

  /**
   * Ends the caller's subscription to the task's issue. Refused as `subscribeToIssue` is, and as
   * not found if they are not subscribed to it.
   */
  async unsubscribeFromIssue(caller: Caller, taskId: string): Promise<void> {
    await this.#db.transaction(async (tx) => {
      await this.#requireIssue(tx, caller, taskId)
      const removed = await tx
        .delete(issueSubscriptions)
        .where(
          and(
            eq(issueSubscriptions.accountId, caller.accountId),
            eq(issueSubscriptions.taskId, taskId),
          ),
        )
        .returning({ taskId: issueSubscriptions.taskId })
      if (removed.length === 0) {
        throw new ServiceError('not-found', 'You are not subscribed to this issue')
      }
      await this.#audit.record(tx, caller, {
        action: 'subscription.issue-removed',
        subject: { type: 'task', id: taskId },
      })
    })
  }

  /**
   * Notifies every system admin that GitHub refused the personal access token given for the
   * function as expired or revoked (FR-186, DD-060). The GitHub client tells of each refusal; the
   * function then stops working until the tool is restarted with a new token, and its later calls
   * are refused without asking GitHub, so the system admins are notified once for each function
   * from the start, of the first refusal.
   */
  async notifyTokenRefused(fn: GitHubFunction): Promise<void> {
    if (this.#refusedTokens.has(fn)) return
    this.#refusedTokens.add(fn)
    try {
      const admins = await this.#db
        .select({ accountId: accounts.id })
        .from(accounts)
        .where(eq(accounts.systemAdmin, true))
      await deliver(
        this.#db,
        admins.map(({ accountId }) => ({
          accountId,
          kind: 'token-refused',
          detail: { function: fn },
        })),
      )
    } catch (error) {
      // Not delivered: the next refusal tries again.
      this.#refusedTokens.delete(fn)
      throw error
    }
  }

  /** The caller's highest role in each project they hold one in, directly or through groups. */
  async #rolesOf(accountId: string): Promise<Map<string, ProjectRole>> {
    const direct = await this.#db
      .select({ projectId: projectMembers.projectId, role: projectMembers.role })
      .from(projectMembers)
      .where(eq(projectMembers.accountId, accountId))
    const throughGroups = await this.#db
      .select({ projectId: groupProjects.projectId, role: groupMembers.role })
      .from(groupMembers)
      .innerJoin(groupProjects, eq(groupProjects.groupId, groupMembers.groupId))
      .where(eq(groupMembers.accountId, accountId))
    const held = new Map<string, ProjectRole[]>()
    for (const { projectId, role } of [...direct, ...throughGroups]) {
      held.set(projectId, [...(held.get(projectId) ?? []), role])
    }
    const result = new Map<string, ProjectRole>()
    for (const [projectId, roles] of held) {
      const role = highestRole(roles)
      if (role !== undefined) result.set(projectId, role)
    }
    return result
  }

  async #requireIssue(tx: Executor, caller: Caller, taskId: string): Promise<void> {
    const [task] = isUuid(taskId)
      ? await tx
          .select({ projectId: tasks.projectId, issue: taskIssues.number })
          .from(tasks)
          .leftJoin(taskIssues, eq(taskIssues.taskId, tasks.id))
          .where(eq(tasks.id, taskId))
      : []
    if (!task) throw new ServiceError('not-found', 'There is no such task')
    await this.#roles.permissions.require(caller, task.projectId, 'read', tx)
    if (task.issue === null) {
      throw new ServiceError('not-found', 'The task has no GitHub issue to subscribe to')
    }
  }
}
