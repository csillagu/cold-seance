import { and, asc, eq } from 'drizzle-orm'
import type { Database, Executor } from '../db/client.ts'
import { accounts, groupMembers, groups } from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { violates } from './db-errors.ts'
import { ServiceError } from './errors.ts'
import { isProjectRole, PROJECT_ROLES, type ProjectRole } from './project-roles.ts'
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

/** The longest name a group can have, in characters, as for a project. */
export const GROUP_NAME_MAX_LENGTH = 200

const columns = { id: groups.id, name: groups.name } as const

/** The unique index that keeps group names apart (see the schema). */
const GROUP_NAME_INDEX = 'groups_name_key'

/** Why a change that would leave a group without an admin is refused (FR-160). */
const LAST_ADMIN = 'A group must keep at least one admin'

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
 * A group gives no one any role on a project by being seen: the roles a group gives come only
 * from its members and its projects (SC-057, SC-058).
 */
export class GroupService {
  readonly #db: Database
  readonly #audit: AuditLogService

  constructor(db: Database, audit: AuditLogService) {
    this.#db = db
    this.#audit = audit
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
    await this.#requireAccount(caller, 'Only people with an account can see the groups')
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
    await this.#requireAccount(caller, 'Only people with an account can see the groups')
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
    await this.#requireAccount(caller, 'Only people with an account can see the groups')
    await this.#requireGroup(groupId)
    await this.#db.transaction(async (tx) => {
      const admins = await this.#lockAdmins(tx, groupId)
      const role = await this.#roleIn(tx, groupId, caller.accountId)
      if (!role) throw new ServiceError('not-found', 'You are not a member of this group')
      if (role === 'admin' && admins.length === 1) {
        throw new ServiceError('conflict', "The group's last admin cannot leave it")
      }
      await this.#delete(tx, groupId, caller.accountId)
      await this.#audit.record(tx, caller, {
        action: 'group.member-left',
        subject: { type: 'group', id: groupId },
        details: { accountId: caller.accountId, previousRole: role },
      })
    })
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
