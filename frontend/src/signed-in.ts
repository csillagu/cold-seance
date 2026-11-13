import { createContext, useContext } from 'react'

/** The signed-in person's account, as `GET /api/session` gives it. */
export interface SignedInAccount {
  id: string
  username: string
  systemAdmin: boolean
}

/**
 * Who is signed in, as the layout learns it: `undefined` until it is known, or if it could not be
 * read. The pages inside the layout read it with `useSignedIn()`.
 */
export const SignedInContext = createContext<SignedInAccount | undefined>(undefined)

/** The signed-in person's account, or `undefined` while it is not known. */
export function useSignedIn(): SignedInAccount | undefined {
  return useContext(SignedInContext)
}
