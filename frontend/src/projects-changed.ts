import { createContext, useContext } from 'react'

/**
 * Tells the layout that the projects the signed-in person can read have changed, as when they
 * create one (SC-079) or leave one (SC-080), so that its navigation lists them afresh.
 */
export const ProjectsChangedContext = createContext<() => void>(() => {})

/** The way to tell the layout that the projects the signed-in person can read have changed. */
export function useProjectsChanged(): () => void {
  return useContext(ProjectsChangedContext)
}
