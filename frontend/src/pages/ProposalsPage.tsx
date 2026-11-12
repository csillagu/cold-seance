import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api } from '../api.ts'
import { type ApiProposal, formatWhen, PROPOSAL_STATUS_WORDS } from '../proposals/proposal.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { useProject } from './project-context.ts'
import '../proposals/proposals.css'

type Loaded =
  | { state: 'loading' }
  | { state: 'loaded'; proposals: ApiProposal[]; people: ReadonlyMap<string, string> }
  | { state: 'failed' }

/**
 * A project's proposals, at `/projects/<id>/proposals`, inside the project's page: the way to each
 * proposal's preview (SC-034). It lists the proposals the REST API gives for the project, oldest
 * first, each with a link to its preview.
 */
export function ProposalsPage() {
  const project = useProject()
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })

  useEffect(() => {
    const abort = new AbortController()
    const get = <T,>(path: string) => api<T>(path, { signal: abort.signal })
    const base = `/projects/${encodeURIComponent(project.id)}`
    setLoaded({ state: 'loading' })
    Promise.all([
      get<ApiProposal[]>(`${base}/proposals`),
      get<{ accountId: string; username: string }[]>(`${base}/members`),
    ])
      .then(([proposals, members]) =>
        setLoaded({
          state: 'loaded',
          proposals,
          people: new Map(members.map((member) => [member.accountId, member.username])),
        }),
      )
      .catch((error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        setLoaded({ state: 'failed' })
      })
    return () => abort.abort()
  }, [project.id, toSignIn])

  if (loaded.state === 'loading') return <p className="page__note">Loading…</p>
  if (loaded.state === 'failed') {
    return (
      <p role="alert" className="page__note">
        The proposals could not be loaded.
      </p>
    )
  }
  if (loaded.proposals.length === 0) {
    return <p className="page__note">No proposal changes this project.</p>
  }
  return (
    <div className="proposal__scroll">
      <table className="proposal__table" aria-label={`Proposals of ${project.name}`}>
        <thead>
          <tr>
            <th scope="col">Proposal</th>
            <th scope="col">By</th>
            <th scope="col">Status</th>
            <th scope="col" className="proposal__num">
              Changes
            </th>
          </tr>
        </thead>
        <tbody>
          {loaded.proposals.map((proposal) => {
            const by = loaded.people.get(proposal.createdBy) ?? 'someone who is not a member'
            const changes = proposal.groups.reduce((sum, group) => sum + group.changes.length, 0)
            return (
              <tr key={proposal.id}>
                <th scope="row" className="proposal__task">
                  <Link to={`/proposals/${proposal.id}`}>
                    Proposal of {formatWhen(proposal.createdAt)}
                  </Link>
                </th>
                <td>{by}</td>
                <td>
                  <span className={`proposal__status proposal__status--${proposal.status}`}>
                    {PROPOSAL_STATUS_WORDS[proposal.status]}
                  </span>
                </td>
                <td className="proposal__mono proposal__num">{changes}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
