import { and, asc, eq, inArray, or, type SQL } from 'drizzle-orm'
import type { Database, Executor } from '../db/client.ts'
import {
  accounts,
  groupMembers,
  groupProjects,
  groups,
  projects,
  SAVED_VIEW_KINDS,
  savedViewProjects,
  savedViews,
} from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { notVisible, ServiceError } from './errors.ts'
import { lockRolesOn } from './groups.ts'
import type { ProjectRole, ProjectRoleService } from './project-roles.ts'
import { type FilterCondition, matchesFilter, parseFilter } from './saved-view-filter.ts'
import { isUuid } from './system-admins.ts'
import type { TaskRelations, TaskRelationService } from './task-relations.ts'
import type { Task, TaskService } from './tasks.ts'
import { characters } from './text.ts'
import type { ViewReadFilter } from './view-filter.ts'

/** The view kinds that can be saved (FR-054). */
export type SavedViewKind = (typeof SAVED_VIEW_KINDS)[number]

/** Where a saved view is kept (FR-055). */
export type SavedViewPlace = 'project' | 'group' | 'personal'

export const SAVED_VIEW_PLACES: readonly SavedViewPlace[] = ['project', 'group', 'personal']

/** A saved view as the service layer hands it out. */
export interface SavedView {
  id: string
  name: string
  kind: SavedViewKind
  keptIn: SavedViewPlace
  /** The project it is kept in, or `null` for a view kept in a group or personally. */
  projectId: string | null
  /** The group it is kept in, or `null` for a view kept in a project or personally. */
  groupId: string | null
  /** The person a personal view is kept by, or `null` for a view kept in a project or a group. */
  ownerId: string | null
  /**
   * The projects it covers, by name, among only those the caller can read: a view never shows
   * anyone a project they cannot read (FR-059).
   */
  projects: string[]
  filter: FilterCondition[]
}

/** A saved view as a channel hands it over to be saved; the service checks each value itself. */
export interface SavedViewInput {
  readonly name?: unknown
  readonly kind?: unknown
  readonly keptIn?: unknown
  /** The project a view kept in a project is kept in. */
  readonly projectId?: unknown
  /** The group a view kept in a group is kept in. */
  readonly groupId?: unknown
  /**
   * The projects the view covers, by id. A view kept in a project covers that project, so it may
   * be left out there.
   */
  readonly projects?: unknown
  /** The view's filter (FR-057, FR-058); none when left out. */
  readonly filter?: unknown
}

/** The longest name a saved view can have, in characters, as for a project or a group. */
export const SAVED_VIEW_NAME_MAX_LENGTH = 200

/** The roles in a group that may save views in it, as the owner decided (#115, 2026-11-14). */
const GROUP_SAVERS: ReadonlySet<ProjectRole> = new Set(['read-write', 'admin'])

const columns = {
  id: savedViews.id,
  name: savedViews.name,
  kind: savedViews.kind,
  projectId: savedViews.projectId,
  groupId: savedViews.groupId,
  ownerId: savedViews.ownerId,
  filter: savedViews.filter,
} as const

type Row = Omit<SavedView, 'keptIn' | 'projects' | 'filter'> & { filter: unknown[] }

function invalid(message: string): ServiceError {
  return new ServiceError('invalid', message)
}

function noSuchView(): ServiceError {
  return new ServiceError('not-found', 'There is no such saved view')
}

/**
 * The saved view module of the service layer (DD-039, SC-020): it saves named Kanban and Gantt
 * views, and no other kind (FR-054), each kept in a project, a group or personally (FR-055); it
 * lists them to those who see them, and opens them.
 *
 * - A view kept in a project is seen by anyone who can read the project, covers that project only
 *   (FR-056), and is saved by the project's read-write members and admins.
 * - A view kept in a group is seen by the group's members, covers some of the group's projects
 *   (FR-056), and is saved by the group's read-write members and admins.
 * - A personal view is seen by its owner only, who saves it, and covers some of the projects they
 *   can read (FR-056).
 *
 * Who may save a view in a project and in a group is the owner's decision on #115 (2026-11-14).
 *
 * A view's filter can name any task field (FR-057) and the person viewing it (FR-058), so that a
 * view kept in a group shows each of its viewers their own tasks. Opening a view passes its tasks
 * through the view read filter (SC-050), so it shows only what its viewer can read now (FR-059).
 * Each saved view is recorded in the audit log (FR-116), in the transaction that saves it.
 */
export class SavedViewService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService
  readonly #tasks: TaskService
  readonly #readFilter: ViewReadFilter
  readonly #relations: TaskRelationService

  constructor(
    db: Database,
    audit: AuditLogService,
    roles: ProjectRoleService,
    tasks: TaskService,
    readFilter: ViewReadFilter,
    relations: TaskRelationService,
  ) {
    this.#db = db
    this.#audit = audit
    this.#roles = roles
    this.#tasks = tasks
    this.#readFilter = readFilter
    this.#relations = relations
  }

  /**
   * Saves the view under its name, kept where it says, covering the projects it names, with its
   * filter. Refused if the caller has no account; if the name is empty or too long; if the kind is
   * not Kanban or Gantt (FR-054); if the filter is not one (FR-057); if the projects it covers are
   * not allowed where it is kept (FR-056); or if the caller may not save views there.
   */
  async saveView(caller: Caller, input: SavedViewInput): Promise<SavedView> {
    await this.#requireAccount(caller)
    const name = parseName(input.name)
    const kind = parseKind(input.kind)
    const filter = parseFilter(input.filter)
    const keptIn = parsePlace(input.keptIn)
    const place = {
      projectId: keptIn === 'project' ? parseId(input.projectId, 'project') : null,
      groupId: keptIn === 'group' ? parseId(input.groupId, 'group') : null,
      ownerId: keptIn === 'personal' ? caller.accountId : null,
    }
    if (keptIn !== 'project' && input.projectId !== undefined && input.projectId !== null) {
      throw invalid('Only a view kept in a project names a project to be kept in')
    }
    if (keptIn !== 'group' && input.groupId !== undefined && input.groupId !== null) {
      throw invalid('Only a view kept in a group names a group to be kept in')
    }
    const covered =
      place.projectId !== null
        ? coveredByProjectView(place.projectId, input.projects)
        : parseProjects(input.projects)

    return this.#db.transaction(async (tx) => {
      if (place.projectId !== null) {
        // The caller's role is locked, then checked, so that it still holds at the save.
        await lockRolesOn(tx, caller.accountId, place.projectId)
        await this.#roles.permissions.require(caller, place.projectId, 'edit-plan', tx)
      } else if (place.groupId !== null) {
        await this.#requireGroupSaver(tx, caller, place.groupId)
        await this.#requireGroupProjects(tx, place.groupId, covered)
      } else {
        // In one order, so that two saves locking the same rows cannot deadlock.
        for (const projectId of [...covered].sort()) {
          await lockRolesOn(tx, caller.accountId, projectId)
        }
        const readable = await this.#roles.readableProjects(caller.accountId, tx)
        // A project the owner cannot read is not visible to them, whether or not it exists.
        if (covered.some((projectId) => !readable.has(projectId))) throw notVisible()
      }

      const [view] = await tx
        .insert(savedViews)
        .values({ name, kind, ...place, filter, createdBy: caller.accountId })
        .returning(columns)
      if (!view) throw new Error('The new saved view was not returned')
      await tx
        .insert(savedViewProjects)
        .values(covered.map((projectId) => ({ viewId: view.id, projectId })))
      await this.#audit.record(tx, caller, {
        action: 'saved-view.created',
        subject: { type: 'saved-view', id: view.id },
        projectId: place.projectId,
        details: { name, kind, keptIn, groupId: place.groupId, projects: covered },
      })
      const [out] = await this.#out(tx, caller, [view])
      if (!out) throw new Error('The new saved view could not be read back')
      return out
    })
  }

  /**
   * Every saved view the caller sees, by name: those kept in the projects they can read, in the
   * groups they are a member of, and personally by them (FR-055).
   */
  async listViews(caller: Caller): Promise<SavedView[]> {
    if (!isUuid(caller.accountId)) return []
    const readable = [...(await this.#roles.readableProjects(caller.accountId))]
    const memberOf = this.#db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.accountId, caller.accountId))
    const seen: SQL[] = [
      eq(savedViews.ownerId, caller.accountId),
      inArray(savedViews.groupId, memberOf),
    ]
    if (readable.length > 0) seen.push(inArray(savedViews.projectId, readable))
    return this.#list(caller, or(...seen))
  }

  /**
   * The views kept in the project, by name, for anyone who can read it (FR-055). Refused as not
   * visible to someone with no role in it (FR-017).
   */
  async listProjectViews(caller: Caller, projectId: string): Promise<SavedView[]> {
    await this.#roles.permissions.require(caller, projectId, 'read')
    return this.#list(caller, eq(savedViews.projectId, projectId))
  }

  /**
   * The views kept in the group, by name, for its members (FR-055). Refused as not found if there
   * is no such group, and to anyone who is not a member of it.
   */
  async listGroupViews(caller: Caller, groupId: string): Promise<SavedView[]> {
    await this.#requireGroup(this.#db, groupId)
    if ((await roleInGroup(this.#db, groupId, caller.accountId)) === undefined) {
      throw new ServiceError('forbidden', "Only the group's members can see its saved views")
    }
    return this.#list(caller, eq(savedViews.groupId, groupId))
  }

  /**
   * The saved view, for someone who sees it (FR-055). Refused as not found if there is no such
   * view or the caller does not see it, so that a view's existence is not told to others.
   */
  async getView(caller: Caller, viewId: string): Promise<SavedView> {
    const row = await this.#find(caller, viewId)
    const [view] = await this.#out(this.#db, caller, [row])
    if (!view) throw noSuchView()
    return view
  }

  /**
   * Opens the saved view for the caller: the tasks of the projects it covers that meet its filter,
   * the person viewing being the caller (FR-058), among only those the caller can read now
   * (FR-059), project by project in the order of their names, each project's in the order they
   * were created. A view kept in a group shows only the projects still in the group (FR-056).
   * Refused as `getView` is.
   */
  async openView(caller: Caller, viewId: string): Promise<Task[]> {
    const row = await this.#find(caller, viewId)
    const [view] = await this.#out(this.#db, caller, [row])
    if (!view) throw noSuchView()
    let covered = view.projects
    if (view.groupId !== null) {
      const inGroup = await this.#groupProjectIds(this.#db, view.groupId)
      covered = covered.filter((projectId) => inGroup.has(projectId))
    }
    const shown: Task[] = []
    for (const projectId of covered) {
      const tasks = await this.#tasks.listTasks(caller, projectId).catch((error: unknown) => {
        // A role lost since the view was read: the project's tasks are not shown (FR-059).
        if (error instanceof ServiceError && error.kind === 'not-visible') return []
        throw error
      })
      shown.push(...tasks.filter((task) => matchesFilter(task, view.filter, caller.accountId)))
    }
    return this.#readFilter.readable(caller, shown)
  }

  /**
   * The relations of each task the view shows the caller when opened (`openView`), in the order
   * it shows them, each as the task relation module answers it (SC-002): one request for them
   * all, rather than one for each task. Refused as `getView` is.
   */
  async openViewRelations(caller: Caller, viewId: string): Promise<TaskRelations[]> {
    const shown = await this.openView(caller, viewId)
    const ofTask = new Map<string, TaskRelations>()
    for (const projectId of new Set(shown.map((task) => task.projectId))) {
      const relations = await this.#relations
        .listRelations(caller, projectId)
        .catch((error: unknown) => {
          // A role lost since the view was opened: its tasks' relations are not shown (FR-059).
          if (error instanceof ServiceError && error.kind === 'not-visible') return []
          throw error
        })
      for (const each of relations) ofTask.set(each.taskId, each)
    }
    return shown.flatMap((task) => ofTask.get(task.id) ?? [])
  }

  async #list(caller: Caller, where: SQL | undefined): Promise<SavedView[]> {
    const rows = await this.#db
      .select(columns)
      .from(savedViews)
      .where(where)
      .orderBy(asc(savedViews.name), asc(savedViews.id))
    return this.#out(this.#db, caller, rows)
  }

  /** The view, if there is one and the caller sees it (FR-055). */
  async #find(caller: Caller, viewId: string): Promise<Row> {
    if (!isUuid(viewId)) throw noSuchView()
    const [row] = await this.#db.select(columns).from(savedViews).where(eq(savedViews.id, viewId))
    if (!row || !(await this.#sees(caller, row))) throw noSuchView()
    return row
  }

  async #sees(caller: Caller, row: Row): Promise<boolean> {
    if (!isUuid(caller.accountId)) return false
    if (row.ownerId !== null) return row.ownerId === caller.accountId
    if (row.groupId !== null) {
      return (await roleInGroup(this.#db, row.groupId, caller.accountId)) !== undefined
    }
    if (row.projectId !== null) {
      return (await this.#roles.readableProjects(caller.accountId)).has(row.projectId)
    }
    return false
  }

  /** The rows as the service hands them out, each with the projects it covers that the caller can read. */
  async #out(executor: Executor, caller: Caller, rows: readonly Row[]): Promise<SavedView[]> {
    if (rows.length === 0) return []
    const covered = await executor
      .select({ viewId: savedViewProjects.viewId, projectId: savedViewProjects.projectId })
      .from(savedViewProjects)
      .innerJoin(projects, eq(projects.id, savedViewProjects.projectId))
      .where(
        inArray(
          savedViewProjects.viewId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(projects.name), asc(projects.id))
    const readable = await this.#roles.readableProjects(caller.accountId, executor)
    return rows.map((row) => ({
      ...row,
      keptIn: row.projectId !== null ? 'project' : row.groupId !== null ? 'group' : 'personal',
      projects: covered
        .filter((entry) => entry.viewId === row.id && readable.has(entry.projectId))
        .map((entry) => entry.projectId),
      // Checked when it was saved; read through the same check, so its type is known.
      filter: parseFilter(row.filter),
    }))
  }

  /**
   * Refuses the caller unless they hold a role in the group that may save views in it. The
   * group's row and the caller's membership are locked first, so that neither goes before the
   * save is made.
   */
  async #requireGroupSaver(tx: Executor, caller: Caller, groupId: string): Promise<void> {
    await this.#requireGroup(tx, groupId, true)
    const [member] = await tx
      .select({ role: groupMembers.role })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.accountId, caller.accountId)))
      .for('share')
    if (!member || !GROUP_SAVERS.has(member.role)) {
      throw new ServiceError(
        'forbidden',
        "Only the group's read-write members and admins can save views in it",
      )
    }
  }

  /** Refuses the projects unless every one is in the group (FR-056), locking them there. */
  async #requireGroupProjects(
    tx: Executor,
    groupId: string,
    covered: readonly string[],
  ): Promise<void> {
    const rows = await tx
      .select({ projectId: groupProjects.projectId })
      .from(groupProjects)
      .where(and(eq(groupProjects.groupId, groupId), inArray(groupProjects.projectId, covered)))
      .orderBy(asc(groupProjects.projectId))
      .for('share')
    if (rows.length !== covered.length) {
      throw invalid("A view kept in a group can cover only the group's projects")
    }
  }

  async #groupProjectIds(executor: Executor, groupId: string): Promise<Set<string>> {
    const rows = await executor
      .select({ projectId: groupProjects.projectId })
      .from(groupProjects)
      .where(eq(groupProjects.groupId, groupId))
    return new Set(rows.map((row) => row.projectId))
  }

  async #requireGroup(executor: Executor, groupId: string, lock = false): Promise<void> {
    if (!isUuid(groupId)) throw new ServiceError('not-found', 'There is no such group')
    const query = executor.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId))
    const [group] = lock ? await query.for('share') : await query
    if (!group) throw new ServiceError('not-found', 'There is no such group')
  }

  async #requireAccount(caller: Caller): Promise<void> {
    const [account] = isUuid(caller.accountId)
      ? await this.#db
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.id, caller.accountId))
      : []
    if (!account) {
      throw new ServiceError('forbidden', 'Only people with an account can save views')
    }
  }
}

async function roleInGroup(
  executor: Executor,
  groupId: string,
  accountId: string,
): Promise<ProjectRole | undefined> {
  if (!isUuid(groupId) || !isUuid(accountId)) return undefined
  const [row] = await executor
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.accountId, accountId)))
  return row?.role
}

function parseName(input: unknown): string {
  if (typeof input !== 'string') throw invalid('A saved view needs a name')
  // In one Unicode form, as for project and group names.
  const name = input.normalize('NFC').trim()
  if (name === '') throw invalid('A saved view needs a name')
  if (characters(name) > SAVED_VIEW_NAME_MAX_LENGTH) {
    throw invalid(`A saved view's name can have at most ${SAVED_VIEW_NAME_MAX_LENGTH} characters`)
  }
  return name
}

function parseKind(input: unknown): SavedViewKind {
  const kind = SAVED_VIEW_KINDS.find((known) => known === input)
  if (kind === undefined) {
    throw invalid('Only Kanban and Gantt views can be saved: the kind is kanban or gantt')
  }
  return kind
}

function parsePlace(input: unknown): SavedViewPlace {
  const place = SAVED_VIEW_PLACES.find((known) => known === input)
  if (place === undefined) {
    throw invalid(`A saved view is kept in one of ${SAVED_VIEW_PLACES.join(', ')}`)
  }
  return place
}

function parseId(input: unknown, what: 'project' | 'group'): string {
  if (typeof input !== 'string' || input === '') {
    throw invalid(`A view kept in a ${what} names the ${what}`)
  }
  if (!isUuid(input)) {
    if (what === 'project') throw notVisible()
    throw new ServiceError('not-found', 'There is no such group')
  }
  return input
}

/** The projects a view names, each once, in the order given; at least one. */
function parseProjects(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw invalid('A saved view covers at least one project')
  }
  const ids = new Set<string>()
  for (const id of input) {
    if (typeof id !== 'string') throw invalid('A saved view names its projects by their ids')
    // An id that is not one names no project the caller can see (FR-017).
    if (!isUuid(id)) throw notVisible()
    ids.add(id)
  }
  return [...ids]
}

/** A view kept in a project covers that project and no other (FR-056). */
function coveredByProjectView(projectId: string, input: unknown): string[] {
  if (input === undefined || input === null) return [projectId]
  const named = parseProjects(input)
  if (named.some((id) => id !== projectId)) {
    throw invalid('A view kept in a project can cover only that project')
  }
  return [projectId]
}
