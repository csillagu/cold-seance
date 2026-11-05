import { and, asc, eq } from 'drizzle-orm'
import type { Database, Executor } from '../db/client.ts'
import {
  accounts,
  groupMembers,
  groupProjects,
  groups,
  projectMembers,
  projects,
} from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { violates } from './db-errors.ts'
import { notVisible, ServiceError } from './errors.ts'
import {
  type GroupRoles,
  isProjectRole,
  PROJECT_ROLES,
  type ProjectRole,
  type ProjectRoleService,
} from './project-roles.ts'
import { isUuid } from './system-admins.ts'
import { characters } from './text.ts'

/** A group as the service layer hands it out. */
export interface Group {
  id: string
  name: string
}

/** A member of a group, with the role they hold in it (SRC-139). */
export interface GroupMember {
  accountId: string
  username: string
  role: ProjectRole
}

/** A project in a group, as the service layer hands it out. */
export interface GroupProject {
  id: string
  name: string
}

/** The longest name a group can have, in characters, as for a project. */
export const GROUP_NAME_MAX_LENGTH = 200

const columns = { id: groups.id, name: groups.name } as const

/** The unique index that keeps group names apart (see the schema). */
const GROUP_NAME_INDEX = 'groups_name_key'

/** Why a change that would leave a group without an admin is refused (FR-160). */
const LAST_ADMIN = 'A group must keep at least one admin'

/** Why a change to a group's members is refused to a caller who has no account. */
const CHANGE_REFUSAL = "Only people with an account can change a group's members"

const memberColumns = {
  accountId: groupMembers.accountId,
  username: accounts.username,
  role: groupMembers.role,
} as const

/**
 * Group creation and listing (SC-018), the part of the service layer through which anyone logged
 * in creates a group (FR-121) and becomes its admin (FR-159), and which shows every group to
 * everyone (FR-122) (DD-039). A group and its creator's admin role are made in one transaction,
 * with its entry in the audit log (FR-116), so a group never exists without its admin.
 *
 * Group membership (SC-057) is the part through which a group's admins add members with a role,
 * change their roles and remove them (FR-124), and a member leaves (FR-125), never leaving the
 * group without an admin (FR-160). Each change is recorded in the audit log in the same
 * transaction as the change.
 *
 * Group project assignment (SC-058) is the part through which projects are added to a group:
 * a new project by anyone, as it is created, and an existing one only by its admin (FR-123). Each
 * addition is recorded in the audit log in the same transaction as the addition.
 *
 * A group gives no one any role on a project by being seen: the roles a group gives come only
 * from its members and its projects (FR-111), as `groupRoles` answers them.
 */
export class GroupService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService

  constructor(db: Database, audit: AuditLogService, roles: ProjectRoleService) {
    this.#db = db
    this.#audit = audit
    this.#roles = roles
  }

  /**
   * Creates a group with the given name and makes the caller its admin, its only member. Refused
   * unless the caller has an account; refused if the name is empty or too long, or if another
   * group already has it.
   */
  async createGroup(caller: Caller, group: { name: string }): Promise<Group> {
    await this.#requireAccount(caller, 'Only people with an account can create a group')
    // In one Unicode form, so that the same name typed two ways is one name.
    const name = group.name.normalize('NFC').trim()
    if (name === '') throw new ServiceError('invalid', 'A group name is required')
    if (characters(name) > GROUP_NAME_MAX_LENGTH) {
      throw new ServiceError(
        'invalid',
        `A group name can have at most ${GROUP_NAME_MAX_LENGTH} characters`,
      )
    }
    // The unique index on names decides, so two concurrent creations of one name cannot both
    // succeed.
    try {
      return await this.#createInTransaction(caller, name)
    } catch (error) {
      if (violates(error, GROUP_NAME_INDEX)) {
        throw new ServiceError('conflict', `A group named ${name} already exists`)
      }
      throw error
    }
  }

  async #createInTransaction(caller: Caller, name: string): Promise<Group> {
    return this.#db.transaction(async (tx) => {
      const [created] = await tx
        .insert(groups)
        .values({ name, createdBy: caller.accountId })
        .returning(columns)
      if (!created) throw new Error('The new group was not returned')
      await tx
        .insert(groupMembers)
        .values({ groupId: created.id, accountId: caller.accountId, role: 'admin' })
      await this.#audit.record(tx, caller, {
        action: 'group.created',
        subject: { type: 'group', id: created.id },
        details: { name: created.name },
      })
      return created
    })
  }

  /**
   * Every group, by name, to anyone logged in, whether or not they are a member of it (FR-122).
   * Refused only to a caller who has no account.
   */
  async listGroups(caller: Caller): Promise<Group[]> {
    await this.#requireAccount(caller, 'Only people with an account can see the groups')
    return this.#db.select(columns).from(groups).orderBy(asc(groups.name), asc(groups.id))
  }

  /**
   * A group's members, by username, with the role each holds in it, for a member of the group.
   * Who else may read a group's members is not stated, so anyone who is not a member is refused,
   * and told so; a group that does not exist is answered as not found, since every group is
   * shown to everyone anyway (FR-122).
   */
  async listMembers(caller: Caller, groupId: string): Promise<GroupMember[]> {
    await this.#requireAccount(caller, 'Only people with an account can see the groups')
    const [group] = isUuid(groupId)
      ? await this.#db.select(columns).from(groups).where(eq(groups.id, groupId))
      : []
    if (!group) throw new ServiceError('not-found', 'There is no such group')
    const [own] = await this.#db
      .select({ role: groupMembers.role })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.accountId, caller.accountId)))
    if (!own) {
      throw new ServiceError('forbidden', "Only the group's members can see its members")
    }
    return this.#db
      .select(memberColumns)
      .from(groupMembers)
      .innerJoin(accounts, eq(accounts.id, groupMembers.accountId))
      .where(eq(groupMembers.groupId, groupId))
      .orderBy(asc(accounts.username), asc(groupMembers.accountId))
  }

  /**
   * Gives the person `accountId` the role `role` in the group, adding them as a member or
   * changing the role they hold (FR-124). Only the group's admins may (SRC-144); refused if the
   * role is not one of the four, if there is no such account, or if it would take the admin role
   * from the group's last admin (FR-160).
   */
  async setMemberRole(
    caller: Caller,
    groupId: string,
    accountId: string,
    role: string,
  ): Promise<GroupMember> {
    await this.#requireAccount(caller, CHANGE_REFUSAL)
    await this.#requireGroup(groupId)
    return this.#db.transaction(async (tx) => {
      // The caller is checked before the admins are locked, so that no one else can hold up a
      // group's admins, and again once they are, so that the check still holds at the change.
      await this.#requireAdmin(tx, caller, groupId)
      const admins = await this.#lockAdmins(tx, groupId)
      await this.#requireAdmin(tx, caller, groupId)
      if (!isProjectRole(role)) {
        throw new ServiceError('invalid', `A group role is one of ${PROJECT_ROLES.join(', ')}`)
      }
      const [account] = isUuid(accountId)
        ? await tx
            .select({ username: accounts.username })
            .from(accounts)
            .where(eq(accounts.id, accountId))
        : []
      if (!account) throw new ServiceError('not-found', 'There is no such account')
      const current = await this.#roleIn(tx, groupId, accountId)
      const member = { accountId, username: account.username, role }
      if (current === role) return member
      if (current === 'admin' && admins.length === 1) {
        throw new ServiceError('conflict', LAST_ADMIN)
      }
      await tx
        .insert(groupMembers)
        .values({ groupId, accountId, role })
        .onConflictDoUpdate({
          target: [groupMembers.groupId, groupMembers.accountId],
          set: { role },
        })
      await this.#audit.record(tx, caller, {
        action: 'group.member-role-set',
        subject: { type: 'group', id: groupId },
        details: { accountId, username: account.username, role, previousRole: current ?? null },
      })
      return member
    })
  }

  /**
   * Takes the person `accountId` out of the group (FR-124). Only the group's admins may
   * (SRC-144); refused as not found if the person is not a member, and refused if they are the
   * group's last admin (FR-160).
   */
  async removeMember(caller: Caller, groupId: string, accountId: string): Promise<void> {
    await this.#requireAccount(caller, CHANGE_REFUSAL)
    await this.#requireGroup(groupId)
    await this.#db.transaction(async (tx) => {
      await this.#requireAdmin(tx, caller, groupId)
      const admins = await this.#lockAdmins(tx, groupId)
      await this.#requireAdmin(tx, caller, groupId)
      const [member] = isUuid(accountId)
        ? await tx
            .select(memberColumns)
            .from(groupMembers)
            .innerJoin(accounts, eq(accounts.id, groupMembers.accountId))
            .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.accountId, accountId)))
        : []
      if (!member) throw new ServiceError('not-found', 'There is no such member')
      if (member.role === 'admin' && admins.length === 1) {
        throw new ServiceError('conflict', LAST_ADMIN)
      }
      await this.#delete(tx, groupId, accountId)
      await this.#audit.record(tx, caller, {
        action: 'group.member-removed',
        subject: { type: 'group', id: groupId },
        details: { accountId, username: member.username, previousRole: member.role },
      })
    })
  }

  /**
   * Takes the caller out of the group (FR-125), whatever role they hold in it. Refused as not
   * found if they are not a member, and refused if they are the group's last admin (FR-160).
   */
  async leaveGroup(caller: Caller, groupId: string): Promise<void> {
    await this.#requireAccount(caller, CHANGE_REFUSAL)
    await this.#requireGroup(groupId)
    await this.#db.transaction(async (tx) => {
      // The caller is checked to be a member before the admins are locked, so that no one else
      // can hold up a group's admins, and again once they are, so that the check still holds.
      await this.#requireMember(tx, groupId, caller.accountId)
      const admins = await this.#lockAdmins(tx, groupId)
      const role = await this.#requireMember(tx, groupId, caller.accountId)
      const [account] = await tx
        .select({ username: accounts.username })
        .from(accounts)
        .where(eq(accounts.id, caller.accountId))
      if (role === 'admin' && admins.length === 1) {
        throw new ServiceError('conflict', "The group's last admin cannot leave it")
      }
      await this.#delete(tx, groupId, caller.accountId)
      await this.#audit.record(tx, caller, {
        action: 'group.member-left',
        subject: { type: 'group', id: groupId },
        details: { accountId: caller.accountId, username: account?.username, previousRole: role },
      })
    })
  }

  /**
   * Adds the existing project `projectId` to the group (FR-123). Only the project's admins may
   * (SRC-143), whether they hold the admin role directly or through another group (FR-112);
   * someone with no role in it is told that it is not visible to them (FR-017). Refused as not
   * found if there is no such group. A project already in the group is left as it is.
   *
   * Every member of the group then holds their group role on the project (FR-111).
   */
  async addProject(caller: Caller, groupId: string, projectId: string): Promise<GroupProject> {
    await this.#requireGroup(groupId)
    return this.#db.transaction(async (tx) => {
      const [project] = isUuid(projectId)
        ? await tx
            .select({ id: projects.id, name: projects.name })
            .from(projects)
            .where(eq(projects.id, projectId))
        : []
      // Whether or not it exists, as for any project the caller cannot see (FR-017).
      if (!project) throw notVisible()
      // The rows that give the caller their role on the project are locked first, then the role is
      // checked, so that a change to that role waits for this one: the caller is still the
      // project's admin at the change.
      await lockRolesOn(tx, caller.accountId, projectId)
      await this.#roles.permissions.require(caller, projectId, 'manage-project', tx)
      await this.#insertProject(tx, caller, groupId, project)
      return project
    })
  }

  /**
   * Adds the project `projectId`, which the caller is creating in the transaction `tx`, to each of
   * the groups `groupIds` (FR-123). Anyone may add a new project to any group, since every group is
   * visible to everyone (UC-017); the project's creation calls this, after it has made the caller
   * the project's admin. Refused as not found if any of the groups does not exist, which, thrown
   * inside the creation's transaction, leaves the project uncreated.
   */
  async addNewProject(
    tx: Executor,
    caller: Caller,
    project: GroupProject,
    groupIds: readonly string[],
  ): Promise<void> {
    for (const groupId of new Set(groupIds)) {
      const [group] = isUuid(groupId)
        ? await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId))
        : []
      if (!group) throw new ServiceError('not-found', 'There is no such group')
      await this.#insertProject(tx, caller, groupId, project)
    }
  }

  /**
   * The group's projects, by name, among only those the caller can read: who may see a group's
   * projects is not stated, so each is shown only to those who can see the project itself
   * (FR-017), which every member of the group can (FR-111). Refused as not found if there is no
   * such group, and to a caller who has no account.
   */
  async listProjects(caller: Caller, groupId: string): Promise<GroupProject[]> {
    await this.#requireAccount(caller, 'Only people with an account can see the groups')
    await this.#requireGroup(groupId)
    const readable = await this.#roles.readableProjects(caller.accountId)
    const rows = await this.#db
      .select({ id: projects.id, name: projects.name })
      .from(groupProjects)
      .innerJoin(projects, eq(projects.id, groupProjects.projectId))
      .where(eq(groupProjects.groupId, groupId))
      .orderBy(asc(projects.name), asc(projects.id))
    return rows.filter((project) => readable.has(project.id))
  }

  async #insertProject(
    tx: Executor,
    caller: Caller,
    groupId: string,
    project: GroupProject,
  ): Promise<void> {
    const added = await tx
      .insert(groupProjects)
      .values({ groupId, projectId: project.id })
      .onConflictDoNothing()
      .returning({ projectId: groupProjects.projectId })
    if (added.length === 0) return
    await this.#audit.record(tx, caller, {
      action: 'group.project-added',
      subject: { type: 'group', id: groupId },
      projectId: project.id,
      details: { projectName: project.name },
    })
  }

  async #requireMember(tx: Executor, groupId: string, accountId: string): Promise<ProjectRole> {
    const role = await this.#roleIn(tx, groupId, accountId)
    if (!role) throw new ServiceError('not-found', 'You are not a member of this group')
    return role
  }

  async #requireGroup(groupId: string): Promise<void> {
    const [group] = isUuid(groupId)
      ? await this.#db.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId))
      : []
    if (!group) throw new ServiceError('not-found', 'There is no such group')
  }

  async #roleIn(
    executor: Executor,
    groupId: string,
    accountId: string,
  ): Promise<ProjectRole | undefined> {
    const [row] = await executor
      .select({ role: groupMembers.role })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.accountId, accountId)))
    return row?.role
  }

  /** Checked inside the change's transaction, so that it still holds when the change is made. */
  async #requireAdmin(tx: Executor, caller: Caller, groupId: string): Promise<void> {
    if ((await this.#roleIn(tx, groupId, caller.accountId)) !== 'admin') {
      throw new ServiceError('forbidden', "Only the group's admins can manage its members")
    }
  }

  /**
   * The group's admins, their rows locked until the transaction ends, so that two concurrent
   * changes cannot each take away one of the last two admins.
   */
  async #lockAdmins(tx: Executor, groupId: string): Promise<string[]> {
    const rows = await tx
      .select({ accountId: groupMembers.accountId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, 'admin')))
      // In one order, so that two transactions locking the same rows cannot deadlock.
      .orderBy(asc(groupMembers.accountId))
      .for('update')
    return rows.map((row) => row.accountId)
  }

  async #delete(tx: Executor, groupId: string, accountId: string): Promise<void> {
    await tx
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.accountId, accountId)))
  }

  async #requireAccount(caller: Caller, refusal: string): Promise<void> {
    const [account] = isUuid(caller.accountId)
      ? await this.#db
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.id, caller.accountId))
      : []
    if (!account) throw new ServiceError('forbidden', refusal)
  }
}

/**
 * Locks, until the transaction ends, the rows that give the person a role on the project: their
 * direct role and their roles in the groups that hold it (FR-111). A change that would take one
 * of these away updates or deletes its row, so it waits until this transaction ends. A module that
 * checks a role and then changes something on its strength takes this first, so that the role
 * still holds at the change.
 */
export async function lockRolesOn(
  tx: Executor,
  accountId: string,
  projectId: string,
): Promise<void> {
  if (!isUuid(accountId)) return
  await tx
    .select({ accountId: projectMembers.accountId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.accountId, accountId)))
    .for('share')
  await tx
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .innerJoin(groupProjects, eq(groupProjects.groupId, groupMembers.groupId))
    .where(and(eq(groupMembers.accountId, accountId), eq(groupProjects.projectId, projectId)))
    .orderBy(asc(groupMembers.groupId))
    .for('share', { of: groupMembers })
}

/**
 * The roles people hold on projects through the groups the projects are in (FR-111): each member
 * of a group holds their group role on every project in it, for as long as they are a member and
 * the project is in the group. The project role store (SC-014) asks these, read with the executor
 * it is given, and applies the highest where a person holds several (FR-112).
 */
export const groupRoles: GroupRoles = {
  async rolesThroughGroups(executor, accountId, projectId) {
    if (!isUuid(accountId) || !isUuid(projectId)) return []
    const rows = await executor
      .select({ role: groupMembers.role })
      .from(groupMembers)
      .innerJoin(groupProjects, eq(groupProjects.groupId, groupMembers.groupId))
      .where(and(eq(groupMembers.accountId, accountId), eq(groupProjects.projectId, projectId)))
    return rows.map((row) => row.role)
  },
  async allRolesThroughGroups(executor, accountId) {
    if (!isUuid(accountId)) return []
    return executor
      .select({ projectId: groupProjects.projectId, role: groupMembers.role })
      .from(groupMembers)
      .innerJoin(groupProjects, eq(groupProjects.groupId, groupMembers.groupId))
      .where(eq(groupMembers.accountId, accountId))
  },
}
