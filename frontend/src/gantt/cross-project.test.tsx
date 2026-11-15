import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Gantt } from './Gantt.tsx'
import { type ApiRedFlag, type ApiRelations, type ApiTask, buildGanttModel } from './gantt-model.ts'

// The cross-project dependency lines (SC-066, FR-062), drawn on a Gantt covering two projects.
// A saved view covering several projects opens such a Gantt (SC-020, SC-091); TC-088's browser
// step on it is left for a follow-up (see e2e/tests/gantt-cross-project.spec.ts). Here the Gantt
// is given the tasks of both projects, as such a view gives them.

const APOLLO = 'project-apollo'
const BOREALIS = 'project-borealis'
const calendar = { weekendDays: ['saturday', 'sunday'], holidays: [] }

function task(id: string, projectId: string, fields: Partial<ApiTask>): ApiTask {
  return {
    id,
    projectId,
    title: id,
    status: 'not-started',
    plannedStart: null,
    plannedFinish: null,
    durationWorkingDays: null,
    aiShare: null,
    milestone: null,
    assignees: [],
    ...fields,
  }
}

const t = task('T', APOLLO, {
  plannedStart: '2027-03-11',
  plannedFinish: '2027-03-12',
  durationWorkingDays: 2,
})
const relations: ApiRelations[] = [
  { taskId: 'T', parent: null, blockedBy: [{ id: 'M', projectId: BOREALIS }] },
  { taskId: 'M', parent: null, blockedBy: [] },
]

function draw(milestoneDate: string, flags: ApiRedFlag[] = []) {
  const m = task('M', BOREALIS, { milestone: { variant: 'fixed-date', date: milestoneDate } })
  const model = buildGanttModel([t, m], relations, flags, calendar)
  render(
    <Gantt
      name="Gantt of Apollo and Borealis"
      model={model}
      people={new Map()}
      today="2027-03-01"
    />,
  )
  return screen.getByRole('table', { name: 'Gantt of Apollo and Borealis' })
}

describe('the cross-project dependency lines (SC-066)', () => {
  it("TC-088: draws T, Borealis's milestone M and the dependency between them, not in red", () => {
    const gantt = draw('2027-03-10')

    expect(within(gantt).getByRole('row', { name: 'T' })).toHaveAttribute('data-red', 'false')
    expect(within(gantt).getByRole('row', { name: 'M' })).toHaveAttribute('data-red', 'false')
    const dependencies = within(gantt).getByRole('group', { name: 'Dependencies' })
    const line = within(dependencies).getByRole('img', {
      name: 'T is blocked by M, of another project',
    })
    expect(line).toHaveAttribute('data-cross-project', 'true')
    expect(line.querySelector('path')).toHaveClass('gantt__arrow--cross-project')
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveTextContent(
      'Cross-project dependency',
    )

    // Negative: the dependency is not drawn in red, since M lies before T's start.
    expect(line).toHaveAttribute('data-red', 'false')
    expect(line.querySelector('path')).not.toHaveClass('gantt__arrow--red')
  })

  it("draws it in red when M lies after T's start", () => {
    const gantt = draw('2027-03-17', [
      {
        kind: 'cross-project-dependency',
        task: { id: 'T', projectId: APOLLO },
        blocker: { id: 'M', projectId: BOREALIS },
        blockerFinish: '2027-03-17',
      },
    ])

    expect(within(gantt).getByRole('row', { name: 'T' })).toHaveAttribute('data-red', 'true')
    const line = within(gantt).getByRole('img', {
      name: 'T is blocked by M, of another project, in red: it lies after the start of T',
    })
    expect(line).toHaveAttribute('data-red', 'true')
    expect(line.querySelector('path')).toHaveClass('gantt__arrow--red')
  })

  it('has no cross-project key on a Gantt of one project', () => {
    const a = task('A', APOLLO, { plannedStart: '2027-03-01', plannedFinish: '2027-03-01' })
    const model = buildGanttModel([a], [{ taskId: 'A', parent: null, blockedBy: [] }], [], calendar)
    render(<Gantt name="Gantt of Apollo" model={model} people={new Map()} today="2027-03-01" />)
    expect(screen.getByRole('list', { name: 'Legend' })).not.toHaveTextContent(
      'Cross-project dependency',
    )
  })
})
