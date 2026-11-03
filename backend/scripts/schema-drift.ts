// Checks that the Drizzle schema and the migrations generated from it agree (SC-073, DD-057):
// generating a migration from the schema must yield no change. Run by `npm run db:check`, through
// `db-check.ts`.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const drizzleKit = join(dirname(createRequire(import.meta.url).resolve('drizzle-kit')), 'bin.cjs')

export interface DriftOptions {
  /** The drizzle-kit configuration that `db:generate` uses, relative to `cwd`. */
  config: string
  /** Where drizzle-kit runs, as `db:generate` does: the configuration's paths are relative to it. */
  cwd: string
}

/** The backend's own configuration, the one `npm run db:generate -w backend` uses. */
export const BACKEND_SCHEMA: DriftOptions = {
  config: './drizzle.config.ts',
  cwd: fileURLToPath(new URL('..', import.meta.url)),
}

/** What a failed child process wrote, as `execFile` attaches it to its error. */
export function outputOf(error: unknown): { stdout: string; stderr: string } {
  const text = (key: string) => {
    const value: unknown = Reflect.get(Object(error), key)
    return typeof value === 'string' ? value : ''
  }
  return { stdout: text('stdout'), stderr: text('stderr') }
}

/**
 * Generates a migration from the schema, with the configuration `db:generate` uses changed only
 * in where it writes: into a scratch copy of the migrations folder, which is left untouched. Answers
 * the files that generating would add, such as the SQL of a migration and its snapshot; empty when
 * the schema and the migrations agree. Throws, with drizzle-kit's output, when drizzle-kit could
 * not generate: a schema that does not load, or a rename it would have to ask about.
 */
export async function schemaDrift(options: DriftOptions): Promise<string[]> {
  const configUrl = pathToFileURL(join(options.cwd, options.config)).href
  const config: unknown = Reflect.get(await import(configUrl), 'default')
  const out = Reflect.get(Object(config), 'out')
  if (typeof out !== 'string') throw new Error(`${options.config} names no migrations folder (out)`)

  const scratch = await mkdtemp(join(tmpdir(), 'schema-drift-'))
  try {
    const copy = join(scratch, 'migrations')
    const migrations = join(options.cwd, out)
    if (existsSync(migrations)) await cp(migrations, copy, { recursive: true })
    else await mkdir(copy)
    const before = new Set(await filesIn(copy))

    // Relative: drizzle-kit reads the snapshots in an absolute `out` path as `./` + that path.
    const scratchConfig = join(scratch, 'drizzle.config.mjs')
    const scratchOut = relative(options.cwd, copy)
    await writeFile(
      scratchConfig,
      `export default ${JSON.stringify({ ...Object(config), out: scratchOut })}\n`,
    )

    const output = await run(
      process.execPath,
      [drizzleKit, 'generate', '--config', scratchConfig],
      {
        cwd: options.cwd,
        timeout: 60_000,
      },
    ).catch((error: unknown) => ({ ...outputOf(error), failed: true }))
    // drizzle-kit exits with 0 even when the schema throws while it loads, or when it would have
    // to ask about a rename, having generated nothing. A run that loaded the schema reports how
    // many tables it found, and reports no error.
    const loaded = /^\d+ tables?$/m.test(output.stdout)
    if ('failed' in output || !loaded || /\bError\b/.test(output.stderr)) {
      throw new Error(
        `drizzle-kit could not generate with ${options.config}\n${output.stdout}${output.stderr}`.trimEnd(),
      )
    }
    return (await filesIn(copy)).filter((file) => !before.has(file))
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

/**
 * The files in a migrations folder, relative to it, except the journal: drizzle-kit writes one even
 * when there is nothing to generate. Any other new file is a migration or part of one.
 */
async function filesIn(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
    .filter((file) => file !== 'meta/_journal.json')
    .toSorted()
}

/** The command line: answers the exit code, 1 with the reason when the check does not pass. */
export async function main(options: DriftOptions = BACKEND_SCHEMA): Promise<number> {
  let added: string[]
  try {
    added = await schemaDrift(options)
  } catch (error) {
    console.error(
      `${String(error).replace(/^Error: /, '')}\n\n` +
        'If drizzle-kit has to ask whether something was renamed, run ' +
        '`npm run db:generate -w backend` in a terminal to answer it.',
    )
    return 1
  }
  if (added.length === 0) {
    console.log('The schema and the migrations agree.')
    return 0
  }
  console.error(
    `The schema has changes no migration holds: generating would add ${added.join(', ')}.\n` +
      'Run `npm run db:generate -w backend` and commit the migration it writes.',
  )
  return 1
}
