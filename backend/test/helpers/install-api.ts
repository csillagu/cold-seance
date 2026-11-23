/**
 * The first system admin of an install that the image, Compose and Windows tests start, and the
 * REST API calls TC-259's steps make as them over HTTP, as any client of an install would: sign
 * in, create a project and list the projects.
 */

/** The first system admin, created at an install's start from its settings (SC-053, FR-165). */
export const FIRST_ADMIN = { username: 'root', password: 'root-password' } as const

/** The environment variables that give an install `FIRST_ADMIN`. */
export const firstAdminEnv = {
  COLD_SEANCE_FIRST_ADMIN_USERNAME: FIRST_ADMIN.username,
  COLD_SEANCE_FIRST_ADMIN_PASSWORD: FIRST_ADMIN.password,
}

/** The same settings as lines of a config.yaml. */
export const firstAdminConfig = `firstAdmin:\n  username: ${FIRST_ADMIN.username}\n  password: ${FIRST_ADMIN.password}\n`

/** A session on an install's REST API. */
export interface SignedIn {
  /** Creates a project (SC-017) and returns its id. */
  createProject(name: string): Promise<string>
  /** The names of the projects the account can read. */
  projectNames(): Promise<string[]>
}

/** Signs in to the install on `base` as `account`, failing if it is refused. */
export async function signIn(
  base: string,
  account: { username: string; password: string } = FIRST_ADMIN,
): Promise<SignedIn> {
  const signedIn = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(account),
  })
  if (signedIn.status !== 204) {
    throw new Error(`Signing in as ${account.username} answered ${signedIn.status}`)
  }
  const cookie = signedIn.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const call = async <T>(
    method: string,
    path: string,
    expected: number,
    body?: unknown,
  ): Promise<T> => {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    if (response.status !== expected) {
      throw new Error(`${method} ${path} answered ${response.status}: ${text}`)
    }
    const answer: T = JSON.parse(text)
    return answer
  }
  return {
    createProject: async (name) =>
      (await call<{ id: string }>('POST', '/projects', 201, { name })).id,
    projectNames: async () =>
      (await call<{ name: string }[]>('GET', '/projects', 200)).map((p) => p.name),
  }
}
