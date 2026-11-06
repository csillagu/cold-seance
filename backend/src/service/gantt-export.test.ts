import { describe, expect, it } from 'vitest'
import { chartText, type GanttTask, mermaidGantt } from './gantt-export.ts'

// The chart the Mermaid Gantt exporter writes (SC-021: FR-063, DD-004), from the tasks and
// dependencies it is given; reading them from the database is tested in
// test/integration/gantt-export.test.ts.

const task = (id: string, fields: Partial<GanttTask> = {}): GanttTask => ({
  id,
  title: id,
  plannedStart: null,
  plannedFinish: null,
  milestoneVariant: null,
  milestoneDate: null,
  floatingDate: null,
  ...fields,
})

const bar = (id: string, plannedStart: string, plannedFinish: string) =>
  task(id, { plannedStart, plannedFinish })

const HEADER = ['```mermaid', 'gantt', '    title Apollo', '    dateFormat YYYY-MM-DD']

describe('mermaidGantt', () => {
  it('writes a fenced chart with every task, its dates, its dependencies and the milestones', () => {
    const chart = mermaidGantt({
      title: 'Apollo',
      tasks: [
        bar('A', '2027-03-01', '2027-03-03'),
        bar('B', '2027-03-01', '2027-03-01'),
        bar('C', '2027-03-04', '2027-03-05'),
        task('M', { milestoneVariant: 'fixed-date', milestoneDate: '2027-03-12' }),
      ],
      dependencies: [
        { taskId: 'C', blockerId: 'A' },
        { taskId: 'M', blockerId: 'C' },
      ],
    })
    expect(chart).toBe(
      [
        ...HEADER,
        '    inclusiveEndDates',
        '    A : 2027-03-01, 2027-03-03',
        '    B : 2027-03-01, 2027-03-01',
        '    C (after A) : 2027-03-04, 2027-03-05',
        '    M (after C) : milestone, 2027-03-12, 0d',
        '```',
        '',
      ].join('\n'),
    )
  })

  it('puts a floating milestone on the day the scheduler placed it', () => {
    const chart = mermaidGantt({
      title: 'Apollo',
      tasks: [task('Docs ready', { milestoneVariant: 'floating', floatingDate: '2027-03-05' })],
      dependencies: [],
    })
    expect(chart).toContain('\n    Docs ready : milestone, 2027-03-05, 0d\n')
  })

  it('leaves out the tasks that lie on no date, and the dependencies on them', () => {
    const chart = mermaidGantt({
      title: 'Apollo',
      tasks: [
        task('Unscheduled'),
        task('Start only', { plannedStart: '2027-03-01' }),
        task('Finish only', { plannedFinish: '2027-03-01' }),
        task('Unplaced', { milestoneVariant: 'floating' }),
        bar('Kept', '2027-03-08', '2027-03-09'),
      ],
      dependencies: [
        { taskId: 'Kept', blockerId: 'Unscheduled' },
        { taskId: 'Unplaced', blockerId: 'Kept' },
      ],
    })
    expect(chart).toBe(
      [...HEADER, '    inclusiveEndDates', '    Kept : 2027-03-08, 2027-03-09', '```', ''].join(
        '\n',
      ),
    )
  })

  it('names every blocker on the chart, in the order the relations are given', () => {
    const chart = mermaidGantt({
      title: 'Apollo',
      tasks: [
        bar('A', '2027-03-01', '2027-03-01'),
        bar('B', '2027-03-01', '2027-03-02'),
        bar('C', '2027-03-03', '2027-03-03'),
      ],
      dependencies: [
        { taskId: 'C', blockerId: 'B' },
        { taskId: 'C', blockerId: 'Elsewhere' },
        { taskId: 'C', blockerId: 'A' },
      ],
    })
    expect(chart).toContain('\n    C (after B, A) : 2027-03-03, 2027-03-03\n')
  })

  it('writes a chart with no task for a Gantt with none on a date', () => {
    expect(mermaidGantt({ title: 'Apollo', tasks: [task('A')], dependencies: [] })).toBe(
      [...HEADER, '    inclusiveEndDates', '```', ''].join('\n'),
    )
  })

  it('carries no load and no red marking', () => {
    const chart = mermaidGantt({
      title: 'Apollo',
      tasks: [bar('A', '2027-03-01', '2027-03-03')],
      dependencies: [],
    })
    expect(chart).not.toMatch(/crit|%/)
  })

  it('writes the titles so that Mermaid reads them as text', () => {
    const chart = mermaidGantt({
      title: 'Apollo: phase #2',
      tasks: [bar('A', '2027-03-01', '2027-03-01')].map((t) => ({ ...t, title: 'Section ```x' })),
      dependencies: [],
    })
    expect(chart).toContain('\n    title Apollo#58; phase #35;2\n')
    expect(chart).toContain('\n    #83;ection #96;#96;#96;x : 2027-03-01, 2027-03-01\n')
  })
})

describe('chartText', () => {
  it('keeps letters, digits, spaces and common punctuation as they are', () => {
    expect(chartText("Write the guide (v2), part 1-3: Ünïcode ✓ isn't it?")).toBe(
      "Write the guide (v2), part 1-3#58; Ünïcode #10003; isn't it?",
    )
    expect(chartText('Árvíztűrő tükörfúrógép')).toBe('Árvíztűrő tükörfúrógép')
  })

  it('writes as an entity every character Mermaid could read as syntax', () => {
    expect(chartText('a:b;c#d%%e<b>&"`')).toBe('a#58;b#59;c#35;d#37;#37;e#60;b#62;#38;#34;#96;')
    // An entity typed into a title is shown as typed, not as the character it stands for.
    expect(chartText('#58;')).toBe('#35;58#59;')
  })

  it('writes the first character of a title that starts with a statement word as an entity', () => {
    expect(chartText('section review')).toBe('#115;ection review')
    expect(chartText('Title page')).toBe('#84;itle page')
    expect(chartText('click here')).toBe('#99;lick here')
    expect(chartText('Excludes list')).toBe('#69;xcludes list')
    expect(chartText('Selection')).toBe('Selection')
  })

  it('makes a title one line', () => {
    expect(chartText('  First\nsecond\t third  ')).toBe('First second third')
  })
})
