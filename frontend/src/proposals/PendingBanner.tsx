import { Link } from 'react-router'
import type { PendingSummary } from './overlay.ts'
import './overlay.css'

/**
 * Above the Gantt or the Kanban, one line for each proposal under review that changes the project,
 * as the approved design draws it (SRC-249): how many of its changes the view shows as pending,
 * or why they cannot be shown, and a link to review it (SC-068, SC-030, FR-073). `null` says the
 * proposals under review could not be read; the view then shows the live plan alone.
 */
export function PendingBanner({ summaries }: { summaries: readonly PendingSummary[] | null }) {
  if (summaries === null) {
    return (
      <p role="alert" className="pending-banner pending-banner--failed">
        The proposals under review could not be loaded, so none is shown.
      </p>
    )
  }
  if (summaries.length === 0) return null
  return (
    <ul className="pending-banners" aria-label="Proposals under review">
      {summaries.map((summary) => (
        <li key={summary.proposalId} className="pending-banner">
          <span className="pending-banner__dot" aria-hidden="true" />
          <span>
            {summary.refused === null
              ? `AI proposal under review: ${summary.changes} ${summary.changes === 1 ? 'change' : 'changes'} shown as pending`
              : `AI proposal under review: its changes cannot be shown on the plan as it is now. ${summary.refused}`}
          </span>
          <Link
            className="pending-banner__review"
            to={`/proposals/${encodeURIComponent(summary.proposalId)}`}
          >
            Review
          </Link>
        </li>
      ))}
    </ul>
  )
}
