import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api, ApiError } from '../api.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { RepositoryField, TaskDetailsFields } from '../tasks/TaskDetailsFields.tsx'
import {
  detailsProblem,
  newDetailsDraft,
  newTaskFields,
  type Repository,
} from '../tasks/task-details.ts'
import { useProject } from './project-context.ts'
import '../tasks/task-editors.css'
import '../tasks/task-details.css'
import './pages.css'

/** What the API said when it refused, or a plain word when it said nothing. */
function refusal(error: unknown): string {
  return error instanceof ApiError ? error.message : 'The task could not be created. Try again.'
}

/**
 * Creating a task in a project, at `/projects/<id>/tasks/new`, with the task details editor
 * (SC-098): its title, description, planned dates or none (FR-003), duration in whole working days
 * (FR-002), effort, AI share and, optionally, one of the repositories the project pulls issues
 * from (FR-141). A duration of 0 makes it a milestone, fixed to its planned start or floating
 * (FR-212). Once created, the task's page opens, where who can do it and who will do it are
 * set. The REST API decides by the viewer's role whether they may create it, and the page says so
 * in the API's words.
 */
export function NewTaskPage() {
  const project = useProject()
  const toSignIn = useSignInRedirect()
  const navigate = useNavigate()
  const [draft, setDraft] = useState(newDetailsDraft)
  const [repositoryId, setRepositoryId] = useState('')
  const [repositories, setRepositories] = useState<Repository[] | 'failed' | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A task created whose repository could not be assigned: it is there, unassigned.
  const [created, setCreated] = useState<string | null>(null)

  useEffect(() => {
    const abort = new AbortController()
    api<Repository[]>(`/projects/${encodeURIComponent(project.id)}/repositories`, {
      signal: abort.signal,
    }).then(setRepositories, (failure: unknown) => {
      if (!abort.signal.aborted && !toSignIn(failure)) setRepositories('failed')
    })
    return () => abort.abort()
  }, [project.id, toSignIn])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const problem = detailsProblem(draft, true)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setSaving(true)
    let id: string
    try {
      const task = await api<{ id: string }>(`/projects/${encodeURIComponent(project.id)}/tasks`, {
        method: 'POST',
        body: newTaskFields(draft),
      })
      id = task.id
    } catch (failure) {
      if (!toSignIn(failure)) setError(refusal(failure))
      setSaving(false)
      return
    }
    const page = `/tasks/${encodeURIComponent(id)}`
    if (repositoryId !== '') {
      try {
        await api(`${page}/repository`, { method: 'PUT', body: { repositoryId } })
      } catch (failure) {
        if (toSignIn(failure)) return
        setError(refusal(failure))
        setCreated(page)
        setSaving(false)
        return
      }
    }
    void navigate(page)
  }

  return (
    <form
      className="task-page__card"
      aria-labelledby="new-task-heading"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <h2 id="new-task-heading" className="task-page__heading">
        New task
      </h2>
      <TaskDetailsFields draft={draft} onChange={setDraft} creating offerPersonLoad />
      {repositories === 'failed' ? (
        <p className="task-editor__muted">The repositories could not be loaded.</p>
      ) : repositories === null ? null : repositories.length === 0 ? (
        <p className="task-editor__muted">The project pulls issues from no repository.</p>
      ) : (
        <RepositoryField
          value={repositoryId}
          repositories={repositories}
          allowNone
          onChange={setRepositoryId}
        />
      )}
      {error ? (
        <p role="alert" className="task-page__error">
          {created ? 'The task was created, but not assigned to the repository: ' : ''}
          {error}
        </p>
      ) : null}
      <div className="task-editor__row">
        {created ? (
          <Link to={created} className="task-editor__button">
            Open the task
          </Link>
        ) : (
          <button
            type="submit"
            className="task-editor__button task-editor__button--primary"
            disabled={saving}
          >
            Create task
          </button>
        )}
      </div>
    </form>
  )
}
