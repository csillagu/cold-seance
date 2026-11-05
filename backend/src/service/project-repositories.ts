import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Database, Executor } from '../db/client.ts'
import {
  accounts,
  PROJECT_REPOSITORY_STATES,
  projectRepositoryRequests,
  projects,
  repositories,
  repositoryAdmins,
} from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { violates } from './db-errors.ts'
import { notVisible, ServiceError } from './errors.ts'
import { lockRolesOn } from './groups.ts'
import type { ProjectRoleService } from './project-roles.ts'
import { isUuid } from './system-admins.ts'

/** What became of a project's request to add a repository, as the schema defines it. */
export type RepositoryRequestState = (typeof PROJECT_REPOSITORY_STATES)[number]

export { PROJECT_REPOSITORY_STATES }

/** Someone named on a request, by account and username. */
export interface RequestPerson {
  accountId: string
  username: string
}

/** A project's request to add a repository, as the service layer hands it out (SC-110). */
export interface RepositoryRequest {
  id: string
  project: { id: string; name: string }
  repository: { id: string; githubId: number; owner: string; name: string }
  state: RepositoryRequestState
  requestedBy: RequestPerson
  requestedAt: Date
  /** Who approved or rejected it; the requester, when they were admin of both. */
  decidedBy: RequestPerson | null
  decidedAt: Date | null
  /** Who withdrew the approval, while it is withdrawn. */
  withdrawnBy: RequestPerson | null
  withdrawnAt: Date | null
}

/** A repository a project pulls issues from (FR-142). */
export interface ProjectRepository {
  id: string
  githubId: number
  owner: string
  name: string
}

/** The unique index that keeps one open request or approval for each project and repository. */
const OPEN_INDEX = 'project_repository_requests_open_key'

const requester = alias(accounts, 'requester')
const decider = alias(accounts, 'decider')
const withdrawer = alias(accounts, 'withdrawer')

const requestColumns = {
  id: projectRepositoryRequests.id,
  projectId: projects.id,
  projectName: projects.name,
  repositoryId: repositories.id,
  githubId: repositories.githubId,
  owner: repositories.owner,
  name: repositories.name,
  state: projectRepositoryRequests.state,
  requestedById: requester.id,
  requestedByName: requester.username,
  requestedAt: projectRepositoryRequests.requestedAt,
  decidedById: decider.id,
  decidedByName: decider.username,
  decidedAt: projectRepositoryRequests.decidedAt,
  withdrawnById: withdrawer.id,
  withdrawnByName: withdrawer.username,
  withdrawnAt: projectRepositoryRequests.withdrawnAt,
} as const

/** The decisions a repository admin makes on a request, with the state each starts and ends in. */
const DECISIONS = {
  approve: { from: 'requested', to: 'approved', action: 'project-repository.approved' },
  reject: { from: 'requested', to: 'rejected', action: 'project-repository.rejected' },
  withdraw: { from: 'approved', to: 'withdrawn', action: 'project-repository.withdrawn' },
} as const satisfies Record<
  string,
  { from: RepositoryRequestState; to: RepositoryRequestState; action: string }
>

type Decision = keyof typeof DECISIONS

/** Why a decision is refused on a request in another state than the one it starts from. */
const WRONG_STATE: Record<Decision, string> = {
  approve: 'Only a request still waiting for a decision can be approved',
  reject: 'Only a request still waiting for a decision can be rejected',
  withdraw: 'Only an approval in force can be withdrawn',
}

/**
 * The project repository approvals (SC-110), the part of the service layer (DD-039) that keeps
 * which projects pull issues from which registered repositories. A project's admin sets the
 * repositories their project pulls issues from (FR-142) by asking to add each; the request takes
 * effect only once one of the repository's admins approves it, one admin being enough (FR-168),
 * and at once when the requester is admin of both the repository and the project (FR-170). Any of
 * the repository's admins can reject a request, which leaves the repository out of the project
 * (FR-171), or withdraw an approval given earlier (FR-172): from then on the project no longer
 * pulls from the repository (FR-181), and it keeps every task it already has from it (FR-178),
 * which this module never touches. Adding a repository covers both seeding the project from it and
 * pulling its issues (SRC-181), so one approval serves both. Each change is recorded in the audit
 * log in the same transaction, in the project's part of it (FR-116).
 *
 * A repository that is not registered has no admin and no id in the tool, so it cannot be asked
 * for (FR-168). A rejected request, or a withdrawn approval, stays as it is; the project may ask
 * again, which makes a new request. Whether the requester may take back a request, or the project
 * remove a repository itself, is not stated, so neither is offered.
 */
export class ProjectRepositoryService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService

  constructor(db: Database, audit: AuditLogService, roles: ProjectRoleService) {
    this.#db = db
    this.#audit = audit
    this.#roles = roles
  }

  /**
   * Asks to add the registered repository `repositoryId` to the project, for the project to pull
   * its issues and be seeded from it (FR-142, FR-168). Refused as not visible to someone with no
   * role in the project (FR-017), and as forbidden to a member who is not its admin (FR-109).
   * Refused as not found if no repository with that id is registered. Refused as a conflict while
   * the project already has the repository, or has a request for it waiting. The request waits for
   * one of the repository's admins, unless the caller is one of them, when it is approved at once
   * (FR-170).
   */
  async requestRepository(
    caller: Caller,
    projectId: string,
    repositoryId: string,
  ): Promise<RepositoryRequest> {
    try {
      return await this.#db.transaction(async (tx) => {
        const [project] = isUuid(projectId)
          ? await tx
              .select({ id: projects.id, name: projects.name })
              .from(projects)
              .where(eq(projects.id, projectId))
          : []
        // Whether or not it exists, as for any project the caller cannot see (FR-017).
        if (!project) throw notVisible()
        // The rows that give the caller their role are locked before it is checked, so that it
        // still holds when the request is made.
        await lockRolesOn(tx, caller.accountId, projectId)
        await this.#roles.permissions.require(caller, projectId, 'manage-project', tx)
        const [repository] = isUuid(repositoryId)
          ? await tx
              .select({ owner: repositories.owner, name: repositories.name })
              .from(repositories)
              .where(eq(repositories.id, repositoryId))
          : []
        if (!repository) {
          throw new ServiceError(
            'not-found',
            'There is no such registered repository: register it before adding it to a project',
          )
        }
        const fullName = `${repository.owner}/${repository.name}`
        const [open] = await tx
          .select({ state: projectRepositoryRequests.state })
          .from(projectRepositoryRequests)
          .where(
            and(
              eq(projectRepositoryRequests.projectId, projectId),
              eq(projectRepositoryRequests.repositoryId, repositoryId),
              inArray(projectRepositoryRequests.state, ['requested', 'approved']),
            ),
          )
        if (open) throw alreadyOpen(open.state, project.name, fullName)
        const atOnce = await this.#lockAdminRow(tx, repositoryId, caller.accountId)
        const [created] = await tx
          .insert(projectRepositoryRequests)
          .values({
            projectId,
            repositoryId,
            state: atOnce ? 'approved' : 'requested',
            requestedBy: caller.accountId,
            ...(atOnce ? { decidedBy: caller.accountId, decidedAt: sql`now()` } : {}),
          })
          .returning({ id: projectRepositoryRequests.id })
        if (!created) throw new Error('The new request was not returned')
        await this.#audit.record(tx, caller, {
          action: atOnce ? 'project-repository.added' : 'project-repository.requested',
          subject: { type: 'project-repository-request', id: created.id },
          projectId,
          details: { repositoryId, repository: fullName },
        })
        return this.#read(tx, created.id)
      })
    } catch (error) {
      if (violates(error, OPEN_INDEX)) {
        throw new ServiceError(
          'conflict',
          'This project already has this repository, or a request for it waiting',
        )
      }
      throw error
    }
  }

  /** Approves a waiting request (FR-168); allowed to any of the repository's admins. */
  async approveRequest(caller: Caller, requestId: string): Promise<RepositoryRequest> {
    return this.#decide(caller, requestId, 'approve')
  }

  /**
   * Rejects a waiting request, leaving the repository out of the project (FR-171); allowed to any
   * of the repository's admins. A rejected request can no longer be approved.
   */
  async rejectRequest(caller: Caller, requestId: string): Promise<RepositoryRequest> {
    return this.#decide(caller, requestId, 'reject')
  }

  /**
   * Withdraws an approval in force (FR-172); allowed to any of the repository's admins. The
   * project no longer pulls from the repository from then on (FR-181), and keeps its tasks from it
   * (FR-178).
   */
  async withdrawApproval(caller: Caller, requestId: string): Promise<RepositoryRequest> {
    return this.#decide(caller, requestId, 'withdraw')
  }

  /**
   * The repositories the project pulls issues from (FR-142), by owner and name: those with an
   * approval in force. Anyone with a role in the project may read them (FR-106); everyone else is
   * told the project is not visible to them (FR-017).
   */
  async listProjectRepositories(caller: Caller, projectId: string): Promise<ProjectRepository[]> {
    await this.#roles.permissions.require(caller, projectId, 'read')
    return this.#db
      .select({
        id: repositories.id,
        githubId: repositories.githubId,
        owner: repositories.owner,
        name: repositories.name,
      })
      .from(projectRepositoryRequests)
      .innerJoin(repositories, eq(repositories.id, projectRepositoryRequests.repositoryId))
      .where(
        and(
          eq(projectRepositoryRequests.projectId, projectId),
          eq(projectRepositoryRequests.state, 'approved'),
        ),
      )
      .orderBy(asc(repositories.owner), asc(repositories.name), asc(repositories.id))
  }

  /**
   * Every request the project has made for a repository, and what became of it, newest first, so
   * its members see which are still waiting. Read like the project's repositories.
   */
  async listProjectRequests(caller: Caller, projectId: string): Promise<RepositoryRequest[]> {
    await this.#roles.permissions.require(caller, projectId, 'read')
    return this.#list(this.#db, eq(projectRepositoryRequests.projectId, projectId))
  }

  /**
   * The requests for the repositories the caller is an admin of, newest first, or only those in
   * the state `state`: what they are to approve, reject or withdraw. A repository's admins see
   * every project's request for it, whether or not they hold a role in the project, since they
   * decide on it.
   */
  async listAdminRequests(caller: Caller, state?: string): Promise<RepositoryRequest[]> {
    if (state !== undefined && !isState(state)) {
      throw new ServiceError(
        'invalid',
        `A request's state is one of ${PROJECT_REPOSITORY_STATES.join(', ')}`,
      )
    }
    if (!isUuid(caller.accountId)) return []
    const administered = this.#db
      .select({ id: repositoryAdmins.repositoryId })
      .from(repositoryAdmins)
      .where(eq(repositoryAdmins.accountId, caller.accountId))
    return this.#list(
      this.#db,
      and(
        inArray(projectRepositoryRequests.repositoryId, administered),
        state === undefined ? undefined : eq(projectRepositoryRequests.state, state),
      ),
    )
  }

  /**
   * Whether the project pulls issues from the repository now: whether it has an approval in force
   * for it (FR-142, FR-181). The modules that add a repository's issues to a project, and those
   * that assign a task to a repository, ask this in their own transaction before they do. With
   * `lock`, the approval is locked until that transaction ends, so a withdrawal waits for it, and
   * no issue is added once the withdrawal is recorded.
   */
  async pulls(
    projectId: string,
    repositoryId: string,
    options: { executor?: Executor; lock?: boolean } = {},
  ): Promise<boolean> {
    if (!isUuid(projectId) || !isUuid(repositoryId)) return false
    const query = (options.executor ?? this.#db)
      .select({ id: projectRepositoryRequests.id })
      .from(projectRepositoryRequests)
      .where(
        and(
          eq(projectRepositoryRequests.projectId, projectId),
          eq(projectRepositoryRequests.repositoryId, repositoryId),
          eq(projectRepositoryRequests.state, 'approved'),
        ),
      )
    const rows = options.lock === true ? await query.for('share') : await query
    return rows.length > 0
  }

  async #decide(caller: Caller, requestId: string, decision: Decision): Promise<RepositoryRequest> {
    const { from, to, action } = DECISIONS[decision]
    return this.#db.transaction(async (tx) => {
      // The request's row is locked, so two admins deciding at once cannot both succeed.
      const [request] = isUuid(requestId)
        ? await tx
            .select({
              state: projectRepositoryRequests.state,
              projectId: projectRepositoryRequests.projectId,
              repositoryId: projectRepositoryRequests.repositoryId,
            })
            .from(projectRepositoryRequests)
            .where(eq(projectRepositoryRequests.id, requestId))
            .for('update')
        : []
      if (!request) throw new ServiceError('not-found', 'There is no such request')
      // The caller's admin row is locked too, so that they are still the repository's admin when
      // the decision is recorded.
      if (!(await this.#lockAdminRow(tx, request.repositoryId, caller.accountId))) {
        throw new ServiceError(
          'forbidden',
          "Only the repository's admins can approve, reject or withdraw a project's request for it",
        )
      }
      if (request.state !== from) throw new ServiceError('conflict', WRONG_STATE[decision])
      // The transaction's time, as the request's own time is.
      const now = sql`now()`
      await tx
        .update(projectRepositoryRequests)
        .set(
          decision === 'withdraw'
            ? { state: to, withdrawnBy: caller.accountId, withdrawnAt: now }
            : { state: to, decidedBy: caller.accountId, decidedAt: now },
        )
        .where(eq(projectRepositoryRequests.id, requestId))
      const decided = await this.#read(tx, requestId)
      await this.#audit.record(tx, caller, {
        action,
        subject: { type: 'project-repository-request', id: requestId },
        projectId: request.projectId,
        details: {
          repositoryId: request.repositoryId,
          repository: `${decided.repository.owner}/${decided.repository.name}`,
        },
      })
      return decided
    })
  }

  /**
   * Whether the account is an admin of the repository; if it is, its admin row is locked until the
   * transaction ends, so that removing it as admin waits.
   */
  async #lockAdminRow(tx: Executor, repositoryId: string, accountId: string): Promise<boolean> {
    if (!isUuid(accountId)) return false
    const rows = await tx
      .select({ accountId: repositoryAdmins.accountId })
      .from(repositoryAdmins)
      .where(
        and(
          eq(repositoryAdmins.repositoryId, repositoryId),
          eq(repositoryAdmins.accountId, accountId),
        ),
      )
      .for('share')
    return rows.length > 0
  }

  async #read(executor: Executor, requestId: string): Promise<RepositoryRequest> {
    const [request] = await this.#list(executor, eq(projectRepositoryRequests.id, requestId))
    if (!request) throw new Error('The request was not found')
    return request
  }

  async #list(executor: Executor, where: SQL | undefined): Promise<RepositoryRequest[]> {
    const rows = await executor
      .select(requestColumns)
      .from(projectRepositoryRequests)
      .innerJoin(projects, eq(projects.id, projectRepositoryRequests.projectId))
      .innerJoin(repositories, eq(repositories.id, projectRepositoryRequests.repositoryId))
      .innerJoin(requester, eq(requester.id, projectRepositoryRequests.requestedBy))
      .leftJoin(decider, eq(decider.id, projectRepositoryRequests.decidedBy))
      .leftJoin(withdrawer, eq(withdrawer.id, projectRepositoryRequests.withdrawnBy))
      .where(where)
      .orderBy(desc(projectRepositoryRequests.requestedAt), desc(projectRepositoryRequests.id))
    return rows.map((row) => ({
      id: row.id,
      project: { id: row.projectId, name: row.projectName },
      repository: {
        id: row.repositoryId,
        githubId: row.githubId,
        owner: row.owner,
        name: row.name,
      },
      state: row.state,
      requestedBy: { accountId: row.requestedById, username: row.requestedByName },
      requestedAt: row.requestedAt,
      decidedBy: person(row.decidedById, row.decidedByName),
      decidedAt: row.decidedAt,
      withdrawnBy: person(row.withdrawnById, row.withdrawnByName),
      withdrawnAt: row.withdrawnAt,
    }))
  }
}

function person(accountId: string | null, username: string | null): RequestPerson | null {
  return accountId === null || username === null ? null : { accountId, username }
}

function isState(value: string): value is RepositoryRequestState {
  return PROJECT_REPOSITORY_STATES.some((state) => state === value)
}

function alreadyOpen(state: RepositoryRequestState, project: string, repository: string) {
  return new ServiceError(
    'conflict',
    state === 'approved'
      ? `${project} already pulls issues from ${repository}`
      : `${project} has already asked to add ${repository}, and the request is waiting for one of its admins`,
  )
}
