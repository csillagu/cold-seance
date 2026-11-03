import { describe, expect, it } from 'vitest'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import {
  allows,
  allowsStatusChange,
  ProjectPermissions,
  type ProjectAction,
  type RoleSource,
  type StatusChange,
  type TaskStatus,
} from './permissions.ts'
import { PROJECT_ROLES, type ProjectRole } from './project-roles.ts'

// The role permission checks (SC-049) decide from a role alone, so they are tested here without a
// database: every role against every action, and every status change a contributor might try.
// How the role is found (directly or through groups, the highest of several) is the role store's,
// tested in test/integration/project-roles.test.ts.

const ACTIONS: ProjectAction[] = ['read', 'edit-plan', 'handle-proposals', 'manage-project']
const STATUSES: TaskStatus[] = ['not-started', 'in-progress', 'on-hold', 'done', 'cancelled']

/** Who may do each action, as FR-106, FR-108 and FR-109 state it. */
const EXPECTED: Record<ProjectAction, ProjectRole[]> = {
  read: ['read-only', 'contributor', 'read-write', 'admin'],
  'edit-plan': ['read-write', 'admin'],
  'handle-proposals': ['read-write', 'admin'],
  'manage-project': ['admin'],
}

describe('allows', () => {
  for (const action of ACTIONS) {
    for (const role of PROJECT_ROLES) {
      const allowed = EXPECTED[action].includes(role)
      it(`${allowed ? 'lets' : 'refuses'} the ${role} role ${action}`, () => {
        expect(allows(role, action)).toBe(allowed)
      })
    }
    it(`refuses ${action} to someone with no role`, () => {
      expect(allows(undefined, action)).toBe(false)
    })
  }

  it('lets the admin do everything the read-write role can (FR-109)', () => {
    const readWrite = ACTIONS.filter((action) => allows('read-write', action))
    expect(readWrite).toEqual(['read', 'edit-plan', 'handle-proposals'])
    expect(readWrite.filter((action) => !allows('admin', action))).toEqual([])
  })
})

describe('allowsStatusChange', () => {
  const ME = 'carol'
  const change = (from: TaskStatus, to: TaskStatus, assignedToMe = true): StatusChange => ({
    from,
    to,
    assignees: assignedToMe ? ['alice', ME] : ['alice'],
  })

  it.each(['read-write', 'admin'] as const)(
    'lets the %s role make any status change, on any task',
    (role) => {
      for (const from of STATUSES) {
        for (const to of STATUSES) {
          expect(allowsStatusChange(role, ME, change(from, to, false))).toBe(true)
        }
      }
    },
  )

  it('lets neither the read-only role nor someone with no role change any status', () => {
    for (const role of ['read-only', undefined] as const) {
      for (const from of STATUSES) {
        for (const to of STATUSES) {
          expect(allowsStatusChange(role, ME, change(from, to))).toBe(false)
        }
      }
    }
  })

  describe('for a contributor (FR-107)', () => {
    it('lets them mark a task they are assigned to as in progress, on hold or finished', () => {
      expect(allowsStatusChange('contributor', ME, change('not-started', 'in-progress'))).toBe(true)
      expect(allowsStatusChange('contributor', ME, change('in-progress', 'on-hold'))).toBe(true)
      expect(allowsStatusChange('contributor', ME, change('on-hold', 'in-progress'))).toBe(true)
      expect(allowsStatusChange('contributor', ME, change('in-progress', 'done'))).toBe(true)
    })

    it('refuses them every status change on a task they are not assigned to', () => {
      for (const from of STATUSES) {
        for (const to of STATUSES) {
          expect(allowsStatusChange('contributor', ME, change(from, to, false))).toBe(false)
        }
      }
    })

    it('refuses them cancelling a task, even one they are assigned to', () => {
      for (const from of STATUSES) {
        expect(allowsStatusChange('contributor', ME, change(from, 'cancelled'))).toBe(false)
      }
    })

    it('refuses them reopening a finished task', () => {
      for (const to of STATUSES) {
        expect(allowsStatusChange('contributor', ME, change('done', to))).toBe(false)
      }
    })

    it('refuses them a task with nobody assigned, and one assigned to someone else alone', () => {
      expect(
        allowsStatusChange('contributor', ME, {
          from: 'not-started',
          to: 'in-progress',
          assignees: [],
        }),
      ).toBe(false)
      expect(
        allowsStatusChange('contributor', ME, {
          from: 'not-started',
          to: 'in-progress',
          assignees: ['carol-2'],
        }),
      ).toBe(false)
    })

    it('lets them move a cancelled task they are assigned to on: the requirements do not say', () => {
      // An open question for the owner: FR-107 forbids cancelling and reopening a finished task,
      // and says nothing of a cancelled one. The check follows its words.
      expect(allowsStatusChange('contributor', ME, change('cancelled', 'in-progress'))).toBe(true)
    })

    it('refuses them setting a task back to not started', () => {
      for (const from of STATUSES) {
        expect(allowsStatusChange('contributor', ME, change(from, 'not-started'))).toBe(false)
      }
    })
  })
})

describe('ProjectPermissions', () => {
  const ALICE: Caller = { accountId: 'alice', channel: 'ui' }

  /** Roles from a table, keyed by project, recording the executor each read was given. */
  function rolesOf(table: Record<string, ProjectRole>) {
    const executors: unknown[] = []
    const source: RoleSource = {
      roleOf: async (_accountId, projectId, executor) => {
        executors.push(executor)
        return table[projectId]
      },
    }
    return { permissions: new ProjectPermissions(source), executors }
  }

  async function refusal(promise: Promise<unknown>): Promise<ServiceError> {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e,
    )
    if (!(error instanceof ServiceError))
      throw new Error(`expected a ServiceError, got ${String(error)}`)
    return error
  }

  it('answers the role when it allows the action', async () => {
    const { permissions } = rolesOf({ apollo: 'read-write' })
    await expect(permissions.require(ALICE, 'apollo', 'edit-plan')).resolves.toBe('read-write')
  })

  it.each(['read', 'edit-plan', 'handle-proposals', 'manage-project'] as const)(
    'tells someone with no role, asking to %s, that the project is not visible to them (FR-017)',
    async (action) => {
      const { permissions } = rolesOf({})
      const error = await refusal(permissions.require(ALICE, 'apollo', action))
      expect(error.kind).toBe('not-visible')
      expect(error.message).toBe('This project is not visible to you')
    },
  )

  it.each([
    ['edit-plan', "Only the project's read-write members and admins can edit its plan"],
    [
      'handle-proposals',
      "Only the project's read-write members and admins can handle its AI proposals",
    ],
    [
      'manage-project',
      "Only the project's admins can manage its members, roles, repositories and settings",
    ],
  ] as const)(
    'refuses %s to a read-only member, as forbidden, saying who may',
    async (action, message) => {
      const { permissions } = rolesOf({ apollo: 'read-only' })
      const error = await refusal(permissions.require(ALICE, 'apollo', action))
      expect(error.kind).toBe('forbidden')
      expect(error.message).toBe(message)
    },
  )

  it('lets a read-only member read', async () => {
    const { permissions } = rolesOf({ apollo: 'read-only' })
    await expect(permissions.require(ALICE, 'apollo', 'read')).resolves.toBe('read-only')
  })

  it('refuses a read-only member an edit of the plan', async () => {
    const { permissions } = rolesOf({ apollo: 'read-only' })
    const error = await refusal(permissions.require(ALICE, 'apollo', 'edit-plan'))
    expect(error.kind).toBe('forbidden')
  })

  it('decides each project by the role held there, as on the cards of a cross-project view (FR-060)', async () => {
    const { permissions } = rolesOf({ apollo: 'read-only', borealis: 'read-write' })
    await expect(permissions.require(ALICE, 'borealis', 'edit-plan')).resolves.toBe('read-write')
    expect((await refusal(permissions.require(ALICE, 'apollo', 'edit-plan'))).kind).toBe(
      'forbidden',
    )
  })

  it('reads the role in the transaction it is given', async () => {
    const { permissions, executors } = rolesOf({ apollo: 'admin' })
    const tx = Symbol('tx')
    // @ts-expect-error: a stand-in for a transaction, which the role source only passes on.
    await permissions.require(ALICE, 'apollo', 'manage-project', tx)
    expect(executors).toEqual([tx])
  })

  describe('requireStatusChange', () => {
    it('lets a contributor assigned to the task mark it in progress', async () => {
      const { permissions } = rolesOf({ apollo: 'contributor' })
      await expect(
        permissions.requireStatusChange(ALICE, 'apollo', {
          assignees: ['alice'],
          from: 'not-started',
          to: 'in-progress',
        }),
      ).resolves.toBeUndefined()
    })

    it('refuses a contributor cancelling, saying what a contributor may do', async () => {
      const { permissions } = rolesOf({ apollo: 'contributor' })
      const error = await refusal(
        permissions.requireStatusChange(ALICE, 'apollo', {
          assignees: ['alice'],
          from: 'in-progress',
          to: 'cancelled',
        }),
      )
      expect(error.kind).toBe('forbidden')
      expect(error.message).toBe(
        'A contributor can only mark a task they are assigned to as in progress, on hold or finished',
      )
    })

    it('refuses a read-only member, saying who may set a status', async () => {
      const { permissions } = rolesOf({ apollo: 'read-only' })
      const error = await refusal(
        permissions.requireStatusChange(ALICE, 'apollo', {
          assignees: ['alice'],
          from: 'not-started',
          to: 'in-progress',
        }),
      )
      expect(error.message).toBe(
        "Only the project's read-write members and admins can set the status of its tasks",
      )
    })

    it('tells someone with no role that the project is not visible to them', async () => {
      const { permissions } = rolesOf({})
      const error = await refusal(
        permissions.requireStatusChange(ALICE, 'apollo', {
          assignees: ['alice'],
          from: 'not-started',
          to: 'in-progress',
        }),
      )
      expect(error.kind).toBe('not-visible')
    })
  })
})
