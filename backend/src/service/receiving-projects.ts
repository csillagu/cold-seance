import { and, asc, eq, exists } from 'drizzle-orm'
import type { Database, Executor } from '../db/client.ts'
import {
  projectRepositoryRequests,
  projects,
  repositories,
  repositoryReceivingProjects,
} from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { notVisible, ServiceError } from './errors.ts'
import { lockRolesOn } from './groups.ts'
import type { ProjectRepository, ProjectRepositoryService } from './project-repositories.ts'
import type { ProjectRoleService } from './project-roles.ts'
import { isUuid } from './system-admins.ts'

/** Why a project cannot be marked as receiving for a repository it does not pull from (FR-143). */
export const NOT_PULLING_MESSAGE =
  'A project can be marked as receiving only for a repository it pulls issues from'

/** Why a second project cannot be marked while one is (FR-179). */
export const ALREADY_RECEIVING_MESSAGE =
  'Another project is already the receiving project of this repository; it must give the role up before another project can be marked'

/** Why a project that is not the receiving one cannot give the role up (FR-180). */
export const NOT_RECEIVING_MESSAGE = "This project is not the repository's receiving project"

/** A repository the project is the receiving project of (FR-143), as the service hands it out. */
export interface ReceivingRepository {
  repository: ProjectRepository
  /**
   * Whether the project still pulls issues from the repository. While it does not, it keeps the
   * role and no project receives the repository's new issues (SRC-215), until it gives it up.
   */
  pulls: boolean
}

const receivingColumns = {
  id: repositories.id,
  githubId: repositories.githubId,
  owner: repositories.owner,
  name: repositories.name,
} as const

/**
 * The receiving project register (SC-111), the part of the service layer (DD-039) that keeps, for
 * each repository, its one receiving project: the project that gets its new issues (FR-157). The
 * admin of a project that pulls issues from a repository marks that project as the repository's
 * receiving project (FR-143, SRC-178). While one is marked, marking another is refused and the
 * current one stays (FR-179, SRC-216), until the receiving project's admin gives the role up
 * (FR-180, SRC-218); anyone else's attempt to give it up is refused. Each change is recorded in
 * the audit log in the same transaction, in the project's part of it (FR-116).
 *
 * The role stays with a project that stops pulling from the repository, so that no project
 * receives its new issues from then on (SRC-215); it is still given up the same way. Not stated,
 * and awaiting the owner's answer: what an admin of the project marking it again is told (the
 * marking stands, unchanged); whether a project admin who is refused learns which project holds
 * the role (they do not, since that project may not be visible to them, FR-017); whether a system
 * admin, or a repository admin, may give the role up for the project (neither may, as SRC-218
 * names only the receiving project's admin); whether a project's admins should see if it still
 * pulls from a repository it receives for (they do, as `pulls`, so they can tell when it holds the
 * role without receiving anything).
 */
export class ReceivingProjectService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService
  readonly #projectRepositories: ProjectRepositoryService

  constructor(
    db: Database,
    audit: AuditLogService,
    roles: ProjectRoleService,
    projectRepositories: ProjectRepositoryService,
  ) {
    this.#db = db
    this.#audit = audit
    this.#roles = roles
    this.#projectRepositories = projectRepositories
  }

  /**
   * Marks the project as the receiving project of the repository `repositoryId` (FR-143), and
   * answers the marking. Refused as not visible to someone with no role in the project (FR-017),
   * and as forbidden to a member who is not its admin (SRC-178). Refused as invalid unless the
   * project pulls issues from the repository, and as a conflict while another project is the
   * repository's receiving project, which stays (FR-179). Marking the project that already is the
   * receiving one changes nothing.
   */
  async markReceiving(
    caller: Caller,
    projectId: string,
    repositoryId: string,
  ): Promise<ReceivingRepository> {
    const project = projectId.toLowerCase()
    const repository = repositoryId.toLowerCase()
    return this.#db.transaction(async (tx) => {
      await this.#requireAdmin(tx, caller, project)
      // The approval is locked until the marking is made, so a withdrawal waits for it.
      if (
        !(await this.#projectRepositories.pulls(project, repository, { executor: tx, lock: true }))
      ) {
        throw new ServiceError('invalid', NOT_PULLING_MESSAGE)
      }
      // Two markings at once: the second waits for the first, then finds the row it made. If that
      // row is given up before it is read, the repository has none again, so the marking is tried
      // once more.
      for (let attempt = 0; attempt < 2; attempt++) {
        const [inserted] = await tx
          .insert(repositoryReceivingProjects)
          .values({ repositoryId: repository, projectId: project })
          .onConflictDoNothing({ target: repositoryReceivingProjects.repositoryId })
          .returning({ projectId: repositoryReceivingProjects.projectId })
        if (inserted) break
        const current = await this.receivingProjectOf(repository, { executor: tx, lock: true })
        if (current === project) return this.#read(tx, project, repository)
        if (current !== null || attempt > 0) {
          throw new ServiceError('conflict', ALREADY_RECEIVING_MESSAGE)
        }
      }
      const marked = await this.#read(tx, project, repository)
      await this.#audit.record(tx, caller, {
        action: 'repository.receiving-marked',
        subject: { type: 'repository', id: repository },
        projectId: project,
        details: { repository: `${marked.repository.owner}/${marked.repository.name}` },
      })
      return marked
    })
  }

  /**
   * Gives up the project's role as the receiving project of the repository `repositoryId`
   * (FR-180): the repository then has none until a project is marked again. Refused as not
   * visible to someone with no role in the project (FR-017), as forbidden to a member who is not
   * its admin, and as a conflict unless the project is the repository's receiving project.
   */
  async giveUpReceiving(caller: Caller, projectId: string, repositoryId: string): Promise<void> {
    const project = projectId.toLowerCase()
    const repository = repositoryId.toLowerCase()
    await this.#db.transaction(async (tx) => {
      await this.#requireAdmin(tx, caller, project)
      // Locked for update: the role is about to be given up.
      const [current] = !isUuid(repository)
        ? []
        : await tx
            .select({ projectId: repositoryReceivingProjects.projectId })
            .from(repositoryReceivingProjects)
            .where(eq(repositoryReceivingProjects.repositoryId, repository))
            .for('update')
      if (current?.projectId !== project) {
        throw new ServiceError('conflict', NOT_RECEIVING_MESSAGE)
      }
      const given = await this.#read(tx, project, repository)
      await tx
        .delete(repositoryReceivingProjects)
        .where(eq(repositoryReceivingProjects.repositoryId, repository))
      await this.#audit.record(tx, caller, {
        action: 'repository.receiving-given-up',
        subject: { type: 'repository', id: repository },
        projectId: project,
        details: { repository: `${given.repository.owner}/${given.repository.name}` },
      })
    })
  }

  /**
   * The repositories the project is the receiving project of, by owner and name, with whether it
   * still pulls from each. Anyone with a role in the project may read them (FR-106); everyone else
   * is told the project is not visible to them (FR-017).
   */
  async listReceiving(caller: Caller, projectId: string): Promise<ReceivingRepository[]> {
    await this.#roles.permissions.require(caller, projectId, 'read')
    return this.#list(this.#db, projectId)
  }

  /**
   * The id of the repository's receiving project, or null while it has none. The module that adds
   * a repository's new issues to a project (SC-023) asks this in its own transaction, together
   * with whether that project still pulls from the repository (FR-157). With `lock`, the marking
   * is share-locked until that transaction ends, so that giving the role up waits for it while
   * other readers do not. A caller that also asks `pulls` with a lock may take the two locks in
   * either order: both are share locks, and neither a withdrawal nor a giving up takes the other.
   */
  async receivingProjectOf(
    repositoryId: string,
    options: { executor?: Executor; lock?: boolean } = {},
  ): Promise<string | null> {
    if (!isUuid(repositoryId)) return null
    const query = (options.executor ?? this.#db)
      .select({ projectId: repositoryReceivingProjects.projectId })
      .from(repositoryReceivingProjects)
      .where(eq(repositoryReceivingProjects.repositoryId, repositoryId))
    const [row] = options.lock === true ? await query.for('share') : await query
    return row?.projectId ?? null
  }

  /** Refuses anyone but the project's admins, with its role rows locked until the change is made. */
  async #requireAdmin(tx: Executor, caller: Caller, projectId: string): Promise<void> {
    const [project] = isUuid(projectId)
      ? await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId))
      : []
    // Whether or not it exists, as for any project the caller cannot see (FR-017).
    if (!project) throw notVisible()
    await lockRolesOn(tx, caller.accountId, projectId)
    await this.#roles.permissions.require(caller, projectId, 'manage-project', tx)
  }

  async #read(
    executor: Executor,
    projectId: string,
    repositoryId: string,
  ): Promise<ReceivingRepository> {
    const [found] = await this.#list(executor, projectId, repositoryId)
    if (!found) throw new Error('The marking was not found')
    return found
  }

  async #list(
    executor: Executor,
    projectId: string,
    repositoryId?: string,
  ): Promise<ReceivingRepository[]> {
    const pulling = executor
      .select({ id: projectRepositoryRequests.id })
      .from(projectRepositoryRequests)
      .where(
        and(
          eq(projectRepositoryRequests.projectId, repositoryReceivingProjects.projectId),
          eq(projectRepositoryRequests.repositoryId, repositoryReceivingProjects.repositoryId),
          eq(projectRepositoryRequests.state, 'approved'),
        ),
      )
    const rows = await executor
      .select({ ...receivingColumns, pulls: exists(pulling).mapWith(Boolean) })
      .from(repositoryReceivingProjects)
      .innerJoin(repositories, eq(repositories.id, repositoryReceivingProjects.repositoryId))
      .where(
        and(
          eq(repositoryReceivingProjects.projectId, projectId),
          repositoryId === undefined
            ? undefined
            : eq(repositoryReceivingProjects.repositoryId, repositoryId),
        ),
      )
      .orderBy(asc(repositories.owner), asc(repositories.name), asc(repositories.id))
    return rows.map((row) => ({
      repository: { id: row.id, githubId: row.githubId, owner: row.owner, name: row.name },
      pulls: row.pulls,
    }))
  }
}
