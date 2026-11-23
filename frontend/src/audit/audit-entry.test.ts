import { describe, expect, it } from 'vitest'
import {
  describeAction,
  describeActor,
  describeChannels,
  describeDetails,
  describeSubject,
  formatValue,
} from './audit-entry.ts'

describe('an audit log entry in words (SC-094)', () => {
  it('names each channel', () => {
    expect(describeChannels(['ui'])).toBe('UI')
    expect(describeChannels(['rest-api'])).toBe('REST API')
    expect(describeChannels(['mcp'])).toBe('MCP server')
    expect(describeChannels(['github'])).toBe('GitHub')
  })

  it('names both channels of a change an approved AI proposal applied, the proposal’s first', () => {
    expect(describeChannels(['mcp', 'ui'])).toBe('MCP server, approved through UI')
  })

  it('reads the action as words', () => {
    expect(describeAction('task.updated')).toBe('Task updated')
    expect(describeAction('project-member.role-set')).toBe('Project member role set')
    expect(describeAction('api-token.created')).toBe('API token created')
  })

  it('leaves out a field whose value stayed the same (#256)', () => {
    expect(
      describeDetails({
        changes: { title: 'Final', floatingDate: null },
        previous: { title: 'Draft', floatingDate: null },
      }),
    ).toEqual(['title: Draft → Final'])
  })

  it('names ids where it knows them and shortens the rest (#256)', () => {
    const apollo = '5fdaba12-0000-4000-8000-000000000001'
    const other = 'b5c50597-0000-4000-8000-000000000002'
    const task = 'faef0483-0000-4000-8000-000000000003'
    const names = new Map([[apollo, 'Apollo']])
    expect(
      describeDetails(
        {
          projects: [apollo, other],
          blockerId: task,
          cause: { action: 'task.updated', taskId: task },
        },
        names,
      ),
    ).toEqual([
      'projects: Apollo, #b5c50597',
      'blocker: #faef0483',
      'cause: task updated, task #faef0483',
    ])
    expect(describeSubject({ type: 'project', id: apollo }, names)).toBe('project: Apollo')
  })

  it('reads a change of fields as each field’s old and new value', () => {
    expect(
      describeDetails({
        changes: { title: 'Final', plannedStart: '2027-03-01' },
        previous: { title: 'Draft', plannedStart: null },
      }),
    ).toEqual(['title: Draft → Final', 'planned start: none → 2027-03-01'])
  })

  it('reads any other detail as its name and value', () => {
    expect(describeDetails({ name: 'Apollo', repositories: ['a', 'b'] })).toEqual([
      'name: Apollo',
      'repositories: a, b',
    ])
    expect(describeDetails({ changes: 'odd' })).toEqual(['changes: odd'])
  })

  it('formats values', () => {
    expect(formatValue('')).toBe('(empty)')
    expect(formatValue(3)).toBe('3')
    expect(formatValue(false)).toBe('false')
    expect(formatValue([])).toBe('none')
    expect(formatValue({ a: 1 })).toBe('a 1')
  })
})

describe('describeActor', () => {
  it("names an account by its username and a GitHub user by their login, marked as GitHub's", () => {
    expect(describeActor({ accountId: 'a1', username: 'alice' })).toBe('alice')
    expect(describeActor({ githubLogin: 'tc-writer' })).toBe('tc-writer (GitHub)')
  })
})
