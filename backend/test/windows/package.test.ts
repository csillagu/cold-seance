import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, testServerUrl, type TestDatabase } from '../helpers/database.ts'

// The Windows portable zip (SC-120, DD-061), unpacked, run natively on Windows against a PostgreSQL
// installed on the same machine: started by hand with its start script, registered and stopped as a
// Windows service (SC-121), and backed up and restored with its backup script (SC-122). CI runs these
// on a Windows machine (SC-123), with TEST_WINDOWS_PACKAGE naming the folder the zip was unpacked
// into, a path with a space in it. TC-259 (FR-177), the part the zip supports: unpacked and configured
// with the address of an empty database X, the zip starts, migrates X and serves the frontend and
// the API. Still pending, as for the image: creating project `Persisted` as the first system admin
// (SC-053, SC-017) and listing it from a second install.

/** Where the tool listens unless configured otherwise: this machine only, port 3000 (DD-061). */
const base = 'http://127.0.0.1:3000'

/** GitHub settings that let the tool start; nothing here calls GitHub. */
const githubTokens = {
  readIssues: 'github_pat_read',
  writeIssues: 'github_pat_write',
  projectsStatus: 'github_pat_status',
}
const githubEnv = {
  COLD_SEANCE_GITHUB_TOKENS_READ_ISSUES: githubTokens.readIssues,
  COLD_SEANCE_GITHUB_TOKENS_WRITE_ISSUES: githubTokens.writeIssues,
  COLD_SEANCE_GITHUB_TOKENS_PROJECTS_STATUS: githubTokens.projectsStatus,
}

let pkg: string
let x: TestDatabase
const scratch: string[] = []

beforeAll(async () => {
  if (process.platform !== 'win32') throw new Error('The Windows package tests run on Windows.')
  const dir = process.env['TEST_WINDOWS_PACKAGE']
  if (!dir) throw new Error('TEST_WINDOWS_PACKAGE must name the folder the zip was unpacked into.')
  pkg = dir
  // An empty database: the zip's own migration step must create what it needs.
  x = await createTestDatabase({ migrate: false })
})

afterAll(async () => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
  await x?.drop()
})

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cold-seance-windows-'))
  scratch.push(dir)
  return dir
}

/** A tool started by hand with the zip's start script, and everything it printed. */
interface Started {
  process: ChildProcess
  output: () => string
}

/** Starts the tool with its start script, from another folder, on `databaseUrl`. */
function startByHand(databaseUrl: string): Started {
  let output = ''
  const child = spawn('cmd.exe', ['/d', '/c', join(pkg, 'start.cmd')], {
    cwd: tmpdir(),
    env: { ...process.env, ...githubEnv, COLD_SEANCE_DATABASE_URL: databaseUrl },
    windowsHide: true,
  })
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
  return { process: child, output: () => output }
}

/** Ends a tool started by hand: cmd.exe and the Node.js process it started. */
function stopByHand(started: Started): void {
  spawnSync('taskkill', ['/pid', String(started.process.pid), '/t', '/f'])
}

/** Waits until the tool answers on `base`, failing with `log()` if `running()` turns false first. */
async function serving(running: () => boolean, log: () => string): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      await fetch(`${base}/`)
      return
    } catch {
      if (!running()) break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(`The tool did not start serving:\n${log()}`)
}

async function answers(): Promise<boolean> {
  return fetch(`${base}/`).then(
    () => true,
    () => false,
  )
}

/** The database's record of applied migrations; undefined if it has none. */
async function migrationRecord(url: string): Promise<string[] | undefined> {
  const client = new Client({ connectionString: url })
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

/** Checks that the tool on `base` serves the frontend, and the API, which asks who is calling. */
async function expectServesTheTool(): Promise<void> {
  const page = await fetch(`${base}/`)
  expect(page.status).toBe(200)
  expect(await page.text()).toContain('<div id="root"></div>')
  expect((await fetch(`${base}/api/openapi.json`)).status).toBe(401)
}

describe('TC-259: the tool stores its data in the PostgreSQL database given in its configuration', () => {
  it('TC-259: the unpacked zip, started by hand from another folder, migrates the empty database X given in its configuration and serves the tool on 127.0.0.1:3000 (SC-120)', async () => {
    // The folder's path has a space in it, as C:\Program Files does.
    expect(pkg).toContain(' ')
    const started = startByHand(x.url)
    try {
      await serving(() => started.process.exitCode === null, started.output)
      expect(await migrationRecord(x.url)).toBeDefined()
      await expectServesTheTool()
    } finally {
      stopByHand(started)
    }
  })
})

describe('the Windows zip (SC-120)', () => {
  it('runs on a Node.js that takes the time zone from TZ, as the README says', () => {
    const result = spawnSync(
      join(pkg, 'node.exe'),
      ['-p', 'new Date(Date.UTC(2026, 6, 1)).getTimezoneOffset()'],
      { encoding: 'utf8', env: { ...process.env, TZ: 'Europe/Budapest' } },
    )
    expect(result.stdout.trim()).toBe('-120')
  })
})

describe('the Windows service (SC-121)', () => {
  const wrapper = () => join(pkg, 'cold-seance-service.exe')
  const service = (command: string) =>
    spawnSync(wrapper(), [command], { cwd: pkg, encoding: 'utf8', timeout: 90_000 })
  const config = () => join(pkg, 'config.yaml')
  const logs = () =>
    [
      'cold-seance-service.out.log',
      'cold-seance-service.err.log',
      'cold-seance-service.wrapper.log',
    ]
      .map((name) => join(pkg, name))
      .filter((path) => existsSync(path))
      .map((path) => `${path}:\n${readFileSync(path, 'utf8')}`)
      .join('\n')

  afterAll(() => {
    if (pkg === undefined) return
    service('stopwait')
    service('uninstall')
    rmSync(config(), { force: true })
  })

  it('serves the tool once registered and started, and closes the backend cleanly on a service stop', async () => {
    // The service reads config.yaml from the zip's folder: it gets nothing from this environment.
    writeFileSync(
      config(),
      [
        'database:',
        `  url: '${x.url}'`,
        'github:',
        '  tokens:',
        ...Object.entries(githubTokens).map(([name, token]) => `    ${name}: ${token}`),
        '',
      ].join('\n'),
    )
    const install = service('install')
    expect(install).toMatchObject({ status: 0 })
    const start = service('start')
    expect(start).toMatchObject({ status: 0 })
    await serving(() => true, logs)
    await expectServesTheTool()

    // A service stop reaches the backend as Ctrl+C, which it takes as an interrupt: it closes and
    // ends by itself, well within the wrapper's stop timeout of 30 seconds.
    const stopping = Date.now()
    const stop = service('stopwait')
    expect(stop).toMatchObject({ status: 0 })
    expect(Date.now() - stopping).toBeLessThan(25_000)
    expect(await answers()).toBe(false)
    const out = logs()
    expect(out).toContain('SIGINT received; closing')
    expect(out).not.toContain('could not be closed cleanly')
  })
})

describe('the Windows backup script (SC-122)', () => {
  const server = new URL(testServerUrl())
  const user = decodeURIComponent(server.username)
  const day = 24 * 60 * 60 * 1000

  /** Runs backup.ps1 as the scheduled task in the README does, with a password file. */
  function backup(folder: string, passFile: string, port = server.port || '5432') {
    return spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        join(pkg, 'backup.ps1'),
        '-Folder',
        folder,
        '-Database',
        x.name,
        '-User',
        user,
        '-Server',
        server.hostname,
        '-Port',
        port,
        '-PassFile',
        passFile,
      ],
      { encoding: 'utf8', timeout: 90_000 },
    )
  }

  /** A file in `folder` with the given age in days. */
  function aged(folder: string, name: string, days: number): string {
    const path = join(folder, name)
    writeFileSync(path, 'an earlier dump')
    const when = new Date(Date.now() - days * day)
    utimesSync(path, when, when)
    return name
  }

  it('dumps the database into a dated file, prunes its dumps older than 7 days, and the dump restores into an empty database the tool starts on', async () => {
    const dir = scratchDir()
    const folder = join(dir, 'backups')
    const passFile = join(dir, 'pgpass.conf')
    // PostgreSQL's own password file, so that no password is given to the script.
    writeFileSync(
      passFile,
      `${server.hostname}:${server.port || '5432'}:*:${user}:${decodeURIComponent(server.password)}\n`,
    )
    // The first run makes the folder; the second finds earlier dumps in it.
    const first = backup(folder, passFile)
    expect(first).toMatchObject({ status: 0 })
    const old = aged(folder, `${x.name}-2000-01-01-000000.dump`, 8)
    const recent = aged(folder, `${x.name}-2000-01-02-000000.dump`, 6)
    const another = aged(folder, 'another_database-2000-01-01-000000.dump', 30)
    const before = readdirSync(folder)

    const result = backup(folder, passFile)
    expect(result).toMatchObject({ status: 0 })
    const after = readdirSync(folder)
    const taken = after.filter((name) => !before.includes(name))
    expect(taken).toHaveLength(1)
    expect(taken[0]).toMatch(new RegExp(`^${x.name}-\\d{4}-\\d{2}-\\d{2}-\\d{6}\\.dump$`))
    expect(after).not.toContain(old)
    expect(after).toContain(recent)
    expect(after).toContain(another)

    // Restored into an empty database, the dump is the whole schema: the tool starts on it with
    // nothing left to migrate.
    const y = await createTestDatabase({ migrate: false })
    try {
      const pgBin = process.env['PGBIN']
      const restore = spawnSync(
        pgBin ? join(pgBin, 'pg_restore.exe') : 'pg_restore',
        ['--no-owner', '--exit-on-error', `--dbname=${y.url}`, join(folder, taken[0]!)],
        { encoding: 'utf8' },
      )
      expect(restore).toMatchObject({ status: 0 })
      expect(await migrationRecord(y.url)).toEqual(await migrationRecord(x.url))
      const started = startByHand(y.url)
      try {
        await serving(() => started.process.exitCode === null, started.output)
        await expectServesTheTool()
      } finally {
        stopByHand(started)
      }
    } finally {
      await y.drop()
    }
  })

  it('fails with a non-zero exit code, and leaves no dump, when the database cannot be reached', () => {
    const dir = scratchDir()
    const folder = join(dir, 'backups')
    writeFileSync(join(dir, 'pgpass.conf'), '')
    const result = backup(folder, join(dir, 'pgpass.conf'), '1')
    expect(result.status).not.toBe(0)
    expect(readdirSync(folder)).toEqual([])
  })
})
