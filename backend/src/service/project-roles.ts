/** The four roles a person can hold in a project (FR-105). */
export type ProjectRole = 'read-only' | 'contributor' | 'read-write' | 'admin'

/**
 * Answers a person's role in a project, the highest where they hold several, or `undefined` when
 * they hold none. The project role store (SC-014) is what holds the roles; the modules that decide
 * by role, such as the audit log (SC-013), ask it through this.
 */
export interface ProjectRoles {
  roleOf(accountId: string, projectId: string): Promise<ProjectRole | undefined>
}

/**
 * The roles until the project role store (SC-014) lands: nobody holds a role in any project, so
 * whatever is granted by a project role is refused to everyone who is not a system admin.
 */
export const noProjectRoles: ProjectRoles = {
  roleOf: async () => undefined,
}
