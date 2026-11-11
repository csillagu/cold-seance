/**
 * The REST API's error body (SC-026): every error is answered as `{ statusCode, error, message }`.
 */
export interface ApiErrorBody {
  statusCode: number
  error: string
  message: string
}

/** A request the REST API answered with an error status. */
export class ApiError extends Error {
  readonly status: number
  readonly error: string | undefined

  constructor(status: number, body: Partial<ApiErrorBody> | undefined) {
    super(body?.message ?? `The request failed with status ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.error = body?.error
  }
}

/**
 * Calls the REST API under `/api`. The browser sends the session cookie itself (DD-054); a JSON
 * body is sent as JSON. Resolves with the parsed answer, or `null` for one without a body
 * (204), and rejects with an `ApiError` for an error status.
 */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
    signal: init.signal,
  })
  const text = await response.text()
  if (!response.ok) throw new ApiError(response.status, errorBodyOf(text))
  // An answer without a body (204) gives null.
  return JSON.parse(text === '' ? 'null' : text)
}

/** The API's error body in `text`, or `undefined` if it holds none. */
function errorBodyOf(text: string): Partial<ApiErrorBody> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const body: Partial<ApiErrorBody> = {}
  if ('error' in parsed && typeof parsed.error === 'string') body.error = parsed.error
  if ('message' in parsed && typeof parsed.message === 'string') body.message = parsed.message
  return body
}

/** Whether `error` is the API's answer that no one is signed in (401). */
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}
