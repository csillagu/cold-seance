import { type FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, ApiError } from '../api.ts'
import type { ProjectRepository } from '../repositories/project-settings.ts'
import { fullName } from '../repositories/repository.ts'
import { failedOutcome, type SeedingResult, seededOutcome } from '../repositories/seeding.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { useProject } from './project-context.ts'
import './accounts.css'
import './pages.css'
import './project-seeding.css'

type Loaded =
  | { state: 'loading' }
  | { state: 'loaded'; repositories: ProjectRepository[] }
  | { state: 'failed'; message: string }

/**
 * The project seeding screen (SC-095), at `/projects/<id>/seeding`, inside the project's page. The
 * project's admin chooses one or more of the repositories the project pulls issues from, which is
 * to say the approved ones (FR-102), starts the import, and sees whether it succeeded or failed as
 * a whole and brought nothing in (FR-137). The REST API decides who may seed and what is brought
 * in (SC-025); the screen shows each refusal in the API's own words. As on the repository
 * settings, the controls are shown to everyone who can read the project, as someone may be its
 * admin through a group (FR-111).
 */
export function ProjectSeedingPage() {
  const project = useProject()
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | undefined>()
  const base = `/projects/${encodeURIComponent(project.id)}`

  useEffect(() => {
    const abort = new AbortController()
    setLoaded({ state: 'loading' })
    api<ProjectRepository[]>(`${base}/repositories`, { signal: abort.signal }).then(
      (repositories) =>
        setLoaded({
          state: 'loaded',
          repositories: repositories.toSorted((a, b) => fullName(a).localeCompare(fullName(b))),
        }),
      (error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        setLoaded({
          state: 'failed',
          message:
            error instanceof ApiError && error.status === 403
              ? error.message
              : "The project's repositories could not be loaded.",
        })
      },
    )
    return () => abort.abort()
  }, [base, toSignIn])

  const seed = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setOutcome(undefined)
    try {
      const result = await api<SeedingResult>(`${base}/seeding`, {
        method: 'POST',
        body: { repositoryIds: chosen },
      })
      setOutcome({ ok: true, text: seededOutcome(result) })
      setChosen([])
    } catch (error) {
      if (!toSignIn(error)) setOutcome({ ok: false, text: failedOutcome(error) })
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string, on: boolean) =>
    setChosen((current) => (on ? [...current, id] : current.filter((c) => c !== id)))

  if (loaded.state === 'loading') return <p className="page__note">Loading…</p>
  if (loaded.state === 'failed') {
    return (
      <p role="alert" className="page__note">
        {loaded.message}
      </p>
    )
  }
  const { repositories } = loaded

  return (
    <section>
      <form
        className="account__card account__form"
        aria-labelledby="seed-project"
        onSubmit={(event) => void seed(event)}
      >
        <h2 className="account__card-title" id="seed-project">
          Seed {project.name} from GitHub
        </h2>
        <p className="page__note">
          The issues of the repositories you choose become tasks of {project.name}, with their
          sub-issues, blocked-by relations, assignees and status. The import brings in everything or
          nothing. Only the project&apos;s admins can seed it.
        </p>
        {repositories.length === 0 ? (
          <p className="page__note">
            {project.name} pulls issues from no repository, so there is none to seed it from. A
            repository is added on the <Link to={`${base}/repositories`}>repository settings</Link>.
          </p>
        ) : (
          <div className="account__fields">
            <fieldset className="project-seeding__repositories">
              <legend className="account__hidden">Repositories to seed from</legend>
              {repositories.map((repository) => (
                <label key={repository.id} className="project-seeding__repository">
                  <input
                    type="checkbox"
                    checked={chosen.includes(repository.id)}
                    disabled={busy}
                    onChange={(event) => toggle(repository.id, event.target.checked)}
                  />
                  <span className="account__mono">{fullName(repository)}</span>
                </label>
              ))}
            </fieldset>
            <button
              type="submit"
              className="account__button"
              disabled={busy || chosen.length === 0}
            >
              {busy ? 'Seeding…' : 'Start seeding'}
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
    </section>
  )
}
