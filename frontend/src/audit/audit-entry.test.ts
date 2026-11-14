import { describe, expect, it } from 'vitest'
import { describeAction, describeChannels, describeDetails, formatValue } from './audit-entry.ts'

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
    expect(formatValue({ a: 1 })).toBe('{"a":1}')
  })
})
