import { useOutletContext } from 'react-router'
import type { Role } from './roles.ts'

/** The project a view inside the project's page shows, as the page hands it on. */
export interface ProjectContext {
  id: string
  name: string
  /**
   * The role the signed-in person holds in the project, directly or through a group, if the API
   * gave it. Views leave out the controls it does not allow (#256); the API refuses them anyway.
   */
  role?: Role | undefined
}

/** The project of the project's page a view is shown in. */
export function useProject(): ProjectContext {
  return useOutletContext<ProjectContext>()
}

/** Whether `role` may change the project's plan (FR-108): unknown counts as yes. */
export function canEditPlan(role: Role | undefined): boolean {
  return role === undefined || role === 'read-write' || role === 'admin'
}

/** Whether `role` may manage the project's members and settings (FR-109): unknown counts as yes. */
export function canAdminister(role: Role | undefined): boolean {
  return role === undefined || role === 'admin'
}
