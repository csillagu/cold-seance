import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, ApiError } from '../api.ts'
import {
  addableRepositories,
  askedOutcome,
  type ProjectRepository,
  type ReceivingRepository,
  type RepositoryRow,
  repositoryRows,
  waitingRequests,
} from '../repositories/project-settings.ts'
import { fullName, type Repository } from '../repositories/repository.ts'
import type { RepositoryRequest } from '../repositories/request.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { messageOf } from './accounts.ts'
import { useProject } from './project-context.ts'
import './accounts.css'
import './members.css'
import './pages.css'
import './project-repositories.css'
import './repositories.css'

interface Settings {
  rows: RepositoryRow[]
  waiting: RepositoryRequest[]
  addable: Repository[]
}

type Loaded =
  | { state: 'loading' }
  | { state: 'loaded'; settings: Settings }
  | { state: 'failed'; message: string }

/**
 * The project repository settings screen (SC-081), at `/projects/<id>/repositories`, inside the
 * project's page. The project's admin chooses a registered repository and asks to add it, for the
 * project to pull its issues (FR-142); the screen then says the outcome: added at once when they
 * are also the repository's admin (FR-170), or else waiting for one of its admins' approval, and
 * lists the requests still waiting. On the same table, the receiving project control (SC-112):
 * the admin marks the project as a repository's receiving project (FR-143), sees the marking
 * refused while another project holds the role, and gives the role up (FR-180). The REST API
 * decides who may do what; the screen shows each refusal in the API's own words. As on the
 * members screen, the controls are shown to everyone who can read the project, as someone may be
 * its admin through a group (FR-111).
 */
export function ProjectRepositoriesPage() {
  const project = useProject()
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [chosen, setChosen] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | undefined>()
  const base = `/projects/${encodeURIComponent(project.id)}`

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [pulled, receiving, requests, registered] = await Promise.all([
          api<ProjectRepository[]>(`${base}/repositories`, { signal }),
          api<ReceivingRepository[]>(`${base}/receiving-repositories`, { signal }),
          api<RepositoryRequest[]>(`${base}/repository-requests`, { signal }),
          api<Repository[]>('/repositories', { signal }),
        ])
        setLoaded({
          state: 'loaded',
          settings: {
            rows: repositoryRows(pulled, receiving),
            waiting: waitingRequests(requests),
            addable: addableRepositories(registered, pulled, requests),
          },
        })
      } catch (error) {
        if (signal?.aborted || toSignIn(error)) return
        setLoaded({
          state: 'failed',
          message:
            error instanceof ApiError && error.status === 403
              ? error.message
              : "The project's repositories could not be loaded.",
        })
      }
    },
    [base, toSignIn],
  )

  useEffect(() => {
    const abort = new AbortController()
    setLoaded({ state: 'loading' })
    void load(abort.signal)
    return () => abort.abort()
  }, [load])

  /** Runs one change, then reads the settings afresh and says how it went. */
  const change = async (request: () => Promise<string>) => {
    setBusy(true)
    try {
      setOutcome({ ok: true, text: await request() })
      return true
    } catch (error) {
      if (!toSignIn(error)) setOutcome({ ok: false, text: messageOf(error) })
      return false
    } finally {
      // Read afresh either way: a refusal may mean someone else has changed them meanwhile.
      await load()
      setBusy(false)
    }
  }

  const ask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const asked = await change(async () =>
      askedOutcome(
        await api<RepositoryRequest>(`${base}/repository-requests`, {
          method: 'POST',
          body: { repositoryId: chosen },
        }),
      ),
    )
    if (asked) setChosen('')
  }

  const receivingPath = (row: RepositoryRow) =>
    `${base}/receiving-repositories/${encodeURIComponent(row.repository.id)}`

  const mark = (row: RepositoryRow) =>
    change(async () => {
      await api(receivingPath(row), { method: 'PUT', body: {} })
      return `${project.name} is now the receiving project of ${fullName(row.repository)}.`
    })

  const giveUp = (row: RepositoryRow) =>
    change(async () => {
      await api(receivingPath(row), { method: 'DELETE' })
      return `${project.name} is no longer the receiving project of ${fullName(row.repository)}.`
    })

  if (loaded.state === 'loading') return <p className="page__note">Loading…</p>
  if (loaded.state === 'failed') {
    return (
      <p role="alert" className="page__note">
        {loaded.message}
      </p>
    )
  }
  const { rows, waiting, addable } = loaded.settings

  return (
    <section>
      <form
        className="account__card account__form"
        aria-labelledby="add-repository"
        onSubmit={(event) => void ask(event)}
      >
        <h2 className="account__card-title" id="add-repository">
          Add a repository
        </h2>
        <p className="page__note">
          {project.name} pulls the issues of a repository once one of the repository&apos;s admins
          approves it, or at once if you are one.
        </p>
        {addable.length === 0 ? (
          <p className="page__note">
            No other registered repository can be added. A repository is registered on the{' '}
            <Link to="/repositories">repositories</Link> screen.
          </p>
        ) : (
          <div className="account__fields">
            <div className="account__field">
              <label htmlFor="repository-choice">Repository</label>
              <select
                id="repository-choice"
                required
                value={chosen}
                onChange={(event) => setChosen(event.target.value)}
              >
                <option value="">Choose a repository</option>
                {addable.map((repository) => (
                  <option key={repository.id} value={repository.id}>
                    {fullName(repository)}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="account__button" disabled={busy || chosen === ''}>
              Add repository
            </button>
          </div>
        )}
      </form>

      {outcome !== undefined && (
        <p
          role={outcome.ok ? 'status' : 'alert'}
          className={outcome.ok ? 'account__done' : 'account__failed'}
        >
          {outcome.text}
        </p>
      )}

      <div className="project-repositories__group">
        <h2 className="project-repositories__heading" id="pulled-repositories">
          Repositories {project.name} pulls issues from
        </h2>
        {rows.length === 0 ? (
          <p className="page__note">{project.name} pulls issues from no repository.</p>
        ) : (
          <div className="account__scroll">
            <table className="account__table" aria-labelledby="pulled-repositories">
              <thead>
                <tr>
                  <th scope="col">Repository</th>
                  <th scope="col">Receiving project</th>
                  <th scope="col" className="account__end">
                    <span className="account__hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.repository.id}>
                    <th scope="row" className="account__name">
                      <Link
                        className="repositories__link"
                        to={`/repositories/${encodeURIComponent(row.repository.id)}`}
                      >
                        {fullName(row.repository)}
                      </Link>
                    </th>
                    <td>{receivingText(row, project.name)}</td>
                    <td className="account__end">
                      {row.receiving ? (
                        <button
                          type="button"
                          className="account__button account__button--danger"
                          disabled={busy}
                          aria-label={`Give up receiving ${fullName(row.repository)}`}
                          onClick={() => void giveUp(row)}
                        >
                          Give up receiving
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="account__button"
                          disabled={busy}
                          aria-label={`Mark ${project.name} as receiving ${fullName(row.repository)}`}
                          onClick={() => void mark(row)}
                        >
                          Mark as receiving
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="page__note members__note">
          A repository&apos;s new issues go to its one receiving project. Only the project&apos;s
          admins can add repositories and mark or give up the role.
        </p>
      </div>

      <div className="project-repositories__group">
        <h2 className="project-repositories__heading" id="waiting-requests">
          Waiting for approval
        </h2>
        {waiting.length === 0 ? (
          <p className="page__note">No request is waiting.</p>
        ) : (
          <div className="account__scroll">
            <table className="account__table" aria-labelledby="waiting-requests">
              <thead>
                <tr>
                  <th scope="col">Repository</th>
                  <th scope="col">Asked by</th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((request) => (
                  <tr key={request.id}>
                    <th scope="row" className="account__name">
                      {fullName(request.repository)}
                    </th>
                    <td>{request.requestedBy.username}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

/** What the table says of the project's role for the repository of `row`. */
function receivingText(row: RepositoryRow, project: string): string {
  if (!row.receiving) return 'Not this project'
  return row.pulls
    ? project
    : `${project}, which no longer pulls its issues: no project receives them until it gives the role up`
}
