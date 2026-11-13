import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../api.ts'
import { useProjectsChanged } from '../projects-changed.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { messageOf } from './accounts.ts'
import './accounts.css'
import './pages.css'

/**
 * The project creation form (SC-079), at `/projects/new`: anyone with an account creates a project
 * (FR-119, DD-035) and becomes its admin (FR-158). A name another project already has is refused
 * (FR-120), and the form says so with the REST API's own words. Once the project is created, the
 * navigation lists it and its page is opened.
 */
export function NewProjectPage() {
  const toSignIn = useSignInRedirect()
  const navigate = useNavigate()
  const projectsChanged = useProjectsChanged()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>()

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setFailure(undefined)
    try {
      const created = await api<{ id: string; name: string }>('/projects', {
        method: 'POST',
        body: { name },
      })
      projectsChanged()
      void navigate(`/projects/${created.id}`)
    } catch (error) {
      if (!toSignIn(error)) setFailure(messageOf(error))
      setBusy(false)
    }
  }

  return (
    <section>
      <h1 className="page__title">New project</h1>
      <p className="page__note">
        Anyone with an account can create a project, and becomes its admin.
      </p>

      <form
        className="account__card account__form"
        aria-labelledby="create-project"
        onSubmit={(event) => void create(event)}
      >
        <h2 className="account__card-title" id="create-project">
          Create a project
        </h2>
        <div className="account__fields">
          <div className="account__field">
            <label htmlFor="new-project-name">Project name</label>
            <input
              id="new-project-name"
              type="text"
              autoComplete="off"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <button type="submit" className="account__button" disabled={busy}>
            Create project
          </button>
        </div>
      </form>

      {failure !== undefined && (
        <p role="alert" className="account__failed">
          {failure}
        </p>
      )}
    </section>
  )
}
