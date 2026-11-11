import { vi } from 'vitest'

/** An answer of the fake API: a status and, for any but 204, a JSON body. */
export interface FakeAnswer {
  status: number
  body?: unknown
}

/** A request the fake API received. */
export interface FakeRequest {
  method: string
  path: string
  body: unknown
}

/**
 * Replaces `fetch` with a fake REST API that answers each request with what `answer` returns for
 * its method and path, and records the requests.
 */
export function fakeApi(answer: (method: string, path: string) => FakeAnswer): FakeRequest[] {
  const requests: FakeRequest[] = []
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    requests.push({ method, path: input, body })
    const { status, body: answerBody } = answer(method, input)
    return new Response(status === 204 ? null : JSON.stringify(answerBody), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })
  return requests
}

/** The API's answer that no one is signed in. */
export const UNAUTHENTICATED: FakeAnswer = {
  status: 401,
  body: { statusCode: 401, error: 'Unauthorized', message: 'Not signed in' },
}
