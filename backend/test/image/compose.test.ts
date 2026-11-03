import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createConfigFixture, type ConfigFixture } from '../helpers/config.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { docker, fromContainer, testImage } from '../helpers/docker.ts'

// SC-029: the installation Compose file, run as an installer runs it, from a directory of its own
// holding compose.yaml, .env, config.yaml and secrets/. TC-259 (FR-177), the part the Compose
// install supports: an install configured with the address of an external database `X` comes up
// on `X` with the database it was installed with stopped, and a second install on the same address
// uses the same `X`. The test server's database stands in for the hosted one, and a second Compose
// project on the same Docker host for the install on another machine. Still pending: creating
// project `Persisted` as the first system admin (SC-053, SC-017) and listing it from the second
// install.

const composeFile = fileURLToPath(new URL('../../../compose.yaml', import.meta.url))

let image: string
let fx: ConfigFixture
const installs: Install[] = []

beforeAll(() => {
  image = testImage()
  docker('image', 'inspect', image)
  fx = createConfigFixture()
})

afterEach(() => {
  for (const done of installs.splice(0)) done.remove()
})

afterAll(() => {
  fx?.remove()
})

interface Install {
  dir: string
  /** Runs `docker compose` on the install, failing if it fails. */
  compose(...args: string[]): string
  /** Runs `docker compose` on the install and returns how it ended. */
  tryCompose(...args: string[]): { status: number | null; output: string }
  /** The address the application is published on. */
  base(): string
  /** Whether the service's container is running. */
  running(service: string): boolean
  /** Runs SQL on the bundled database as the tool's user. */
  psql(sql: string): string
  remove(): void
}

/**
 * An install directory as the instructions in compose.yaml leave it: the Compose file, a .env
 * holding `env`, a config.yaml naming the GitHub Apps' key files, and those key files in secrets/.
 * `override` adds a Compose override file, as test scaffolding only.
 */
function install(env: Record<string, string>, override?: string): Install {
  const dir = mkdtempSync(join(tmpdir(), 'cold-seance-install-'))
  try {
    return installIn(dir, env, override)
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

function installIn(dir: string, env: Record<string, string>, override?: string): Install {
  copyFileSync(composeFile, join(dir, 'compose.yaml'))
  // A free port of this host for each install, so installs run side by side.
  const dotenv = { COLD_SEANCE_IMAGE: image, COLD_SEANCE_PUBLISH: '127.0.0.1:', ...env }
  writeFileSync(
    join(dir, '.env'),
    Object.entries(dotenv)
      .map(([name, value]) => `${name}=${value}\n`)
      .join(''),
  )
  mkdirSync(join(dir, 'secrets'))
  const apps = Object.entries(fx.keyFiles)
    .map(([fn, path], index) => {
      copyFileSync(path, join(dir, 'secrets', `${fn}.pem`))
      return `    ${fn}:\n      appId: ${index + 1}\n      privateKeyFile: /run/secrets/${fn}.pem\n`
    })
    .join('')
  writeFileSync(join(dir, 'config.yaml'), `github:\n  apps:\n${apps}`)
  // The image runs as the unprivileged `node` user, which must be able to read the mounted files.
  for (const path of ['', 'secrets']) chmodSync(join(dir, path), 0o755)
  const files = ['-f', join(dir, 'compose.yaml')]
  if (override) {
    writeFileSync(join(dir, 'compose.override.test.yaml'), override)
    files.push('-f', join(dir, 'compose.override.test.yaml'))
  }
  const project = `cold-seance-test-${randomUUID().slice(0, 8)}`
  const args = (rest: string[]) => [
    'compose',
    '--project-directory',
    dir,
    '-p',
    project,
    ...files,
    ...rest,
  ]
  // Only the install's .env configures it, not this process's environment.
  const processEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('COLD_SEANCE_') && !name.startsWith('POSTGRES_'),
    ),
  )
  const compose = (...rest: string[]) =>
    execFileSync('docker', args(rest), {
      encoding: 'utf8',
      env: processEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  const tryCompose = (...rest: string[]) => {
    const result = spawnSync('docker', args(rest), { encoding: 'utf8', env: processEnv })
    return { status: result.status, output: result.stdout + result.stderr }
  }
  const self: Install = {
    dir,
    compose,
    tryCompose,
    base: () => `http://${compose('port', 'app', '3000').split('\n')[0]!}`,
    running: (service) => compose('ps', '--status', 'running', '--quiet', service) !== '',
    psql: (sql) =>
      compose(
        'exec',
        '-T',
        'database',
        'psql',
        '-U',
        'cold_seance',
        '-d',
        'cold_seance',
        '-tAc',
        sql,
      ),
    remove: () => {
      tryCompose('down', '--volumes', '--remove-orphans', '--timeout', '5')
      rmSync(dir, { recursive: true, force: true })
    },
  }
  installs.push(self)
  return self
}

/** Waits until the install's application answers, failing with its log if it does not. */
async function serving(at: Install): Promise<string> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const base = at.base()
      await fetch(`${base}/`)
      return base
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(`The application did not start serving:\n${at.tryCompose('logs').output}`)
}

/** Whether a database has the record of applied migrations that the migration step creates. */
const migrationRecord = `select to_regclass('drizzle.__drizzle_migrations') is not null`

describe('TC-259: the tool stores its data in the PostgreSQL database given in its configuration', () => {
  let x: TestDatabase

  beforeAll(async () => {
    // An empty database: the install's own migration step must create what it needs.
    x = await createTestDatabase({ migrate: false })
  })

  afterAll(async () => {
    await x?.drop()
  })

  async function migrationRecordOfX(): Promise<string[] | undefined> {
    const client = new Client({ connectionString: x.url })
    await client.connect()
    try {
      const table = await client.query<{ table: string | null }>(
        `select to_regclass('drizzle.__drizzle_migrations')::text as table`,
      )
      if (table.rows[0]!.table === null) return undefined
      const rows = await client.query<{ hash: string }>(
        'select hash from drizzle.__drizzle_migrations order by id',
      )
      return rows.rows.map((row) => row.hash)
    } finally {
      await client.end()
    }
  }

  // Scaffolding: the test server is on this host, which a container reaches as host.docker.internal.
  // A hosted database has an address of its own and needs nothing of the kind.
  const reachHost =
    'services:\n  app:\n    extra_hosts:\n      - host.docker.internal:host-gateway\n'

  it('TC-259: two Compose installs, one after the other, use the external database X with the bundled one stopped', async () => {
    // I1: installed with its bundled database, and configured with X's address.
    const i1 = install(
      { POSTGRES_PASSWORD: 'bundled-password', COLD_SEANCE_DATABASE_URL: fromContainer(x.url) },
      reachHost,
    )
    i1.compose('up', '--detach', '--wait', '--no-build')
    expect(i1.running('database')).toBe(true)
    // The bundled database was not used: I1 migrated X, and the bundled one has no record.
    await serving(i1)
    const record = await migrationRecordOfX()
    expect(record).toBeDefined()
    expect(i1.psql(migrationRecord)).toBe('f')

    // The database I1 was installed with stopped: I1 starts again and works.
    i1.compose('stop', 'database')
    expect(i1.running('database')).toBe(false)
    i1.compose('restart', 'app')
    expect(i1.running('database')).toBe(false)
    const base1 = await serving(i1)
    const page = await fetch(`${base1}/`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<div id="root"></div>')
    expect((await fetch(`${base1}/api/openapi.json`)).status).toBe(401)
    i1.compose('down', '--timeout', '10')

    // I2: a second install with no bundled database at all, not even a password for one, started as
    // .env.example says for an external database.
    const i2 = install({ COLD_SEANCE_DATABASE_URL: fromContainer(x.url) }, reachHost)
    i2.compose('up', '--detach', '--wait', '--no-build', '--no-deps', 'app')
    expect(i2.running('database')).toBe(false)
    const base2 = await serving(i2)
    expect((await fetch(`${base2}/projects`)).status).toBe(200)
    // I2 came up on X as I1 left it.
    expect(await migrationRecordOfX()).toEqual(record)
    expect(i2.compose('logs', 'app')).not.toContain('could not be applied')
  })
})

describe('the Compose file', () => {
  it('installs with one command: the application next to the bundled PostgreSQL, which it migrates', async () => {
    const at = install({ POSTGRES_PASSWORD: 'bundled-password' })
    at.compose('up', '--detach', '--wait', '--no-build')
    const base = await serving(at)
    expect((await fetch(`${base}/`)).status).toBe(200)
    // The application's database is the bundled one: its migration step ran there.
    expect(at.psql(migrationRecord)).toBe('t')
    expect(at.compose('exec', '-T', 'database', 'postgres', '--version')).toMatch(
      /^postgres \(PostgreSQL\) 18\./,
    )
  })

  it('keeps the data in a volume, across the containers being removed and recreated', async () => {
    const at = install({ POSTGRES_PASSWORD: 'bundled-password' })
    at.compose('up', '--detach', '--wait', '--no-build')
    at.psql(`create table kept (value text); insert into kept values ('still here')`)
    at.compose('down', '--timeout', '10')
    expect(at.compose('ps', '--all', '--quiet')).toBe('')

    at.compose('up', '--detach', '--wait', '--no-build')
    expect(at.psql('select value from kept')).toBe('still here')
    await serving(at)
  })

  it('does not publish the bundled database, only the application', () => {
    const at = install({ POSTGRES_PASSWORD: 'bundled-password' })
    at.compose('up', '--detach', '--wait', '--no-build')
    expect(docker('port', at.compose('ps', '--quiet', 'database'))).toBe('')
    expect(docker('port', at.compose('ps', '--quiet', 'app'))).not.toBe('')
    expect(at.base()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })

  it('publishes the application on this machine only, port 3000, unless told otherwise', () => {
    const at = install({ POSTGRES_PASSWORD: 'p' })
    // The install's .env without COLD_SEANCE_PUBLISH, as .env.example leaves it.
    writeFileSync(join(at.dir, '.env'), `COLD_SEANCE_IMAGE=${image}\nPOSTGRES_PASSWORD=p\n`)
    const config: unknown = JSON.parse(at.compose('config', '--format', 'json'))
    expect(config).toHaveProperty(
      ['services', 'app', 'ports'],
      [expect.objectContaining({ host_ip: '127.0.0.1', published: '3000', target: 3000 })],
    )
  })

  it('does not bring the bundled database up without a password, and says why', () => {
    const at = install({})
    const result = at.tryCompose('up', '--detach', '--wait', '--no-build')
    expect(result.status).not.toBe(0)
    expect(at.running('app')).toBe(false)
    expect(at.compose('logs', 'database')).toContain('superuser password is not specified')
  })

  it('does not start without config.yaml, rather than mounting an empty directory in its place', () => {
    const at = install({ POSTGRES_PASSWORD: 'bundled-password' })
    rmSync(join(at.dir, 'config.yaml'))
    const result = at.tryCompose('up', '--detach', '--no-build')
    expect(result.status).not.toBe(0)
    expect(result.output).toMatch(/config\.yaml/)
    expect(at.running('app')).toBe(false)
  })
})
