import { describe, expect, it } from 'vitest'
import { callerOf } from './caller.ts'

describe('callerOf', () => {
  it('answers the caller the REST API established', () => {
    const request = { caller: { accountId: 'alice', channel: 'rest-api' as const } }
    expect(callerOf(request)).toEqual({ accountId: 'alice', channel: 'rest-api' })
  })

  it('throws for a request that was never authenticated, instead of acting for nobody', () => {
    const request = { caller: null }
    expect(() => callerOf(request)).toThrow('not authenticated')
  })
})
