import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { isUnauthenticated } from './api.ts'

/** The address of the sign-in page (SC-075). */
export const SIGN_IN_PATH = '/sign-in'

/**
 * The page to go to after signing in: `next` if it is an address of this site, or the start page.
 * An address that leads off the site (`//host`, `https:`) is ignored, so a link to the sign-in
 * page cannot send someone elsewhere once they have signed in.
 */
export function afterSignIn(next: string | null): string {
  if (next === null || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/'
  }
  return next
}

/**
 * Sends the browser to the sign-in page when an API call was refused because no one is signed in,
 * so that it comes back to the current page once signed in. Returns whether it did.
 */
export function useSignInRedirect(): (error: unknown) => boolean {
  const navigate = useNavigate()
  const location = useLocation()
  return useCallback(
    (error: unknown) => {
      if (!isUnauthenticated(error)) return false
      const here = `${location.pathname}${location.search}${location.hash}`
      void navigate(`${SIGN_IN_PATH}?next=${encodeURIComponent(here)}`, { replace: true })
      return true
    },
    [navigate, location],
  )
}
