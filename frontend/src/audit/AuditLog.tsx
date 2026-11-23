import { useEffect, useState } from 'react'
import { api, ApiError } from '../api.ts'
import { messageOf } from '../pages/accounts.ts'
import { formatWhen } from '../proposals/proposal.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import {
  type AuditEntry,
  describeAction,
  describeActor,
  describeChannels,
  describeDetails,
  describeSubject,
} from './audit-entry.ts'
import './audit.css'

/** How many entries the screen reads at a time. */
export const PAGE_SIZE = 50

type Log =
  | { state: 'loading' }
  | { state: 'loaded'; entries: AuditEntry[]; more: boolean }
  | { state: 'refused'; message: string }
  | { state: 'failed' }

/**
 * The audit log (SC-094): its entries, newest first, each with who made the change, when, through
 * which channel and what it changed (FR-116). Given a project, it shows that project's part of the
 * log; without one, the whole log, with the project of each entry, named from `projectNames` where
 * it is among them. Ids in an entry's details are named from `projectNames` too, where they are
 * among them, and shortened otherwise. Who may read which is the service layer's to decide (FR-138, DD-039): someone
 * it refuses is shown its refusal, and nothing of the log. Older entries are read a page at a time.
 */
export function AuditLog({
  projectId,
  projectNames,
}: {
  projectId?: string
  projectNames?: ReadonlyMap<string, string>
}) {
  const toSignIn = useSignInRedirect()
  const [log, setLog] = useState<Log>({ state: 'loading' })
  const [busy, setBusy] = useState(false)
  const [olderFailed, setOlderFailed] = useState<string | undefined>()

  useEffect(() => {
    const abort = new AbortController()
    setLog({ state: 'loading' })
    setOlderFailed(undefined)
    read(projectId, undefined, abort.signal).then(
      (entries) =>
        setLog({
          state: 'loaded',
          entries: entries.slice(0, PAGE_SIZE),
          more: entries.length > PAGE_SIZE,
        }),
      (error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          setLog({ state: 'refused', message: error.message })
        } else {
          setLog({ state: 'failed' })
        }
      },
    )
    return () => abort.abort()
  }, [projectId, toSignIn])

  const readOlder = async (entries: AuditEntry[]) => {
    const last = entries.at(-1)
    if (last === undefined) return
    setBusy(true)
    setOlderFailed(undefined)
    try {
      const older = await read(projectId, last.id)
      setLog({
        state: 'loaded',
        entries: [...entries, ...older.slice(0, PAGE_SIZE)],
        more: older.length > PAGE_SIZE,
      })
    } catch (error) {
      if (!toSignIn(error)) setOlderFailed(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  switch (log.state) {
    case 'loading':
      return <p className="page__note">Loading…</p>
    case 'failed':
      return (
        <p role="alert" className="page__note">
          The audit log could not be loaded.
        </p>
      )
    case 'refused':
      return (
        <section className="page__notice audit__refused" role="alert">
          <h2 className="page__notice-title">{log.message}</h2>
        </section>
      )
    case 'loaded':
      break
  }
  if (log.entries.length === 0) {
    return <p className="page__note">The audit log holds no entries yet.</p>
  }
  const whole = projectId === undefined
  return (
    <>
      <div className="audit__scroll">
        <table className="audit__table" aria-label="Audit log">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">Channel</th>
              {whole && <th scope="col">Project</th>}
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {log.entries.map((entry) => (
              <tr key={entry.id}>
                <td className="audit__when">
                  <time dateTime={entry.at}>{formatWhen(entry.at)}</time>
                </td>
                <td className="audit__who">{describeActor(entry.by)}</td>
                <td>{describeChannels(entry.channels)}</td>
                {whole && <td>{projectOf(entry.projectId, projectNames)}</td>}
                <td>
                  <span className="audit__action">{describeAction(entry.action)}</span>
                  <Details entry={entry} names={projectNames} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {olderFailed !== undefined && (
        <p role="alert" className="audit__failed">
          {olderFailed}
        </p>
      )}
      {log.more && (
        <button
          type="button"
          className="audit__more"
          disabled={busy}
          onClick={() => void readOlder(log.entries)}
        >
          Show older entries
        </button>
      )}
    </>
  )
}

/**
 * Reads a page of the log, older than the entry `before` if given. It asks for one entry more than
 * a page, to know whether there are older ones still.
 */
function read(
  projectId: string | undefined,
  before: number | undefined,
  signal?: AbortSignal,
): Promise<AuditEntry[]> {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE + 1) })
  if (projectId !== undefined) query.set('projectId', projectId)
  if (before !== undefined) query.set('before', String(before))
  return api<AuditEntry[]>(`/audit-log?${query.toString()}`, signal ? { signal } : {})
}

function projectOf(
  projectId: string | null,
  projectNames: ReadonlyMap<string, string> | undefined,
): string {
  if (projectId === null) return 'None'
  return projectNames?.get(projectId) ?? projectId
}

function Details({
  entry,
  names,
}: {
  entry: AuditEntry
  names: ReadonlyMap<string, string> | undefined
}) {
  const described = describeDetails(entry.details, names)
  // An entry with no details says at least what it was about (#256).
  const lines = described.length > 0 ? described : [describeSubject(entry.subject, names)]
  return (
    <ul className="audit__details">
      {lines.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
    </ul>
  )
}
