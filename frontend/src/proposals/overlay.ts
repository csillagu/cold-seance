/*
 * The pending overlay of the proposals under review (SC-068, SC-030, FR-073): what each proposal
 * waiting for review would change in a project, as its live preview gives it, for the Gantt and
 * the Kanban to show apart from the live plan. Reading it changes nothing. The loader reads the
 * REST API; the rest are pure functions, so that the views and their tests share them.
 */

import { api, ApiError, isUnauthenticated } from '../api.ts'
import {
  type ApiDifference,
  type ApiPreview,
  buildPreviewModel,
  type Cell,
  type Names,
  type PreviewTask,
} from './preview-model.ts'
import type { ApiProposal } from './proposal.ts'

/** A proposal under review, with what it would change, or why that cannot be shown. */
export interface PendingProposal {
  proposalId: string
  /** Its live preview; null when it cannot be previewed on the plan as it is now. */
  preview: ApiPreview | null
  /** Why it cannot be previewed, as the REST API says it; null when it can. */
  refused: string | null
}

/** A task a proposal under review would change or create in the project. */
export interface PendingChange {
  proposalId: string
  /** The task: of the live plan, or one the proposal creates, with an id of its preview only. */
  taskId: string
  /** Whether the proposal creates the task. */
  created: boolean
  /** The task once the proposal is applied. */
  after: PreviewTask
  /** Whether its assigned people would change; always for a task the proposal creates. */
  assigneesChanged: boolean
  /** What would change, in words, each as `Start: 1 Mar 2027 → 8 Mar 2027`. */
  lines: string[]
}

/** A proposal under review as a view names it: its changes in the project, or its refusal. */
export interface PendingSummary {
  proposalId: string
  /** How many of the project's tasks it would change or create. */
  changes: number
  refused: string | null
}

/**
 * Reads the proposals under review that change the project, each with its live preview. A
 * proposal one of whose changes cannot be made on the plan as it is now (409) is given with the
 * API's refusal instead. Rejects as the REST API does otherwise.
 */
export async function loadPendingProposals(
  projectId: string,
  signal?: AbortSignal,
): Promise<PendingProposal[]> {
  const proposals = await api<ApiProposal[]>(
    `/projects/${encodeURIComponent(projectId)}/proposals`,
    { signal },
  )
  const waiting = proposals.filter((proposal) => proposal.status === 'waiting')
  return Promise.all(
    waiting.map(async ({ id }): Promise<PendingProposal> => {
      try {
        const preview = await api<ApiPreview>(`/proposals/${encodeURIComponent(id)}/preview`, {
          signal,
        })
        return { proposalId: id, preview, refused: null }
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          return { proposalId: id, preview: null, refused: error.message }
        }
        throw error
      }
    }),
  )
}

/**
 * Reads the pending overlay of the project for a view: the proposals under review, or `null` when
 * they could not be read, so that the view still shows the live plan. A refusal because no one is
 * signed in is passed on, for the view to send the browser to the sign-in page.
 */
export async function loadOverlay(
  projectId: string,
  signal?: AbortSignal,
): Promise<PendingProposal[] | null> {
  try {
    return await loadPendingProposals(projectId, signal)
  } catch (error) {
    if (isUnauthenticated(error) || signal?.aborted) throw error
    return null
  }
}

/** A changed cell of the preview in words: `Start: 1 Mar 2027 → 8 Mar 2027`. */
function cellLine(label: string, cell: Cell): string | null {
  if (!cell.changed || cell.before === null) return null
  return `${label}: ${cell.before} → ${cell.after}`
}

/**
 * What the proposals under review would change in the project `projectId`: each task of the
 * project that a proposal's changes, or the rescheduling they cause, would change or create, in
 * the order of the proposals and then of their previews. A task of another project the proposal
 * changes too is left to that project's views; a proposal that cannot be previewed gives none.
 */
export function pendingChanges(
  proposals: readonly PendingProposal[],
  projectId: string,
  names: Names,
): PendingChange[] {
  const result: PendingChange[] = []
  for (const { proposalId, preview } of proposals) {
    if (!preview) continue
    const rows = buildPreviewModel(preview, names).rows
    preview.differences.forEach((difference: ApiDifference, index) => {
      if (difference.projectId !== projectId) return
      const row = rows[index]!
      const lines = [
        cellLine('Start', row.start),
        cellLine('Finish', row.finish),
        cellLine('Days', row.days),
        cellLine('Assigned', row.assigned),
        ...row.other,
      ].filter((line): line is string => line !== null)
      result.push({
        proposalId,
        taskId: difference.taskId,
        created: difference.before === null,
        after: difference.after,
        assigneesChanged: row.assigned.changed,
        lines,
      })
    })
  }
  return result
}

/** The proposals under review as a view names them, each with how many of its changes it shows. */
export function pendingSummaries(
  proposals: readonly PendingProposal[],
  changes: readonly PendingChange[],
): PendingSummary[] {
  return proposals.map(({ proposalId, refused }) => ({
    proposalId,
    changes: changes.filter((change) => change.proposalId === proposalId).length,
    refused,
  }))
}
