import { useMemo } from 'react'
import { AuditLog } from '../audit/AuditLog.tsx'
import { useProject } from './project-context.ts'

/**
 * A project's part of the audit log (SC-094), at `/projects/<id>/audit-log`, which system admins
 * and the project's admins and read-write members may read (FR-138); anyone else is shown the
 * refusal.
 */
export function ProjectAuditLogPage() {
  const project = useProject()
  // Ids of the project in its entries read as its name.
  const names = useMemo(() => new Map([[project.id, project.name]]), [project.id, project.name])
  return (
    <section aria-label={`Audit log of ${project.name}`}>
      <p className="page__note">Every change made in {project.name}, newest first.</p>
      <AuditLog projectId={project.id} projectNames={names} />
    </section>
  )
}
