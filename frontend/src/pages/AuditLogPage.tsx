import { useEffect, useState } from 'react'
import { api } from '../api.ts'
import { AuditLog } from '../audit/AuditLog.tsx'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import './pages.css'

/**
 * The whole audit log (SC-094), at `/audit-log`, which only system admins may read (FR-138); the
 * navigation leads system admins to it. Each entry names its project where the reader can see it,
 * and gives the project's id otherwise.
 */
export function AuditLogPage() {
  const toSignIn = useSignInRedirect()
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map())

  useEffect(() => {
    const abort = new AbortController()
    api<{ id: string; name: string }[]>('/projects', { signal: abort.signal }).then(
      (projects) => setNames(new Map(projects.map((project) => [project.id, project.name]))),
      (error: unknown) => {
        // Without them, the log gives each project's id.
        if (!abort.signal.aborted) toSignIn(error)
      },
    )
    return () => abort.abort()
  }, [toSignIn])

  return (
    <section>
      <h1 className="page__title">Audit log</h1>
      <p className="page__note">Every change made in the tool, newest first.</p>
      <AuditLog projectNames={names} />
    </section>
  )
}
