import { type FormEvent, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import './variance.css'

/** A baseline as the API answers its save (`POST /projects/{id}/baselines`), the fields read. */
export interface SavedBaseline {
  id: string
  name: string
  savedAt: string
}

interface SaveBaselineDialogProps {
  projectId: string
  projectName: string
  /** Called with the baseline once it is saved. */
  onSaved: (baseline: SavedBaseline) => void
  /** Closes the dialog without saving. */
  onClose: () => void
}

/**
 * The baseline save dialog (SC-097): saves, under the name given, a snapshot of every task's
 * planned start and finish in the project (FR-064), next to the baselines it already has
 * (FR-153). Only someone with the read-write role may save one (FR-065); the REST API decides
 * that, and the dialog shows its refusal, as it does a name that is empty, too long or taken.
 */
export function SaveBaselineDialog({
  projectId,
  projectName,
  onSaved,
  onClose,
}: SaveBaselineDialogProps) {
  const toSignIn = useSignInRedirect()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setRefused(null)
    try {
      const saved = await api<SavedBaseline>(
        `/projects/${encodeURIComponent(projectId)}/baselines`,
        {
          method: 'POST',
          body: { name },
        },
      )
      onSaved(saved)
    } catch (error) {
      if (toSignIn(error)) return
      setRefused(
        error instanceof ApiError ? error.message : 'The baseline could not be saved. Try again.',
      )
      setSaving(false)
    }
  }

  return (
    <div className="variance-dialog__backdrop">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="variance-dialog-title"
        className="variance-dialog"
        onSubmit={(event) => void save(event)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <h2 id="variance-dialog-title" className="variance-dialog__title">
          Save baseline
        </h2>
        <p className="variance-dialog__note">
          Keeps the planned start and finish of every task in {projectName} as they are now, under
          the name you give. The project&apos;s other baselines are kept as they are.
        </p>
        <label htmlFor="variance-dialog-name" className="variance-dialog__label">
          Name
        </label>
        <input
          id="variance-dialog-name"
          ref={input}
          className="variance-dialog__input"
          value={name}
          required
          onChange={(event) => setName(event.target.value)}
        />
        {refused !== null && (
          <p role="alert" className="variance-dialog__refusal">
            {refused}
          </p>
        )}
        <div className="variance-dialog__actions">
          <button type="button" className="variance__button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="variance__button variance__button--primary"
            disabled={saving}
          >
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
