// Rebases a branch onto main and regenerates its migration on top of main's (SC-073, DD-057). Run by
// `npm run db:rebase -w backend`, through `db-rebase.ts`.
//
// Two branches that each generate a migration from the same main both number it the same and both
// change the journal, so the second to rebase conflicts. Merging the journal by hand is not safe
// either: the migrator applies only migrations newer than the last one a database has, so a
// migration that kept its older timestamp after main's would be skipped on a database that already
// has main's. So the migrations folder is not merged at all: during the rebase each conflict in it
// takes main's side, and afterwards the branch's migration files are removed and its migration is
// generated again from the schema, which the rebase leaves holding both sides' tables.
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const drizzleKit = join(dirname(createRequire(import.meta.url).resolve('drizzle-kit')), 'bin.cjs')

export interface RebaseOptions {
  /** The drizzle-kit configuration that `db:generate` uses, relative to `cwd`. */
  config: string
  /** Where drizzle-kit runs, as `db:generate` does: the configuration's paths are relative to it. */
  cwd: string
  /** What to rebase onto. */
  onto: string
  /** Whether to fetch `onto` from its remote first. */
  fetch: boolean
  /** Where progress and instructions go. */
  log: (line: string) => void
}

/** The backend's own setting: onto `origin/main`, fetched first. */
export const BACKEND_REBASE: RebaseOptions = {
  config: './drizzle.config.ts',
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  onto: 'origin/main',
  fetch: true,
  log: (line) => console.log(line),
}

type Git = (...args: string[]) => Promise<string>

/**
 * Rebases the current branch onto `options.onto`, and generates the branch's migration again on top
 * of `onto`'s, in one commit, under the name it had. Answers the exit code: 0 when done, 1 with the
 * reason and what to do when it stopped, leaving the repository as it was or mid-rebase.
 */
export async function rebaseMigrations(options: RebaseOptions): Promise<number> {
  const { cwd, log } = options
  const git: Git = async (...args) => (await run('git', args, { cwd })).stdout.trim()

  if ((await git('status', '--porcelain')) !== '') {
    log('The working tree has changes. Commit or stash them first.')
    return 1
  }
  if (options.fetch) {
    const slash = options.onto.indexOf('/')
    await git('fetch', options.onto.slice(0, slash), options.onto.slice(slash + 1))
  }

  const out = await migrationsFolder(options)
  const base = await git('merge-base', 'HEAD', options.onto)
  const sql = (await addedFiles(git, base, out)).filter((file) => file.endsWith('.sql'))
  const branch = await git('rev-parse', '--abbrev-ref', 'HEAD')
  const issue = /^(\d+)-/.exec(branch)?.[1]
  const suffix = issue === undefined ? '' : ` (#${issue})`
  const name = sql.map((file) => basename(file, '.sql').replace(/^\d+_/, '')).join('_')

  let kept = ''
  let before = ''
  if (sql.length > 0) {
    before = (await Promise.all(sql.map((file) => readFile(join(cwd, file), 'utf8')))).join('\n')
    kept = join(await mkdtemp(join(tmpdir(), 'db-rebase-')), `${name}.sql`)
    await writeFile(kept, before)
  }

  const stopped = await rebase(git, options.onto, out)
  if (stopped !== undefined) {
    log(`The rebase stopped on a conflict outside the migrations: ${stopped.join(', ')}.`)
    log('Resolve it and run `git rebase --continue`.')
    if (sql.length > 0) {
      log(
        `Then run \`npm run db:rebase -w backend\` again, or remove this branch's files in ${out} ` +
          `and generate the migration with \`npm run db:generate -w backend -- --name ${name}\`. ` +
          `Its SQL before the rebase is kept in ${kept}.`,
      )
    }
    return 1
  }
  if (sql.length === 0) {
    log(`Rebased onto ${options.onto}. This branch adds no migration.`)
    return 0
  }

  // What the rebase left of the branch's migration files, numbered as before main's: removed, and
  // the journal set back to main's, so that generating numbers the migration after main's.
  const leftover = await addedFiles(git, options.onto, out)
  if (leftover.length > 0) await git('rm', '-q', '--', ...leftover)
  await git('checkout', options.onto, '--', `${out}/meta/_journal.json`)
  await run(
    process.execPath,
    [drizzleKit, 'generate', '--config', options.config, '--name', name],
    {
      cwd,
      timeout: 60_000,
    },
  )
  await git('add', '--all', '--', out)

  const root = await git('rev-parse', '--show-toplevel')
  const generated = (await git('diff', '--cached', '--name-only', '--diff-filter=A', '--', out))
    .split('\n')
    .filter((file) => file.endsWith('.sql'))
  if ((await git('diff', '--cached', '--name-only')) !== '') {
    await git('commit', '-q', '-m', `Regenerate the migration on top of ${options.onto}${suffix}`)
  }
  if (generated.length === 0) {
    log(
      `Rebased onto ${options.onto}, but generating gave no migration: ${options.onto} already holds ` +
        `the branch's schema change. The old SQL is kept in ${kept}.`,
    )
    return 0
  }

  const after = (
    await Promise.all(generated.map((file) => readFile(join(root, file), 'utf8')))
  ).join('\n')
  log(`Rebased onto ${options.onto} and generated ${generated.join(', ')} again.`)
  if (after.trim() !== before.trim()) {
    log(
      `Its SQL differs from the one before the rebase, kept in ${kept}. If that one was edited by ` +
        'hand, edit the new one the same way and amend the commit.',
    )
  }
  return 0
}

/** The files under `out` that HEAD adds compared with `from`, relative to the working directory. */
async function addedFiles(git: Git, from: string, out: string): Promise<string[]> {
  return (
    await git('diff', '--name-only', '--relative', '--diff-filter=A', from, 'HEAD', '--', out)
  )
    .split('\n')
    .filter((file) => file !== '')
}

/**
 * Rebases onto `onto`, settling each conflict inside `out` with the side being rebased onto. Answers
 * nothing when the rebase is done, or the conflicted files outside `out` it stopped on.
 */
async function rebase(git: Git, onto: string, out: string): Promise<string[] | undefined> {
  // At the top of the repository, where the paths of conflicted files are relative to. The editor is
  // set so that `rebase --continue` keeps each commit message as it is.
  const env = { ...process.env, GIT_EDITOR: 'true' }
  const prefix = await git('rev-parse', '--show-prefix')
  const root = await git('rev-parse', '--show-toplevel')
  const inOut = (file: string) => file.startsWith(`${prefix}${out}/`)
  let done = await gitIn(root, env, 'rebase', onto)
  while (!done) {
    const conflicted = (await gitOut(root, 'diff', '--name-only', '--diff-filter=U'))
      .split('\n')
      .filter((file) => file !== '')
    if (conflicted.length === 0 || !conflicted.every(inOut)) return conflicted
    for (const file of conflicted) {
      // During a rebase, "ours" is the side being rebased onto.
      if (!(await gitIn(root, env, 'checkout', '--ours', '--', file)))
        await gitIn(root, env, 'rm', '-q', '--', file)
      else await gitIn(root, env, 'add', '--', file)
    }
    done = await gitIn(root, env, 'rebase', '--continue')
  }
  return undefined
}

async function gitIn(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): Promise<boolean> {
  return run('git', args, { cwd, env }).then(
    () => true,
    () => false,
  )
}

async function gitOut(cwd: string, ...args: string[]): Promise<string> {
  return (await run('git', args, { cwd })).stdout.trim()
}

/** The migrations folder named in the drizzle-kit configuration, relative to `cwd`. */
async function migrationsFolder(options: RebaseOptions): Promise<string> {
  const config: unknown = Reflect.get(
    await import(pathToFileURL(join(options.cwd, options.config)).href),
    'default',
  )
  const out: unknown = Reflect.get(Object(config), 'out')
  // drizzle-kit's own default when the configuration names no migrations folder.
  return (typeof out === 'string' ? out : 'drizzle').replace(/^\.\//, '').replace(/\/$/, '')
}
