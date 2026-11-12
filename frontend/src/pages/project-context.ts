import { useOutletContext } from 'react-router'

/** The project a view inside the project's page shows, as the page hands it on. */
export interface ProjectContext {
  id: string
  name: string
}

/** The project of the project's page a view is shown in. */
export function useProject(): ProjectContext {
  return useOutletContext<ProjectContext>()
}
