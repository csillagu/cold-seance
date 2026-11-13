import { useEffect, useRef, useState } from 'react'
import { api } from '../api.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import './gantt-export.css'

type Export = { state: 'loading' } | { state: 'loaded'; markdown: string } | { state: 'failed' }

interface ExportDialogProps {
  projectId: string
  projectName: string
  /** Closes the dialog. */
  onClose: () => void
}

/**
 * The Gantt export dialog (SC-096): the project's Gantt as a Mermaid gantt chart, to copy into
 * GitHub markdown, where it renders as a chart (FR-063, DD-004). The chart is the Mermaid Gantt
 * exporter's (SC-021), read through the REST API when the dialog opens: it carries the tasks, their
 * dates, dependencies and milestones, and leaves out load and red flags.
 */
export function ExportDialog({ projectId, projectName, onClose }: ExportDialogProps) {
  const toSignIn = useSignInRedirect()
  const [exported, setExported] = useState<Export>({ state: 'loading' })
  const [copied, setCopied] = useState(false)
  const text = useRef<HTMLTextAreaElement>(null)
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const abort = new AbortController()
    api<{ markdown: string }>(`/projects/${encodeURIComponent(projectId)}/gantt/mermaid`, {
      signal: abort.signal,
    }).then(
      ({ markdown }) => setExported({ state: 'loaded', markdown }),
      (error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        setExported({ state: 'failed' })
      },
    )
    return () => abort.abort()
  }, [projectId, toSignIn])

  useEffect(() => {
    if (exported.state === 'loaded') text.current?.select()
    else dialog.current?.focus()
  }, [exported.state])

  const copy = async (markdown: string) => {
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
    } catch {
      // The browser refused; the chart is selected in the box, to copy by hand.
      text.current?.select()
    }
  }

  return (
    <div className="gantt-export__backdrop">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gantt-export-title"
        tabIndex={-1}
        className="gantt-export"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <h2 id="gantt-export-title" className="gantt-export__title">
          Export as Mermaid
        </h2>
        <p className="gantt-export__note">
          The Gantt of {projectName} as a Mermaid chart. Paste it into a markdown file, issue or
          comment on GitHub, which draws it as a chart: the tasks, their dates, dependencies and
          milestones. Load and red flags are not part of it.
        </p>
        {exported.state === 'loading' && <p className="gantt-export__note">Loading…</p>}
        {exported.state === 'failed' && (
          <p role="alert" className="gantt-export__note">
            The Gantt could not be exported.
          </p>
        )}
        {exported.state === 'loaded' && (
          <>
            <label htmlFor="gantt-export-text" className="gantt-export__label">
              Mermaid chart
            </label>
            <textarea
              id="gantt-export-text"
              ref={text}
              className="gantt-export__text"
              readOnly
              spellCheck={false}
              rows={Math.min(20, exported.markdown.split('\n').length)}
              value={exported.markdown}
            />
          </>
        )}
        <div className="gantt-export__actions">
          {copied && (
            <span role="status" className="gantt-export__copied">
              Copied
            </span>
          )}
          {exported.state === 'loaded' && (
            <button
              type="button"
              className="gantt__button gantt__button--primary"
              onClick={() => void copy(exported.markdown)}
            >
              Copy
            </button>
          )}
          <button type="button" className="gantt__button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
