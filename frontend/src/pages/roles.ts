/** The four roles a person can hold in a project (FR-105), lowest first, as the API names them. */
export const ROLES = ['read-only', 'contributor', 'read-write', 'admin'] as const

export type Role = (typeof ROLES)[number]

/** How the screens name each role. */
export const ROLE_WORDS: Record<Role, string> = {
  'read-only': 'Read-only',
  contributor: 'Contributor',
  'read-write': 'Read-write',
  admin: 'Admin',
}

/** Whether `value` is one of the four roles. */
export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value)
}
