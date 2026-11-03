// Checks that the Drizzle schema and the migrations generated from it agree (SC-073, DD-057):
// generating a migration from the schema must yield no change. Run by `npm run db:check`, through `db-check.ts`.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** What a failed child process wrote, as `execFile` attaches it to its error. */
function outputOf(error: unknown): { stdout: string; stderr: string } {
  const text = (key: string) => {
    const value: unknown = Reflect.get(Object(error), key)
    return typeof value === 'string' ? value : ''
  }
  return { stdout: text('stdout'), stderr: text('stderr') }
}
const drizzleKit = join(dirname(createRequire(import.meta.url).resolve('drizzle-kit')), 'bin.cjs')

const backend = fileURLToPath(new URL('..', import.meta.url))

/** The schema and migrations folder of the backend, as `drizzle.config.ts` names them. */
export const BACKEND_SCHEMA = {
  schema: './src/db/schema.ts',
  migrations: './drizzle',
  cwd: backend,
}

export interface DriftOptions {
  /** The schema file, relative to `cwd`. */
  schema: string
  /** The migrations folder, relative to `cwd`; it may not exist yet. */
  migrations: string
  /** Where drizzle-kit runs and the schema's imports resolve from. */
  cwd: string
}

/**
 * Generates a migration from the schema into a copy of the migrations folder, leaving the folder
 * itself untouched, and answers the files that generating would add: the SQL of a migration and
 * its snapshot. Empty when the schema and the migrations agree. Throws, with drizzle-kit's output,
 * when drizzle-kit cannot generate, for example on a schema that does not load.
 */
export async function schemaDrift(options: DriftOptions): Promise<string[]> {
  const scratch = await mkdtemp(join(tmpdir(), 'schema-drift-'))
  try {
    const migrations = join(options.cwd, options.migrations)
    if (existsSync(migrations)) await cp(migrations, scratch, { recursive: true })
    const before = new Set(await migrationFiles(scratch))
    const output = await run(
      process.execPath,
      [
        drizzleKit,
        'generate',
        '--dialect',
        'postgresql',
        '--schema',
        options.schema,
        // Relative: drizzle-kit reads the snapshots in an absolute --out path as `./` + that path.
        '--out',
        relative(options.cwd, scratch),
      ],
      { cwd: options.cwd, timeout: 60_000 },
    ).catch((error: unknown) => ({ ...outputOf(error), failed: true }))
    // drizzle-kit exits with 0 even when the schema throws while it loads, having generated
    // nothing; a run that loaded the schema always reports how many tables it found.
    if ('failed' in output || !/^\d+ tables?$/m.test(output.stdout)) {
      throw new Error(
        `drizzle-kit could not generate from ${options.schema}\n${output.stdout}${output.stderr}`.trimEnd(),
      )
    }
    return (await migrationFiles(scratch)).filter((file) => !before.has(file))
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

/** The migration SQL files and their snapshots in a migrations folder, relative to it. */
async function migrationFiles(folder: string): Promise<string[]> {
  const files = await readdir(folder, { recursive: true })
  return files
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => /^[^/]+\.sql$/.test(file) || /^meta\/[^/]+_snapshot\.json$/.test(file))
    .toSorted()
}

/** The command line: exits with 1, naming what is missing, when the schema and migrations differ. */
export async function main(options: DriftOptions = BACKEND_SCHEMA): Promise<number> {
  const added = await schemaDrift(options)
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
