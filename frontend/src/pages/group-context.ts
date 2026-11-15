import { useOutletContext } from 'react-router'

/** A group as `GET /api/groups` lists it. */
export interface GroupContext {
  id: string
  name: string
}

/** The group of the group's page a screen is shown in. */
export function useGroup(): GroupContext {
  return useOutletContext<GroupContext>()
}
