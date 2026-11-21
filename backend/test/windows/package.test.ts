import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, testServerUrl, type TestDatabase } from '../helpers/database.ts'

// The Windows portable zip (SC-120, DD-061), unpacked, run natively on Windows against a PostgreSQL
// installed on the same machine: started by hand with its start script, registered and stopped as a
// Windows service (SC-121) reading a configuration restricted as the README says, and backed up and
// restored with its backup script (SC-122), by hand and as the README's scheduled task running as
// SYSTEM. CI runs these on a Windows machine (SC-123) as an administrator, with TEST_WINDOWS_PACKAGE
// naming the folder the zip was unpacked into, a path with a space in it. The README's commands are
// read from the README and run as a user types them at a command prompt, so that the README is what
// is tested. TC-259 (FR-177), the part the zip supports: unpacked and configured with the address
// of an empty database X, the zip starts, migrates X and serves the frontend and the API. Still
// pending, as for the image: creating project `Persisted` as the first system admin (SC-053,
// SC-017) and listing it from a second install.

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

const readme = readFileSync(fileURLToPath(new URL('../../../README.md', import.meta.url)), 'utf8')

/**
 * The one command in the README that starts with `start`: a line of a `bat` block, or an inline
 * code span. The tests run the README's commands as written, so a command that does not work
 * fails here, and is fixed in the README, which is what users follow.
 */
function readmeCommand(start: string): string {
  const blocks = [...readme.matchAll(/```bat\r?\n([\s\S]*?)```/g)].flatMap((match) =>
    match[1]!.split(/\r?\n/),
  )
  const spans = [...readme.matchAll(/`([^`\r\n]+)`/g)].map((match) => match[1]!)
  const found = new Set([...blocks, ...spans].map((line) => line.trim()))
  const commands = [...found].filter((line) => line.startsWith(start))
  if (commands.length !== 1) {
    throw new Error(`The README has ${commands.length} commands starting with ${start}`)
  }
  return commands[0]!
}

/** `command` with each README path replaced by the test's own; each must be there. */
function inPlaceOf(command: string, replacements: Record<string, string>): string {
  for (const [path, replacement] of Object.entries(replacements)) {
    if (!command.includes(path)) throw new Error(`${path} is not in the command: ${command}`)
    command = command.replaceAll(path, replacement)
  }
  return command
}

/** Runs `line` as typed at a command prompt in `cwd`: cmd.exe expands it, quotes as they are. */
function atPrompt(line: string, cwd: string) {
  return spawnSync('cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
    windowsVerbatimArguments: true,
  })
}

/**
 * The access control list of `path`: whether it inherits, and its entries' accounts, by their
 * security identifiers, which do not depend on Windows' display language as account names do.
 */
function accessOf(path: string): {
  inherits: boolean
  entries: { account: string; inherited: boolean }[]
} {
  const sid = '[System.Security.Principal.SecurityIdentifier]'
  const script = [
    '$acl = Get-Acl -LiteralPath $env:ACL_PATH',
    "'protected|' + $acl.AreAccessRulesProtected",
    `foreach ($rule in $acl.Access) { $rule.IdentityReference.Translate(${sid}).Value + '|' + $rule.IsInherited }`,
  ].join('; ')
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      env: { ...process.env, ACL_PATH: path },
    },
  )
  if (result.status !== 0) throw new Error(`Get-Acl failed on ${path}:\n${result.stderr}`)
  const lines = result.stdout.trim().split(/\r?\n/)
  const [first, ...rest] = lines.map((line) => line.split('|'))
  return {
    inherits: first![1] !== 'True',
    entries: rest.map(([account, inherited]) => ({
      account: account!,
      inherited: inherited === 'True',
    })),
  }
}

/** The well-known accounts the README's commands name: SYSTEM, Administrators and Users. */
const system = 'S-1-5-18'
const administrators = 'S-1-5-32-544'
const users = 'S-1-5-32-545'

/** The account running the tests, which `%USERNAME%` names in the README's commands. */
function me(): string {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    ],
    { encoding: 'utf8' },
  )
  return result.stdout.trim()
}

/** Checks that only `accounts` have access to `path`, and that the Users group has none. */
function expectAccessOnlyFor(path: string, accounts: string[], inherited: boolean): void {
  const access = accessOf(path)
  expect(access.inherits).toBe(inherited)
  expect(access.entries.every((entry) => entry.inherited === inherited)).toBe(true)
  expect(access.entries.map((entry) => entry.account)).not.toContain(users)
  expect([...new Set(access.entries.map((entry) => entry.account))].sort()).toEqual(
    [...accounts].sort(),
  )
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
  const secrets = () => join(pkg, 'secrets')
  const keyFile = () => join(secrets(), 'github-app.pem')
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
    rmSync(secrets(), { recursive: true, force: true })
  })

  it('serves the tool once registered and started, reading a config.yaml and key file restricted as the README says, and closes the backend cleanly on a service stop', async () => {
    // The service reads config.yaml from the zip's folder: it gets nothing from this environment.
    // One function is given a GitHub App, so that the service must also read its key file, which
    // the configuration names by a Windows path in single quotes, as the README says.
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    mkdirSync(secrets())
    writeFileSync(keyFile(), privateKey.export({ type: 'pkcs1', format: 'pem' }))
    writeFileSync(
      config(),
      [
        'database:',
        `  url: '${x.url}'`,
        'github:',
        '  apps:',
        '    readIssues:',
        '      appId: 241',
        `      privateKeyFile: '${keyFile()}'`,
        '  tokens:',
        `    writeIssues: ${githubTokens.writeIssues}`,
        `    projectsStatus: ${githubTokens.projectsStatus}`,
        '',
      ].join('\n'),
    )

    // The README's step 4, Restrict: no inherited entries, and only the service's account,
    // the administrators and the user who ran the commands have access; the Users group has none.
    for (const start of ['icacls config.yaml', 'icacls secrets']) {
      expect(atPrompt(readmeCommand(start), pkg)).toMatchObject({ status: 0 })
    }
    const accounts = [system, administrators, me()]
    expectAccessOnlyFor(config(), accounts, false)
    expectAccessOnlyFor(secrets(), accounts, false)
    // The key file, written before the command, now has only what it inherits from `secrets`.
    expectAccessOnlyFor(keyFile(), accounts, true)

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

describe('the nightly backup, as the README schedules it to run as SYSTEM (SC-122)', () => {
  // The README's scheduled task backs up its step 1 database, cold_seance, owned by the role
  // cold_seance, on localhost:5432; the test sets both up as that step does, and takes them down.
  const database = 'cold_seance'
  const password = randomBytes(12).toString('hex')
  const task = 'cold-seance backup'
  const passFile = () => join(pkg, 'pgpass.conf')
  let createdRole = false
  let createdDatabase = false

  async function onServer(sql: string): Promise<void> {
    const client = new Client({ connectionString: testServerUrl() })
    await client.connect()
    try {
      await client.query(sql)
    } finally {
      await client.end()
    }
  }

  /** The README's task, removed whether or not it is there. */
  const removeTask = () =>
    spawnSync('schtasks', ['/Delete', '/TN', task, '/F'], { timeout: 60_000 })

  beforeAll(async () => {
    const server = new URL(testServerUrl())
    if (server.hostname !== 'localhost' || (server.port || '5432') !== '5432') {
      throw new Error("The scheduled backup runs the README's command, on localhost:5432.")
    }
    // A machine's own cold_seance is never touched: the test stops instead.
    await onServer(`CREATE ROLE ${database} LOGIN PASSWORD '${password}'`)
    createdRole = true
    await onServer(`CREATE DATABASE ${database} OWNER ${database}`)
    createdDatabase = true
  })

  afterAll(async () => {
    if (pkg === undefined) return
    removeTask()
    rmSync(passFile(), { force: true })
    if (createdDatabase) await onServer(`DROP DATABASE ${database} WITH (FORCE)`)
    if (createdRole) await onServer(`DROP ROLE ${database}`)
  })

  /**
   * The README's password file, `C:\cold-seance\pgpass.conf` in the folder, restricted with the
   * README's command to SYSTEM and the administrators.
   */
  function writePassFile(): void {
    writeFileSync(passFile(), `localhost:5432:${database}:${database}:${password}\n`)
    const restrict = inPlaceOf(readmeCommand('icacls C:\\cold-seance\\pgpass.conf'), {
      'C:\\cold-seance\\pgpass.conf': `"${passFile()}"`,
    })
    expect(atPrompt(restrict, pkg)).toMatchObject({ status: 0 })
    expectAccessOnlyFor(passFile(), [system, administrators], false)
  }

  /**
   * Registers the README's task, with the README's command, backing up into `folder`. The zip's
   * folder has a space in its path, as does `folder`, so each path is quoted as `\"…\"`, as the
   * README says. `extra` is added to the task's command line.
   */
  function schedule(folder: string, extra = ''): void {
    const quoted = (path: string) => `\\"${path}\\"`
    let create = inPlaceOf(readmeCommand('schtasks /Create'), {
      'C:\\cold-seance\\backup.ps1': quoted(join(pkg, 'backup.ps1')),
      'D:\\backups\\cold-seance': quoted(folder),
      'C:\\cold-seance\\pgpass.conf': quoted(passFile()),
    })
    if (extra) {
      if (!create.endsWith('"')) throw new Error(`/TR is not the last option: ${create}`)
      create = `${create.slice(0, -1)} ${extra}"`
    }
    expect(atPrompt(create, pkg)).toMatchObject({ status: 0 })
  }

  /** Task Scheduler's result codes of a task that has not run yet, and one that is running. */
  const notRunYet = '267011'
  const running = '267009'

  /**
   * Runs the task with the README's command, waits for it to end, and returns its Last Result
   * as `schtasks /Query … /V /FO LIST` prints it, the README's signal of a failed backup.
   */
  async function runTask(): Promise<string> {
    expect(atPrompt(readmeCommand('schtasks /Run'), pkg)).toMatchObject({ status: 0 })
    const query = readmeCommand('schtasks /Query')
    const deadline = Date.now() + 120_000
    let listed = ''
    while (Date.now() < deadline) {
      listed = atPrompt(query, pkg).stdout
      const status = /^Status:\s*(.*?)\s*$/m.exec(listed)?.[1]
      const result = /^Last Result:\s*(.*?)\s*$/m.exec(listed)?.[1]
      if (
        result !== undefined &&
        result !== notRunYet &&
        result !== running &&
        status !== 'Running'
      ) {
        return result
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error(`The scheduled task did not finish:\n${listed}`)
  }

  /** A new, empty folder for the dumps, next to the zip's folder, with a space in its path. */
  function dumpsFolder(): string {
    const folder = mkdtempSync(join(dirname(pkg), 'backups-'))
    scratch.push(folder)
    return folder
  }

  it("dumps the database into a dated file when the README's task runs, which then shows a Last Result of 0", async () => {
    expect(dirname(pkg)).toContain(' ')
    writePassFile()
    const folder = dumpsFolder()
    try {
      schedule(folder)
      expect(await runTask()).toBe('0')
      expect(readdirSync(folder)).toEqual([
        expect.stringMatching(new RegExp(`^${database}-\\d{4}-\\d{2}-\\d{2}-\\d{6}\\.dump$`)),
      ])
    } finally {
      removeTask()
    }
  })

  it('shows a non-zero Last Result, and leaves no dump, when the database cannot be reached', async () => {
    writePassFile()
    const folder = dumpsFolder()
    try {
      schedule(folder, '-Port 1')
      expect(await runTask()).not.toBe('0')
      expect(readdirSync(folder)).toEqual([])
    } finally {
      removeTask()
    }
  })
})
