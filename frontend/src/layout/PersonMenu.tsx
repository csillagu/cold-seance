import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { api } from '../api.ts'
import { avatarColour } from '../gantt/avatar.ts'
import { SIGN_IN_PATH } from '../sign-in-redirect.ts'
import type { SignedInAccount } from '../signed-in.ts'
import './person-menu.css'

/**
 * The signed-in person in the layout's header (SC-115), shown by their initials and username.
 * Clicking it brings up settings, calendar and API tokens (SRC-221): settings opens the GitHub
 * account link (SC-077) and the capacity and absences screen (SC-088) (SRC-226), calendar the
 * personal working calendar (SC-089) (SRC-227), and API tokens the personal access token page
 * (SC-078). The entries are named as the navigation names them, all four under one heading
 * (#256). Below them, "Sign out" ends the session (`DELETE /api/session`) and goes to the sign-in
 * page.
 *
 * The entries close again on Escape, on a click outside them, and when the browser goes to another
 * page.
 */
export function PersonMenu({ account }: { account: SignedInAccount }) {
  const location = useLocation()
  // The page the entries were opened on: they count as open only while the browser is still on it,
  // so going to another page closes them. Kept as state rather than closed by an effect, which a
  // click right after the menu appears could otherwise race and lose.
  const [openOn, setOpenOn] = useState<string | undefined>()
  const open = openOn === location.pathname
  const setOpen = (next: boolean) => setOpenOn(next ? location.pathname : undefined)
  const root = useRef<HTMLDivElement>(null)
  const entriesId = useId()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)
  const [signOutFailed, setSignOutFailed] = useState(false)

  const signOut = async () => {
    setSigningOut(true)
    setSignOutFailed(false)
    try {
      await api('/session', { method: 'DELETE' })
      void navigate(SIGN_IN_PATH, { replace: true })
    } catch {
      setSignOutFailed(true)
      setSigningOut(false)
    }
  }

  useEffect(() => {
    if (!open) return undefined
    const closeOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpenOn(undefined)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [open])

  return (
    <div
      ref={root}
      className="person-menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <button
        type="button"
        className="person-menu__button"
        aria-expanded={open}
        aria-controls={entriesId}
        onClick={() => setOpen(!open)}
      >
        <span
          className="person-menu__avatar"
          style={{ background: avatarColour(account.id) }}
          aria-hidden="true"
        >
          {account.username.slice(0, 2).toUpperCase()}
        </span>
        <span className="person-menu__name">{account.username}</span>
      </button>
      {open && (
        <nav id={entriesId} className="person-menu__entries" aria-label="Your account">
          <h2 className="person-menu__heading" id={`${entriesId}-settings`}>
            Settings
          </h2>
          <ul className="person-menu__list" aria-labelledby={`${entriesId}-settings`}>
            <li>
              <Link to="/settings/github" className="person-menu__link">
                GitHub account
              </Link>
            </li>
            <li>
              <Link to="/settings/capacity" className="person-menu__link">
                Capacity and absences
              </Link>
            </li>
            <li>
              <Link to="/settings/calendar" className="person-menu__link">
                Working calendar
              </Link>
            </li>
            <li>
              <Link to="/tokens" className="person-menu__link">
                API tokens
              </Link>
            </li>
          </ul>
          <hr className="person-menu__divider" />
          <button
            type="button"
            className="person-menu__link person-menu__sign-out"
            disabled={signingOut}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
          {signOutFailed && (
            <p role="alert" className="person-menu__error">
              Signing out failed. Try again.
            </p>
          )}
        </nav>
      )}
    </div>
  )
}
