import { describe, expect, it } from 'vitest'
import { ServiceError } from './errors.ts'
import {
  type Calendars,
  forbiddenDatesOf,
  type Plan,
  type PlanTask,
  schedule,
  type ScheduledDates,
} from './scheduler.ts'
import { toDay } from './working-days.ts'

// The scheduler (SC-004) on plans in memory. 2027-03-01 is a Monday; the weekend is Saturday and
// Sunday unless a test says otherwise.

const calendars = (over: Partial<Calendars> = {}): Calendars => ({
  weekendDays: ['saturday', 'sunday'],
  holidays: [],
  personalHolidays: new Map(),
  ...over,
})

const task = (id: string, over: Partial<PlanTask> = {}): PlanTask => ({
  id,
  title: id,
  parentId: null,
  plannedStart: null,
  plannedFinish: null,
  durationWorkingDays: null,
  milestoneVariant: null,
  milestoneDate: null,
  floatingDate: null,
  assignees: [],
  ...over,
})

const plan = (tasks: PlanTask[], blockedBy: [string, string][] = []): Plan => ({
  tasks,
  blockedBy: blockedBy.map(([taskId, blockerId]) => ({ taskId, blockerId })),
})

const dates = (plannedStart: string | null, plannedFinish: string | null): ScheduledDates => ({
  plannedStart,
  plannedFinish,
  floatingDate: null,
})

describe('schedule', () => {
  describe('the finish of a task (FR-144)', () => {
    it('derives the finish from the start and the duration, over working days', () => {
      const moved = schedule(
        plan([task('T', { plannedStart: '2027-03-04', durationWorkingDays: 4 })]),
        calendars({ holidays: ['2027-03-08'] }),
        ['T'],
      )
      expect(moved.get('T')).toEqual(dates('2027-03-04', '2027-03-10'))
    })

    it('moves nothing for a task with no start, or no duration and no blocker', () => {
      const moved = schedule(
        plan([
          task('Sized', { durationWorkingDays: 3 }),
          task('Started', { plannedStart: '2027-03-01' }),
          task('Spanned', { plannedStart: '2027-03-01', plannedFinish: '2027-03-12' }),
          task('Unscheduled'),
        ]),
        calendars(),
        ['Sized', 'Started', 'Spanned', 'Unscheduled'],
      )
      expect(moved.size).toBe(0)
    })

    it('refuses a task that would run past 9999-12-31, naming it', () => {
      const run = () =>
        schedule(
          plan([task('Long', { plannedStart: '9999-12-01', durationWorkingDays: 100 })]),
          calendars(),
          ['Long'],
        )
      expect(run).toThrow(ServiceError)
      expect(run).toThrow(/"Long" past 9999-12-31/)
    })
  })

  describe('a blocked task (FR-005, DD-030)', () => {
    it('starts on the next working day after its last blocker finishes, with no lag', () => {
      const moved = schedule(
        plan(
          [
            task('A', {
              plannedStart: '2027-03-01',
              plannedFinish: '2027-03-03',
              durationWorkingDays: 3,
            }),
            task('Z', {
              plannedStart: '2027-03-01',
              plannedFinish: '2027-03-05',
              durationWorkingDays: 5,
            }),
            task('B', { durationWorkingDays: 2 }),
          ],
          [
            ['B', 'A'],
            ['B', 'Z'],
          ],
        ),
        calendars(),
        ['B'],
      )
      expect(moved.get('B')).toEqual(dates('2027-03-08', '2027-03-09'))
    })

    it('moves earlier when its blocker does', () => {
      const moved = schedule(
        plan(
          [
            task('A', {
              plannedStart: '2027-03-01',
              plannedFinish: '2027-03-05',
              durationWorkingDays: 3,
            }),
            task('B', {
              plannedStart: '2027-03-08',
              plannedFinish: '2027-03-09',
              durationWorkingDays: 2,
            }),
          ],
          [['B', 'A']],
        ),
        calendars(),
        ['A'],
      )
      expect(moved.get('A')).toEqual(dates('2027-03-01', '2027-03-03'))
      expect(moved.get('B')).toEqual(dates('2027-03-04', '2027-03-05'))
    })

    it('follows through a chain of blockers', () => {
      const moved = schedule(
        plan(
          [
            task('C', { durationWorkingDays: 1 }),
            task('B', { durationWorkingDays: 1 }),
            task('A', { plannedStart: '2027-03-01', durationWorkingDays: 1 }),
          ],
          [
            ['B', 'A'],
            ['C', 'B'],
          ],
        ),
        calendars(),
        ['A'],
      )
      expect(moved.get('A')).toEqual(dates('2027-03-01', '2027-03-01'))
      expect(moved.get('B')).toEqual(dates('2027-03-02', '2027-03-02'))
      expect(moved.get('C')).toEqual(dates('2027-03-03', '2027-03-03'))
    })

    it('schedules what depends on a changed task even when its own dates stay', () => {
      const moved = schedule(
        plan(
          [
            task('A', {
              plannedStart: '2027-03-01',
              plannedFinish: '2027-03-01',
              durationWorkingDays: 1,
            }),
            task('B', {
              plannedStart: '2027-03-10',
              plannedFinish: '2027-03-10',
              durationWorkingDays: 1,
            }),
          ],
          [['B', 'A']],
        ),
        calendars(),
        ['A'],
      )
      expect(moved.has('A')).toBe(false)
      expect(moved.get('B')).toEqual(dates('2027-03-02', '2027-03-02'))
    })

    it('leaves what depends on an unchanged task alone when the task is not named', () => {
      const moved = schedule(
        plan(
          [
            task('A', {
              plannedStart: '2027-03-01',
              plannedFinish: '2027-03-01',
              durationWorkingDays: 1,
            }),
            task('B', {
              plannedStart: '2027-03-10',
              plannedFinish: '2027-03-10',
              durationWorkingDays: 1,
            }),
            task('C', { plannedStart: '2027-03-01', durationWorkingDays: 1 }),
          ],
          [['B', 'A']],
        ),
        calendars(),
        ['C'],
      )
      expect([...moved.keys()]).toEqual(['C'])
    })

    it('ignores blockers with no finish, and keeps its own start while no blocker has one', () => {
      const moved = schedule(
        plan(
          [
            task('A', { plannedStart: '2027-03-01' }),
            task('B', { plannedStart: '2027-03-15', durationWorkingDays: 2 }),
          ],
          [['B', 'A']],
        ),
        calendars(),
        ['B'],
      )
      expect(moved.get('B')).toEqual(dates('2027-03-15', '2027-03-16'))
    })

    it('starts after a fixed-date milestone or a floating milestone it is blocked by', () => {
      const moved = schedule(
        plan(
          [
            task('Fixed', { milestoneVariant: 'fixed-date', milestoneDate: '2027-03-03' }),
            task('Floating', { milestoneVariant: 'floating', floatingDate: '2027-03-05' }),
            task('AfterFixed', { durationWorkingDays: 1 }),
            task('AfterFloating', { durationWorkingDays: 1 }),
          ],
          [
            ['AfterFixed', 'Fixed'],
            ['AfterFloating', 'Floating'],
          ],
        ),
        calendars(),
        ['AfterFixed', 'AfterFloating'],
      )
      expect(moved.get('AfterFixed')).toEqual(dates('2027-03-04', '2027-03-04'))
      expect(moved.get('AfterFloating')).toEqual(dates('2027-03-08', '2027-03-08'))
    })

    it('keeps the working days of a task with a start and finish but no duration', () => {
      const moved = schedule(
        plan(
          [
            task('A', {
              plannedStart: '2027-03-01',
              plannedFinish: '2027-03-03',
              durationWorkingDays: 3,
            }),
            // Three working days, Thursday to Monday.
            task('B', { plannedStart: '2027-03-04', plannedFinish: '2027-03-08' }),
          ],
          [['B', 'A']],
        ),
        calendars(),
        ['A'],
      )
      expect(moved.has('B')).toBe(false)
      const later = schedule(
        plan(
          [
            task('A', {
              plannedStart: '2027-03-01',
              plannedFinish: '2027-03-05',
              durationWorkingDays: 5,
            }),
            task('B', { plannedStart: '2027-03-04', plannedFinish: '2027-03-08' }),
          ],
          [['B', 'A']],
        ),
        calendars(),
        ['A'],
      )
      expect(later.get('B')).toEqual(dates('2027-03-08', '2027-03-10'))
    })

    it('keeps at least one working day for a task whose own span had none', () => {
      const moved = schedule(
        plan(
          [
            task('A', {
              plannedStart: '2027-03-01',
              plannedFinish: '2027-03-01',
              durationWorkingDays: 1,
            }),
            task('B', { plannedStart: '2027-03-06', plannedFinish: '2027-03-07' }),
          ],
          [['B', 'A']],
        ),
        calendars(),
        ['B'],
      )
      expect(moved.get('B')).toEqual(dates('2027-03-02', '2027-03-02'))
    })

    it('gives a task with no duration a start, keeping a finish that does not come before it', () => {
      const moved = schedule(
        plan(
          [
            task('A', {
              plannedStart: '2027-03-01',
              plannedFinish: '2027-03-01',
              durationWorkingDays: 1,
            }),
            task('Open'),
            task('Due', { plannedFinish: '2027-03-12' }),
            task('Overdue', { plannedFinish: '2027-03-01' }),
          ],
          [
            ['Open', 'A'],
            ['Due', 'A'],
            ['Overdue', 'A'],
          ],
        ),
        calendars(),
        ['Open', 'Due', 'Overdue'],
      )
      expect(moved.get('Open')).toEqual(dates('2027-03-02', null))
      expect(moved.get('Due')).toEqual(dates('2027-03-02', '2027-03-12'))
      expect(moved.get('Overdue')).toEqual(dates('2027-03-02', '2027-03-02'))
    })

    it('refuses a blocked task that could only start past 9999-12-31', () => {
      const run = () =>
        schedule(
          plan(
            [
              task('A', { milestoneVariant: 'fixed-date', milestoneDate: '9999-12-31' }),
              task('B', { durationWorkingDays: 1 }),
            ],
            [['B', 'A']],
          ),
          calendars(),
          ['B'],
        )
      expect(run).toThrow(/past 9999-12-31/)
    })

    it('ignores a relation to a task outside the plan, such as one of another project (FR-018)', () => {
      const moved = schedule(
        plan([task('T', { plannedStart: '2027-03-11', durationWorkingDays: 2 })], [['T', 'Other']]),
        calendars(),
        ['T', 'Other'],
      )
      expect(moved.get('T')).toEqual(dates('2027-03-11', '2027-03-12'))
    })
  })

  describe('a parent (FR-006)', () => {
    it('spans its subtasks, at every level of nesting', () => {
      const moved = schedule(
        plan([
          task('P'),
          task('C', { parentId: 'P' }),
          task('G1', { parentId: 'C', plannedStart: '2027-03-08', plannedFinish: '2027-03-09' }),
          task('G2', { parentId: 'C', plannedStart: '2027-03-03' }),
          task('C2', { parentId: 'P', plannedFinish: '2027-03-12' }),
        ]),
        calendars(),
        ['C', 'C2'],
      )
      expect(moved.get('C')).toEqual(dates('2027-03-03', '2027-03-09'))
      expect(moved.get('P')).toEqual(dates('2027-03-03', '2027-03-12'))
    })

    it('is scheduled as a task while none of its subtasks has a date', () => {
      const moved = schedule(
        plan([
          task('P', { plannedStart: '2027-03-01', durationWorkingDays: 2 }),
          task('C', { parentId: 'P' }),
        ]),
        calendars(),
        ['P'],
      )
      expect(moved.get('P')).toEqual(dates('2027-03-01', '2027-03-02'))
    })

    it('has its subtasks scheduled before it, whatever order they were created in', () => {
      const moved = schedule(
        plan(
          [
            task('P'),
            task('B', { parentId: 'P', durationWorkingDays: 1 }),
            task('A', {
              plannedStart: '2027-03-01',
              plannedFinish: '2027-03-01',
              durationWorkingDays: 1,
            }),
          ],
          [['B', 'A']],
        ),
        calendars(),
        ['A'],
      )
      expect(moved.get('B')).toEqual(dates('2027-03-02', '2027-03-02'))
      expect(moved.get('P')).toEqual(dates('2027-03-02', '2027-03-02'))
    })

    it('settles a task blocked by its own parent, which closes a cycle, without failing', () => {
      const moved = schedule(
        plan(
          [
            task('P', { plannedStart: '2027-03-01', plannedFinish: '2027-03-02' }),
            task('C', { parentId: 'P', plannedStart: '2027-03-01', durationWorkingDays: 2 }),
          ],
          [['C', 'P']],
        ),
        calendars(),
        ['C'],
      )
      // The two rules cannot both hold: P spans C, and C starts after P finishes. Each task is
      // scheduled once, in the order created: P, not changed, keeps its dates; C starts after them.
      expect(moved.get('C')).toEqual(dates('2027-03-03', '2027-03-04'))
      expect(moved.has('P')).toBe(false)
    })
  })

  describe('milestones', () => {
    it('never moves a fixed-date milestone, whatever it is blocked by (FR-012)', () => {
      const moved = schedule(
        plan(
          [
            task('A', {
              plannedStart: '2027-03-01',
              plannedFinish: '2027-03-19',
              durationWorkingDays: 15,
            }),
            task('M', { milestoneVariant: 'fixed-date', milestoneDate: '2027-03-12' }),
          ],
          [['M', 'A']],
        ),
        calendars(),
        ['A', 'M'],
      )
      expect(moved.has('M')).toBe(false)
    })

    it('places a floating milestone on its last blocker finish, or on no date (FR-195)', () => {
      const moved = schedule(
        plan(
          [
            task('A', { plannedStart: '2027-03-01', plannedFinish: '2027-03-03' }),
            task('B', { plannedStart: '2027-03-01', plannedFinish: '2027-03-05' }),
            task('C'),
            task('Ready', { milestoneVariant: 'floating' }),
            task('Later', { milestoneVariant: 'floating', floatingDate: '2027-03-01' }),
          ],
          [
            ['Ready', 'A'],
            ['Ready', 'B'],
            ['Later', 'C'],
          ],
        ),
        calendars(),
        ['Ready', 'Later'],
      )
      expect(moved.get('Ready')).toEqual({
        plannedStart: null,
        plannedFinish: null,
        floatingDate: '2027-03-05',
      })
      expect(moved.get('Later')).toEqual({
        plannedStart: null,
        plannedFinish: null,
        floatingDate: null,
      })
    })
  })

  describe('forbidden dates (FR-007 to FR-010, FR-146)', () => {
    const blocked = (b: Partial<PlanTask>, over: Partial<Calendars>) =>
      schedule(
        plan(
          [
            task('A', {
              plannedStart: '2027-03-01',
              plannedFinish: '2027-03-02',
              durationWorkingDays: 2,
            }),
            task('B', { durationWorkingDays: 1, ...b }),
          ],
          [['B', 'A']],
        ),
        calendars(over),
        ['B'],
      ).get('B')

    it("skips a day off of any one of the task's assigned people", () => {
      const personalHolidays = new Map([['bob', ['2027-03-03']]])
      expect(blocked({ assignees: ['alice', 'bob'] }, { personalHolidays })).toEqual(
        dates('2027-03-04', '2027-03-04'),
      )
    })

    it('ignores the days off of people not assigned to the task', () => {
      const personalHolidays = new Map([['alice', ['2027-03-03']]])
      expect(blocked({}, { personalHolidays })).toEqual(dates('2027-03-03', '2027-03-03'))
    })

    it('skips company holidays and the weekend for every task, assigned or not', () => {
      expect(blocked({ assignees: ['alice'] }, { holidays: ['2027-03-03'] })).toEqual(
        dates('2027-03-04', '2027-03-04'),
      )
      expect(blocked({}, { weekendDays: ['wednesday'] })).toEqual(dates('2027-03-04', '2027-03-04'))
    })

    it('applies the others’ calendars when an assignee has none of their own', () => {
      const personalHolidays = new Map([['alice', ['2027-03-03']]])
      expect(
        blocked({ assignees: ['alice', 'bob'] }, { holidays: ['2027-03-04'], personalHolidays }),
      ).toEqual(dates('2027-03-05', '2027-03-05'))
    })

    it('answers the forbidden dates of a set of assigned people', () => {
      const forbidden = forbiddenDatesOf(
        calendars({
          holidays: ['2027-03-03'],
          personalHolidays: new Map([['bob', ['2027-03-04']]]),
        }),
        ['bob'],
      )
      expect(
        ['2027-03-03', '2027-03-04', '2027-03-05', '2027-03-06'].map((d) =>
          forbidden.has(toDay(d)),
        ),
      ).toEqual([true, true, false, true])
    })
  })

  it('moves no task that was not named and depends on nothing named (FR-148, FR-044)', () => {
    // T's stored finish no longer matches its calendar, but nothing it depends on changed.
    const moved = schedule(
      plan([
        task('T', {
          plannedStart: '2027-03-01',
          plannedFinish: '2027-03-03',
          durationWorkingDays: 3,
          assignees: ['alice'],
        }),
      ]),
      calendars({ personalHolidays: new Map([['alice', ['2027-03-02']]]) }),
      [],
    )
    expect(moved.size).toBe(0)
  })
})
