import { spawnSync } from 'node:child_process'
import { chmodSync } from 'node:fs'
import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createConfigFixture, type ConfigFixture } from '../helpers/config.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { docker, fromContainer, testImage } from '../helpers/docker.ts'

// SC-028: the application image, run as Docker runs it. TC-259 (FR-177), the part the image
// supports: an install of the image, configured with the address of an external database `X` and
// with no database of its own, starts, migrates `X` and serves the frontend and the API; stopped
// and replaced by a second install on the same address, the second uses the same `X`.
// The test server's database stands in for the hosted one, reached from the containers as another
// host, and a second container on the same Docker host stands in for the install on another
// machine. The Compose install's part, with its own database stopped, is in compose.test.ts (SC-029).
// Still pending: creating project `Persisted` as the first system admin (SC-053, SC-017) and listing
// it from the second install.

/** Where the container keeps the configuration fixture's files. */
const configMount = '/config'

let image: string
let x: TestDatabase
let fx: ConfigFixture
const containers: string[] = []

beforeAll(async () => {
  image = testImage()
  docker('image', 'inspect', image)
  // An empty database: the image's own migration step must create what it needs.
  x = await createTestDatabase({ migrate: false })
  fx = createConfigFixture()
  // The image runs as the unprivileged `node` user, which must be able to read the mounted files.
  chmodSync(fx.dir, 0o755)
})

afterEach(() => {
  for (const id of containers.splice(0)) spawnSync('docker', ['rm', '-f', id])
})

afterAll(async () => {
  fx?.remove()
  await x?.drop()
})

/** The GitHub settings, with the key files at their path inside the container. */
function githubEnv(): string[] {
  return Object.entries(fx.githubEnv).flatMap(([name, value]) => [
    '-e',
    `${name}=${value.replace(fx.dir, configMount)}`,
  ])
}

/** Starts a container of the image, its port 3000 published on a free port of this host. */
function run(...args: string[]): { id: string; base: string } {
  const id = docker(
    'run',
    '--detach',
    '--add-host=host.docker.internal:host-gateway',
    '--publish',
    '127.0.0.1::3000',
    '--volume',
    `${fx.dir}:${configMount}:ro`,
    ...githubEnv(),
    ...args,
    image,
  )
  containers.push(id)
  const published = docker('port', id, '3000/tcp').split('\n')[0]!
  return { id, base: `http://${published}` }
}

/** Waits until the container answers, failing with its log if it stops first. */
async function serving(container: { id: string; base: string }): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      await fetch(`${container.base}/`)
      return
    } catch {
      if (docker('inspect', '--format', '{{.State.Running}}', container.id) !== 'true') break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(`The container did not start serving:\n${logs(container.id)}`)
}

function logs(id: string): string {
  const result = spawnSync('docker', ['logs', id], { encoding: 'utf8' })
  return result.stdout + result.stderr
}

async function onX<T>(query: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: x.url })
  await client.connect()
  try {
    return await query(client)
  } finally {
    await client.end()
  }
}

/** X's record of applied migrations, which the migration step creates; undefined if it has none. */
async function migrationRecordOfX(): Promise<string[] | undefined> {
  return onX(async (client) => {
    const table = await client.query<{ table: string | null }>(
      `select to_regclass('drizzle.__drizzle_migrations')::text as table`,
    )
    if (table.rows[0]!.table === null) return undefined
    const rows = await client.query<{ hash: string }>(
      'select hash from drizzle.__drizzle_migrations order by id',
    )
    return rows.rows.map((row) => row.hash)
  })
}

/** Lets X take connections, or refuses every new one, as a hosted database that is down would. */
async function xAcceptsConnections(allow: boolean): Promise<void> {
  const client = new Client({ connectionString: process.env['TEST_DATABASE_URL'] })
  await client.connect()
  try {
    await client.query(`alter database "${x.name}" with allow_connections ${String(allow)}`)
  } finally {
    await client.end()
  }
}

describe('TC-259: the tool stores its data in the PostgreSQL database given in its configuration', () => {
  it('TC-259: two installs of the image, one after the other, use the external database X given in their configuration', async () => {
    // I1: X's address in its configuration file, mounted where the image reads it by default.
    fx.write('config.yaml', `database:\n  url: ${fromContainer(x.url)}\n`)
    const i1 = run('--volume', `${fx.dir}/config.yaml:/app/config.yaml:ro`)
    await serving(i1)

    // I1 starts and works with no database of its own: it migrated X and serves the frontend and
    // the API.
    const record = await migrationRecordOfX()
    expect(record).toBeDefined()
    const page = await fetch(`${i1.base}/`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<div id="root"></div>')
    expect((await fetch(`${i1.base}/api/openapi.json`)).status).toBe(401)

    // Stopped as Docker stops it, I1 closes cleanly.
    docker('stop', i1.id)
    expect(docker('inspect', '--format', '{{.State.ExitCode}}', i1.id)).toBe('0')

    // I2: the same address, given by the environment this time. That it uses X, and nothing
    // else, shows first by its refusing to come up while X takes no connections, naming X...
    const i2Env = ['-e', `COLD_SEANCE_DATABASE_URL=${fromContainer(x.url)}`]
    await xAcceptsConnections(false)
    try {
      const refused = spawnSync(
        'docker',
        [
          'run',
          '--rm',
          '--add-host=host.docker.internal:host-gateway',
          '--volume',
          `${fx.dir}:${configMount}:ro`,
          ...githubEnv(),
          ...i2Env,
          image,
        ],
        {
          encoding: 'utf8',
          timeout: 30_000,
        },
      )
      expect(refused.status).toBe(1)
      expect(refused.stderr).toContain(
        `database "${x.name}" is not currently accepting connections`,
      )
    } finally {
      await xAcceptsConnections(true)
    }

    // ...then by its coming up on X as I1 left it: X's record of applied migrations unchanged.
    const i2 = run(...i2Env)
    await serving(i2)
    expect((await fetch(`${i2.base}/projects`)).status).toBe(200)
    expect(await migrationRecordOfX()).toEqual(record)
    expect(logs(i2.id)).not.toContain('could not be applied')
  })
})

describe('the application image', () => {
  it('does not come up on a database it cannot reach, and says why without the password', () => {
    const result = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--volume',
        `${fx.dir}:${configMount}:ro`,
        ...githubEnv(),
        '-e',
        'COLD_SEANCE_DATABASE_URL=postgres://u:secret-password@127.0.0.1:1/installed',
        image,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'The database migrations could not be applied, so the tool does not start',
    )
    expect(result.stderr).not.toContain('secret-password')
  })

  it('refuses to start without a database address, naming the setting', () => {
    const result = spawnSync('docker', ['run', '--rm', ...githubEnv(), image], {
      encoding: 'utf8',
      timeout: 30_000,
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'database.url (COLD_SEANCE_DATABASE_URL) is required but not set',
    )
  })

  it('runs as an unprivileged user, listening on every interface of the container on port 3000', () => {
    const inspect = (field: string) => docker('image', 'inspect', '--format', field, image)
    const user = inspect('{{.Config.User}}')
    const env = inspect('{{range .Config.Env}}{{println .}}{{end}}').split('\n')
    const ports = inspect('{{range $port, $_ := .Config.ExposedPorts}}{{println $port}}{{end}}')
    expect(user).toBe('node')
    expect(env).toContain('COLD_SEANCE_SERVER_HOST=0.0.0.0')
    expect(ports).toBe('3000/tcp')
  })

  it('holds no configuration file, key file or env file', () => {
    const found = docker(
      'run',
      '--rm',
      '--entrypoint',
      'find',
      image,
      '/app',
      '-path',
      '/app/node_modules',
      '-prune',
      '-o',
      '(',
      '-name',
      'config.yaml',
      '-o',
      '-name',
      '*.pem',
      '-o',
      '-name',
      '*.key',
      '-o',
      '-name',
      '*.yaml',
      '-o',
      '-name',
      '.env*',
      ')',
      '-print',
    )
    expect(found).toBe('')
  })
})
