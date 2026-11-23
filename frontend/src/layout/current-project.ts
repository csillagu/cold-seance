import { createContext, useContext, useEffect } from 'react'

/**
 * Tells the layout which project a page outside `/projects/<id>` belongs to, such as a task's page
 * (`/tasks/<id>`), so that the navigation still marks that project as the current one (#256).
 */
export const CurrentProjectContext = createContext<(projectId: string | undefined) => void>(
  () => {},
)

/** Marks `projectId` as the current project in the navigation while the calling page is shown. */
export function useCurrentProject(projectId: string | undefined): void {
  const setCurrent = useContext(CurrentProjectContext)
  useEffect(() => {
    setCurrent(projectId)
    return () => setCurrent(undefined)
  }, [setCurrent, projectId])
}
