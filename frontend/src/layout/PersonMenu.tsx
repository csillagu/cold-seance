import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { avatarColour } from '../gantt/avatar.ts'
import type { SignedInAccount } from '../signed-in.ts'
import './person-menu.css'

/**
 * The signed-in person in the layout's header (SC-115), shown by their initials and username.
 * Clicking it brings up settings, calendar and API tokens (SRC-221): settings opens the GitHub
 * account link (SC-077) and the capacity and absences screen (SC-088) (SRC-226), calendar the
 * personal working calendar (SC-089) (SRC-227), and API tokens the personal access token page
 * (SC-078).
 *
 * The entries close again on Escape, on a click outside them, and when the browser goes to another
 * page.
 */
export function PersonMenu({ account }: { account: SignedInAccount }) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const entriesId = useId()

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!open) return undefined
    const closeOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
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
        onClick={() => setOpen((was) => !was)}
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
          </ul>
          <hr className="person-menu__divider" />
          <Link to="/settings/calendar" className="person-menu__link">
            Calendar
          </Link>
          <Link to="/tokens" className="person-menu__link">
            API tokens
          </Link>
        </nav>
      )}
    </div>
  )
}
