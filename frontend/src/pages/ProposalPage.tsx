import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api, ApiError } from '../api.ts'
import {
  type ApiPreview,
  buildPreviewModel,
  type Cell,
  type PreviewModel,
} from '../proposals/preview-model.ts'
import { ConflictPanel } from '../proposals/ConflictPanel.tsx'
import { ProposalEditor } from '../proposals/ProposalEditor.tsx'
import { ReviewControls } from '../proposals/ReviewControls.tsx'
import { type ApiApproval, partsOf, type PlanTask, planChanges } from '../proposals/review.ts'
import {
  type ApiConflict,
  type ApiConflicts,
  type ApiProposal,
  formatWhen,
  PROPOSAL_STATUS_WORDS,
} from '../proposals/proposal.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import '../proposals/proposals.css'
import '../proposals/proposal-edit.css'
import '../proposals/proposal-review.css'
import '../tasks/task-editors.css'

type Loaded =
  | { state: 'loading' }
  | {
      state: 'loaded'
      proposal: ApiProposal
      creator: string
      projects: { id: string; name: string }[]
      /** The live plan's tasks, by id, to name those the proposal's changes name. */
      tasks: ReadonlyMap<string, string>
      /** The members of the projects it changes, by account id, to name people. */
      people: ReadonlyMap<string, string>
      /** The live plan's tasks as read with the preview, to tell what changed in it since. */
      plan: PlanTask[]
      /** The changes that conflict with the live plan (SC-070). */
      conflicts: ApiConflict[]
      /** The preview, or why the proposal cannot be previewed on the plan as it is now. */
      preview: { model: PreviewModel; planVersion: string } | { conflict: string }
    }
  | { state: 'refused'; message: string }
  | { state: 'failed' }

/** What the page says of an address whose proposal id is malformed: no proposal has it. */
export const NO_SUCH_PROPOSAL = 'There is no such proposal'

/**
 * A proposal's live preview (SC-034), at `/proposals/<id>`, with its conflicts (SC-070) and its
 * editor (SC-071). Opening it has the REST API apply the
 * proposal's changes to the current plan without saving them and reschedule (FR-072, DD-021); the
 * page shows each task that would change, before and after, and every red flag the proposal would
 * newly raise. The live plan is left as it is (FR-071), and the proposal too: the preview is
 * worked out again against the plan as it is each time the page is opened, the only adjustment
 * ever made to it (FR-079). Anyone who may read the proposal can open it (FR-106).
 *
 * While the proposal waits for review, the page offers to edit or drop each of its groups of
 * changes, and to resolve or drop each conflict; the REST API allows it only to the read-write
 * members and admins of the projects concerned (FR-074), and the page shows its refusal to anyone
 * else. After each edit or drop the page reads the proposal, its conflicts and its preview again.
 *
 * It also offers to approve each project's part against the preview shown, or to reject the
 * proposal (SC-072). An approval is sent with the version of the plan the preview was made
 * against; when the plan changed since, the REST API approves nothing, and the page reads
 * everything again, shows what changed in the plan, and asks the reviewer to confirm (FR-078).
 */
export function ProposalPage() {
  const { proposalId = '' } = useParams()
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  /** Counts the edits and drops made, so that the page reads the proposal again after each. */
  const [version, setVersion] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  /** The plan as the reviewer saw it, while they must confirm again after it changed. */
  const [seenPlan, setSeenPlan] = useState<PlanTask[] | null>(null)

  useEffect(() => {
    setEditing(null)
    setActionError(null)
    setReviewError(null)
    setSeenPlan(null)
  }, [proposalId])

  useEffect(() => {
    const abort = new AbortController()
    const get = <T,>(path: string) => api<T>(path, { signal: abort.signal })
    const base = `/proposals/${encodeURIComponent(proposalId)}`
    // A first read shows that the page is loading; a read again after an edit keeps what is shown.
    if (version === 0) setLoaded({ state: 'loading' })
    const load = async () => {
      const [proposal, conflicts] = await Promise.all([
        get<ApiProposal>(base),
        get<ApiConflicts>(`${base}/conflicts`),
      ])
      const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`
      const [preview, projects] = await Promise.all([
        get<ApiPreview>(`${base}/preview`).then(
          (found) => ({ found }),
          (error: unknown) => {
            if (error instanceof ApiError && error.status === 409)
              return { conflict: error.message }
            throw error
          },
        ),
        Promise.all(
          proposal.projectIds.map(async (id) => {
            const [project, members, tasks] = await Promise.all([
              get<{ id: string; name: string }>(projectPath(id)),
              get<{ accountId: string; username: string }[]>(`${projectPath(id)}/members`),
              get<PlanTask[]>(`${projectPath(id)}/tasks`),
            ])
            return { project, members, tasks }
          }),
        ),
      ])
      const names = {
        people: new Map(
          projects.flatMap(({ members }) => members.map((m) => [m.accountId, m.username] as const)),
        ),
        projects: new Map(projects.map(({ project }) => [project.id, project.name])),
        tasks: new Map(projects.flatMap(({ tasks }) => tasks.map((t) => [t.id, t.title] as const))),
      }
      setLoaded({
        state: 'loaded',
        proposal,
        creator: names.people.get(proposal.createdBy) ?? 'someone who is not a member',
        projects: projects.map(({ project }) => project),
        tasks: names.tasks,
        people: names.people,
        plan: projects.flatMap(({ tasks }) =>
          tasks.map(({ id, title, plannedStart, plannedFinish }) => ({
            id,
            title,
            plannedStart,
            plannedFinish,
          })),
        ),
        conflicts: conflicts.conflicts,
        preview:
          'conflict' in preview
            ? { conflict: preview.conflict }
            : {
                model: buildPreviewModel(preview.found, names),
                planVersion: preview.found.planVersion,
              },
      })
    }
    load().catch((error: unknown) => {
      if (abort.signal.aborted || toSignIn(error)) return
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        setLoaded({ state: 'refused', message: error.message })
      } else if (error instanceof ApiError && error.status === 400) {
        setLoaded({ state: 'refused', message: NO_SUCH_PROPOSAL })
      } else {
        setLoaded({ state: 'failed' })
      }
    })
    return () => abort.abort()
  }, [proposalId, toSignIn, version])

  /** Sends an edit or a drop, then reads the proposal again; shows the API's refusal, if any. */
  const act = useCallback(
    (request: () => Promise<unknown>) => {
      setBusy(true)
      setActionError(null)
      setReviewError(null)
      request()
        .then(() => {
          setEditing(null)
          setSeenPlan(null)
          setVersion((v) => v + 1)
        })
        .catch((error: unknown) => {
          if (toSignIn(error)) return
          setActionError(
            error instanceof ApiError ? error.message : 'The proposal could not be saved.',
          )
        })
        .finally(() => setBusy(false))
    },
    [toSignIn],
  )
  const groupPath = (groupId: string) =>
    `/proposals/${encodeURIComponent(proposalId)}/groups/${encodeURIComponent(groupId)}`
  const save = (groupId: string, changes: Record<string, unknown>[]) =>
    act(() => api(groupPath(groupId), { method: 'PUT', body: { changes } }))
  const drop = (groupId: string) => act(() => api(groupPath(groupId), { method: 'DELETE' }))
  const edit = (groupId: string) => {
    setActionError(null)
    setEditing(groupId)
  }

  /**
   * Sends an approval or a rejection, then reads everything again; shows the API's refusal, if
   * any. `seen` is the plan the reviewer saw, kept when the API asks them to confirm again.
   */
  const review = (request: () => Promise<PlanTask[] | null>) => {
    setBusy(true)
    setReviewError(null)
    setActionError(null)
    request()
      .then((seen) => {
        setEditing(null)
        setSeenPlan(seen)
        setVersion((v) => v + 1)
      })
      .catch((error: unknown) => {
        if (toSignIn(error)) return
        setReviewError(
          error instanceof ApiError ? error.message : 'The proposal could not be reviewed.',
        )
      })
      .finally(() => setBusy(false))
  }

  switch (loaded.state) {
    case 'loading':
      return <p className="page__note">Loading…</p>
    case 'failed':
      return (
        <p role="alert" className="page__note">
          The proposal could not be loaded.
        </p>
      )
    case 'refused':
      return (
        <section className="page__notice" role="alert">
          <h1 className="page__notice-title">{loaded.message}</h1>
        </section>
      )
    case 'loaded':
      break
  }
  const { proposal, creator, projects, preview, conflicts, tasks, people, plan } = loaded
  const names = { tasks }
  const canAct = proposal.status === 'waiting'
  const base = `/proposals/${encodeURIComponent(proposalId)}`
  const approve = (projectId: string) =>
    review(async () => {
      const answer = await api<ApiApproval>(`${base}/approval`, {
        method: 'POST',
        body: {
          projectId,
          ...('planVersion' in preview ? { planVersion: preview.planVersion } : {}),
        },
      })
      // Seen against the plan of the first preview, if the reviewer is asked again in a row.
      return answer.outcome === 'confirm-again' ? (seenPlan ?? plan) : null
    })
  const reject = () =>
    review(async () => {
      await api(`${base}/rejection`, { method: 'POST', body: {} })
      return null
    })
  return (
    <section className="proposal">
      <h1 className="page__title">Proposal</h1>
      <p className="proposal__meta">
        <span>By {creator}</span>
        <span>Created {formatWhen(proposal.createdAt)}</span>
        <span className={`proposal__status proposal__status--${proposal.status}`}>
          {PROPOSAL_STATUS_WORDS[proposal.status]}
        </span>
        <span>
          Changes{' '}
          {projects.map((project, index) => (
            <span key={project.id}>
              {index > 0 && ', '}
              <Link to={`/projects/${project.id}/gantt`}>{project.name}</Link>
            </span>
          ))}
        </span>
      </p>
      <ConflictPanel
        conflicts={conflicts}
        groups={proposal.groups}
        names={names}
        canAct={canAct}
        busy={busy}
        onResolve={edit}
        onDrop={drop}
      />
      <ProposalEditor
        groups={proposal.groups}
        names={names}
        canAct={canAct}
        busy={busy}
        editing={editing}
        error={actionError}
        onEdit={edit}
        onCancel={() => {
          setActionError(null)
          setEditing(null)
        }}
        onSave={save}
        onDrop={drop}
      />
      <ReviewControls
        parts={partsOf(proposal, projects, people)}
        canAct={canAct}
        busy={busy}
        confirmAgain={seenPlan === null ? null : planChanges(seenPlan, plan)}
        error={reviewError}
        onApprove={approve}
        onReject={reject}
      />
      <p className="page__note">
        A preview of the proposal&rsquo;s changes on the plan as it is now. Nothing is saved: the
        plan stays as it is until the proposal is approved.
      </p>
      {'conflict' in preview ? (
        <section className="page__notice proposal__conflict" role="alert">
          <h2 className="page__notice-title">The proposal cannot be previewed</h2>
          <p className="proposal__conflict-text">{preview.conflict}</p>
        </section>
      ) : (
        <Preview model={preview.model} projectCount={projects.length} />
      )}
    </section>
  )
}

function Preview({ model, projectCount }: { model: PreviewModel; projectCount: number }) {
  const showProject = projectCount > 1
  return (
    <>
      <h2 className="proposal__heading" id="proposal-differences">
        What would change
      </h2>
      {model.rows.length === 0 ? (
        <p className="page__note">The proposal would change no task.</p>
      ) : (
        <div className="proposal__scroll">
          <table className="proposal__table" aria-labelledby="proposal-differences">
            <thead>
              <tr>
                <th scope="col">Task</th>
                {showProject && <th scope="col">Project</th>}
                <th scope="col">Start</th>
                <th scope="col">Finish</th>
                <th scope="col">Days</th>
                <th scope="col">Assigned</th>
                <th scope="col">Other changes</th>
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row) => (
                <tr key={row.taskId} aria-label={row.title} data-task-id={row.taskId}>
                  <th scope="row" className="proposal__task">
                    {row.title}
                    {row.created && <span className="proposal__new">new</span>}
                  </th>
                  {showProject && <td>{row.project}</td>}
                  <ValueCell cell={row.start} mono />
                  <ValueCell cell={row.finish} mono />
                  <ValueCell cell={row.days} mono />
                  <ValueCell cell={row.assigned} />
                  <td>
                    {row.other.length === 0 ? (
                      <span className="proposal__unchanged">—</span>
                    ) : (
                      <ul className="proposal__other">
                        {row.other.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2 className="proposal__heading" id="proposal-flags">
        New red flags
      </h2>
      {model.flags.length === 0 ? (
        <p className="page__note">None: the proposal would raise no new red flag.</p>
      ) : (
        <ul className="proposal__flags" aria-labelledby="proposal-flags">
          {model.flags.map((flag) => (
            <li key={flag.text} className="proposal__flag">
              <span className="proposal__flag-dot" aria-hidden="true" />
              <span>{flag.text}</span>
              <span className="proposal__flag-projects">in {flag.projects.join(', ')}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** A value before and after: the old one struck through when the proposal changes it. */
function ValueCell({ cell, mono = false }: { cell: Cell; mono?: boolean }) {
  const className = (mono ? 'proposal__mono ' : '') + (cell.changed ? 'proposal__changed' : '')
  return (
    <td className={className || undefined} data-changed={cell.changed}>
      {cell.changed && cell.before !== null ? (
        <>
          <del className="proposal__before">{cell.before}</del>
          {' → '}
          <ins className="proposal__after">{cell.after}</ins>
        </>
      ) : (
        cell.after
      )}
    </td>
  )
}
