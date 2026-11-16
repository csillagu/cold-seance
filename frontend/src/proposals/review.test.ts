import { describe, expect, it } from 'vitest'
import type { ApiProposal } from './proposal.ts'
import { partsOf, type PlanTask, planChanges } from './review.ts'

const task = (id: string, title: string, fields: Partial<PlanTask> = {}): PlanTask => ({
  id,
  title,
  plannedStart: '2027-03-15',
  plannedFinish: '2027-03-15',
  ...fields,
})

describe('what changed in the plan since the preview (FR-078)', () => {
  it('says nothing of a plan that did not change', () => {
    expect(planChanges([task('c', 'C')], [task('c', 'C')])).toEqual([])
  })

  it('names each task moved, renamed, added or removed', () => {
    const before = [task('a', 'A'), task('c', 'C'), task('d', 'D')]
    const after = [
      task('a', 'A2'),
      task('c', 'C', { plannedStart: '2027-03-16', plannedFinish: '2027-03-16' }),
      task('e', 'E'),
    ]
    expect(planChanges(before, after)).toEqual([
      'A2: renamed from A',
      'C: start 15 Mar 2027 → 16 Mar 2027, finish 15 Mar 2027 → 16 Mar 2027',
      'E: added',
      'D: removed',
    ])
  })

  it('says a date taken away is none', () => {
    expect(planChanges([task('c', 'C')], [task('c', 'C', { plannedFinish: null })])).toEqual([
      'C: finish 15 Mar 2027 → none',
    ])
  })
})

describe("a proposal's parts (DD-025)", () => {
  it('gives one part for each project, with who approved it', () => {
    const proposal: Pick<ApiProposal, 'approvals'> = {
      approvals: [{ projectId: 'b', approvedBy: 'bob-id', channel: 'ui', approvedAt: '' }],
    }
    expect(
      partsOf(
        proposal,
        [
          { id: 'a', name: 'Apollo' },
          { id: 'b', name: 'Borealis' },
        ],
        new Map([['bob-id', 'bob']]),
      ),
    ).toEqual([
      { projectId: 'a', project: 'Apollo', approvedBy: null },
      { projectId: 'b', project: 'Borealis', approvedBy: 'bob' },
    ])
  })
})
