import { useState } from 'react'
import type { Part } from './review.ts'

export interface ReviewControlsProps {
  /** The proposal's parts, one for each project it changes. */
  parts: readonly Part[]
  /** Whether the proposal still waits for review: only then can it be approved or rejected. */
  canAct: boolean
  busy: boolean
  /**
   * The tasks of the live plan that changed since the reviewer opened the preview, in words, when
   * the plan changed before their approval and they must confirm again; null otherwise.
   */
  confirmAgain: readonly string[] | null
  /** The API's refusal of the last approval or rejection, if any. */
  error: string | null
  onApprove: (projectId: string) => void
  onReject: () => void
}

/**
 * The proposal approve and reject controls (SC-072), on the proposal's page beside its preview.
 * The reviewer approves each project's part they may approve, against the preview on the page
 * (FR-077), or rejects the whole proposal, after a second click to confirm (FR-075). When the plan
 * changed since the preview, the page shows the refreshed preview and what changed in the plan,
 * and asks the reviewer to confirm again (FR-078). Who may approve or reject is the REST API's to
 * say, by their role; the controls show its refusal to anyone else.
 */
export function ReviewControls({
  parts,
  canAct,
  busy,
  confirmAgain,
  error,
  onApprove,
  onReject,
}: ReviewControlsProps) {
  const [rejecting, setRejecting] = useState(false)
  const single = parts.length === 1
  return (
    <section className="proposal-review" aria-labelledby="proposal-review">
      <h2 className="proposal__heading" id="proposal-review">
        Review
      </h2>
      {confirmAgain !== null && (
        <div className="proposal-review__again" role="alert">
          <p className="proposal-review__again-title">
            The plan changed since you opened this preview. Nothing was approved: check the
            refreshed preview below, and confirm again.
          </p>
          {confirmAgain.length > 0 && (
            <ul className="proposal-review__plan-changes" aria-label="Changed in the plan">
              {confirmAgain.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ul className="proposal-review__parts">
        {parts.map((part) => (
          <li key={part.projectId} className="proposal-review__part">
            <span className="proposal-review__part-name">
              {single ? 'The proposal' : `${part.project}'s part`}
            </span>
            {part.approvedBy !== null ? (
              <span className="proposal-review__approved">Approved by {part.approvedBy}</span>
            ) : canAct ? (
              <button
                type="button"
                className="task-editor__button task-editor__button--primary"
                disabled={busy}
                onClick={() => onApprove(part.projectId)}
              >
                {(confirmAgain !== null ? 'Confirm and approve' : 'Approve') +
                  (single ? '' : ` ${part.project}'s part`)}
              </button>
            ) : (
              <span className="proposal-review__waiting">Not approved</span>
            )}
          </li>
        ))}
      </ul>
      {canAct &&
        (rejecting ? (
          <div className="proposal-edit__actions proposal-review__reject">
            <span>Reject the proposal? Nothing in it will reach the plan.</span>
            <button
              type="button"
              className="task-editor__button proposal-review__reject-button"
              disabled={busy}
              onClick={onReject}
            >
              Yes, reject
            </button>
            <button
              type="button"
              className="task-editor__button task-editor__button--quiet"
              disabled={busy}
              onClick={() => setRejecting(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="proposal-edit__actions proposal-review__reject">
            <button
              type="button"
              className="task-editor__button task-editor__button--quiet"
              disabled={busy}
              onClick={() => setRejecting(true)}
            >
              Reject proposal
            </button>
          </div>
        ))}
      {error !== null && (
        <p role="alert" className="proposal-edit__error">
          {error}
        </p>
      )}
    </section>
  )
}
