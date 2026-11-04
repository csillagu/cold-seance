import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { accounts, groupMembers, groups } from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { violates } from './db-errors.ts'
import { ServiceError } from './errors.ts'
import type { ProjectRole } from './project-roles.ts'
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
