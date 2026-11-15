import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import type { WebhookVerdict } from '../github/webhooks.ts'
import type { Authenticator } from './caller.ts'
import type { WebhookReceiver } from './github-webhooks.ts'

// The webhook endpoint only translates the delivery for the webhook receiver (SC-105); the
// signatures are tested in src/github/webhooks.test.ts, and deliveries reaching the change
// handler in test/integration/github-sync.test.ts.

let closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(closers.map((close) => close()))
  closers = []
})

/** An authenticator that recognises nobody: GitHub does not sign in. */
const nobody: Authenticator = async () => undefined

function endpoint(verdict: WebhookVerdict) {
  const receive = vi.fn<WebhookReceiver['receive']>(() => verdict)
  const app = buildApp({}, { authenticators: [nobody], webhooks: { receive } })
  closers.push(() => app.close())
  return { app, receive }
}

const body = '{"action":"closed",  "issue":{"number":1}}'
const headers = {
  'content-type': 'application/json',
  'x-github-event': 'issues',
  'x-hub-signature-256': 'sha256=abc',
  'x-github-hook-installation-target-type': 'integration',
  'x-github-hook-installation-target-id': '260',
}

describe('POST /api/github/webhooks', () => {
  it('hands the delivery, its raw body and its headers to the receiver, without signing in, and answers 202', async () => {
    const { app, receive } = endpoint('accepted')
    const response = await app.inject({
      method: 'POST',
      url: '/api/github/webhooks',
      headers,
      body,
    })
    expect(response.statusCode).toBe(202)
    expect(response.json()).toEqual({ accepted: true })
    expect(receive).toHaveBeenCalledOnce()
    const [given, raw, payload] = receive.mock.calls[0] ?? []
    expect(given).toEqual({
      event: 'issues',
      signature: 'sha256=abc',
      targetType: 'integration',
      targetId: '260',
    })
    // The bytes as sent, which the signature is over, not the JSON written out again.
    expect(raw?.toString('utf8')).toBe(body)
    expect(payload).toEqual({ action: 'closed', issue: { number: 1 } })
  })

  it.each([
    ['bad-signature', 'does not match'],
    ['no-secret', 'No webhook secret'],
  ] as const)('refuses a %s delivery with 401', async (verdict, message) => {
    const { app } = endpoint(verdict)
    const response = await app.inject({
      method: 'POST',
      url: '/api/github/webhooks',
      headers,
      body,
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({
      statusCode: 401,
      message: expect.stringContaining(message),
    })
  })

  it('refuses a body that is not JSON with 400, before the receiver', async () => {
    const { app, receive } = endpoint('accepted')
    const response = await app.inject({
      method: 'POST',
      url: '/api/github/webhooks',
      headers,
      body: '{not json',
    })
    expect(response.statusCode).toBe(400)
    expect(receive).not.toHaveBeenCalled()
  })

  it('keeps every other route behind authentication', async () => {
    const { app } = endpoint('accepted')
    const response = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(response.statusCode).toBe(401)
  })
})
