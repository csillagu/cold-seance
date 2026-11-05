import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rebaseMigrations, type RebaseOptions } from './migration-rebase.ts'
import { schemaDrift } from './schema-drift.ts'

const run = promisify(execFile)
const drizzleKit = join(dirname(createRequire(import.meta.url).resolve('drizzle-kit')), 'bin.cjs')

// As in schema-drift.test.ts: the node_modules folder that holds drizzle-orm, linked into the
// scratch repository so its schema resolves it as the backend's own does.
const drizzleOrm = createRequire(import.meta.url).resolve('drizzle-orm')
const nodeModules = drizzleOrm.slice(
  0,
  drizzleOrm.lastIndexOf('node_modules') + 'node_modules'.length,
)

const config = `export default { dialect: 'postgresql', schema: './schema', out: './drizzle' }\n`
const table = (name: string) => `import { pgTable, text, uuid } from 'drizzle-orm/pg-core'
export const ${name} = pgTable('${name}', { id: uuid().primaryKey(), name: text().notNull() })
`

let dir: string
let lines: string[]
let options: RebaseOptions

async function git(...args: string[]): Promise<string> {
  return (await run('git', args, { cwd: dir })).stdout.trim()
}

/** Adds a schema module with one table and its migration, and commits them. */
async function addTable(name: string): Promise<void> {
  await writeFile(join(dir, 'schema', `${name}.ts`), table(name))
  await run(
    process.execPath,
    [drizzleKit, 'generate', '--config', './drizzle.config.ts', '--name', name],
    {
      cwd: dir,
    },
  )
  await git('add', '.')
  await git('commit', '-q', '-m', `Add ${name}`)
}

async function migrations(): Promise<string[]> {
  return (await readdir(join(dir, 'drizzle'))).filter((file) => file.endsWith('.sql')).toSorted()
}

async function journalTags(): Promise<string[]> {
  const journal: unknown = JSON.parse(
    await readFile(join(dir, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  )
  const entries: unknown = Reflect.get(Object(journal), 'entries')
  return (Array.isArray(entries) ? entries : []).map((entry: unknown) =>
    String(Reflect.get(Object(entry), 'tag')),
  )
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'migration-rebase-test-'))
  await symlink(nodeModules, join(dir, 'node_modules'), 'dir')
  await writeFile(join(dir, '.gitignore'), 'node_modules\n')
  await writeFile(join(dir, 'drizzle.config.ts'), config)
  await mkdir(join(dir, 'schema'))
  await git('init', '-q', '-b', 'main')
  await git('config', 'user.email', 'test@example.com')
  await git('config', 'user.name', 'Test')
  await addTable('projects')
  lines = []
  options = {
    config: './drizzle.config.ts',
    cwd: dir,
    onto: 'main',
    fetch: false,
    log: (line) => lines.push(line),
  }
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('rebaseMigrations (SC-073: a branch migration is generated again on top of main)', () => {
  it("drops the branch's migration, rebases, and generates it again after main's", async () => {
    await git('checkout', '-q', '-b', '12-tasks')
    await addTable('tasks')
    await git('checkout', '-q', 'main')
    await addTable('groups')
    await git('checkout', '-q', '12-tasks')

    await expect(rebaseMigrations(options)).resolves.toBe(0)

    expect(await migrations()).toEqual(['0000_projects.sql', '0001_groups.sql', '0002_tasks.sql'])
    expect(await journalTags()).toEqual(['0000_projects', '0001_groups', '0002_tasks'])
    await expect(schemaDrift({ config: './drizzle.config.ts', cwd: dir })).resolves.toEqual([])
    expect((await git('log', '--format=%s', '-3')).split('\n')).toEqual([
      'Regenerate the migration on top of main (#12)',
      'Add tasks',
      'Add groups',
    ])
    expect(lines.join('\n')).not.toMatch(/differs/)
    expect(await git('status', '--porcelain')).toBe('')
  })

  it('only rebases a branch that adds no migration', async () => {
    await git('checkout', '-q', '-b', 'notes')
    await writeFile(join(dir, 'notes.txt'), 'notes\n')
    await git('add', '.')
    await git('commit', '-q', '-m', 'Add notes')
    await git('checkout', '-q', 'main')
    await addTable('groups')
    await git('checkout', '-q', 'notes')

    await expect(rebaseMigrations(options)).resolves.toBe(0)

    expect(await migrations()).toEqual(['0000_projects.sql', '0001_groups.sql'])
    expect(await git('log', '--format=%s', '-1')).toBe('Add notes')
  })

  it('refuses to start with uncommitted changes, and changes nothing', async () => {
    await git('checkout', '-q', '-b', '12-tasks')
    await addTable('tasks')
    await writeFile(join(dir, 'notes.txt'), 'notes\n')
    const head = await git('rev-parse', 'HEAD')

    await expect(rebaseMigrations(options)).resolves.toBe(1)

    expect(lines.join('\n')).toMatch(/Commit or stash/)
    expect(await git('rev-parse', 'HEAD')).toBe(head)
  })

  it('stops on a conflict elsewhere and says how to finish', async () => {
    await writeFile(join(dir, 'notes.txt'), 'base\n')
    await git('add', '.')
    await git('commit', '-q', '-m', 'Add notes')
    await git('checkout', '-q', '-b', '12-tasks')
    await addTable('tasks')
    await writeFile(join(dir, 'notes.txt'), 'branch\n')
    await git('commit', '-q', '-am', 'Change notes on the branch')
    await git('checkout', '-q', 'main')
    await writeFile(join(dir, 'notes.txt'), 'main\n')
    await git('commit', '-q', '-am', 'Change notes on main')
    await git('checkout', '-q', '12-tasks')

    await expect(rebaseMigrations(options)).resolves.toBe(1)

    const said = lines.join('\n')
    expect(said).toMatch(/git rebase --continue/)
    expect(said).toMatch(/npm run db:generate -w backend -- --name tasks/)
  })
})
