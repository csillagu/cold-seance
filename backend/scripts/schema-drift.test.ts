import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKEND_SCHEMA, main, outputOf, schemaDrift, type DriftOptions } from './schema-drift.ts'

const run = promisify(execFile)
const drizzleKit = join(dirname(createRequire(import.meta.url).resolve('drizzle-kit')), 'bin.cjs')

// The node_modules folder that holds drizzle-orm, linked into each scratch folder so a schema
// written there resolves it as the backend's own does. (drizzle-kit finds no schema file inside a
// node_modules folder, so the scratch folder cannot simply live in one.)
const drizzleOrm = createRequire(import.meta.url).resolve('drizzle-orm')
const nodeModules = drizzleOrm.slice(
  0,
  drizzleOrm.lastIndexOf('node_modules') + 'node_modules'.length,
)

const projects = `import { pgTable, text, uuid } from 'drizzle-orm/pg-core'
export const projects = pgTable('projects', { id: uuid().primaryKey(), name: text().notNull() })
`
const projectsWithKey = `import { pgTable, text, uuid } from 'drizzle-orm/pg-core'
export const projects = pgTable('projects', {
  id: uuid().primaryKey(),
  name: text().notNull(),
  key: text(),
})
`

const config = `export default { dialect: 'postgresql', schema: './schema.ts', out: './drizzle' }\n`

let dir: string
let options: DriftOptions

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'schema-drift-test-'))
  await symlink(nodeModules, join(dir, 'node_modules'), 'dir')
  await writeFile(join(dir, 'drizzle.config.ts'), config)
  options = { config: './drizzle.config.ts', cwd: dir }
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

/** Generates the schema's migration into the migrations folder, as `npm run db:generate` does. */
async function generate(): Promise<void> {
  await run(process.execPath, [drizzleKit, 'generate', '--config', './drizzle.config.ts'], {
    cwd: dir,
  })
}

async function listing(folder: string): Promise<string[]> {
  return (await readdir(folder, { recursive: true })).toSorted()
}

describe('schemaDrift (SC-073: generating a migration from the schema yields no change)', () => {
  it("finds no change between the backend's own schema and its migrations", async () => {
    await expect(schemaDrift(BACKEND_SCHEMA)).resolves.toEqual([])
  })

  it('reports the migration a schema with a table but no migrations would need', async () => {
    await writeFile(join(dir, 'schema.ts'), projects)
    const added = await schemaDrift(options)
    expect(added).toHaveLength(2)
    expect(added[0]).toMatch(/^0000_\w+\.sql$/)
    expect(added[1]).toBe('meta/0000_snapshot.json')
  })

  it('finds no change once the migration has been generated from the schema', async () => {
    await writeFile(join(dir, 'schema.ts'), projects)
    await generate()
    await expect(schemaDrift(options)).resolves.toEqual([])
  })

  it('reports a change made to the schema after its last migration', async () => {
    await writeFile(join(dir, 'schema.ts'), projects)
    await generate()
    await writeFile(join(dir, 'schema.ts'), projectsWithKey)
    const added = await schemaDrift(options)
    expect(added).toEqual([expect.stringMatching(/^0001_\w+\.sql$/), 'meta/0001_snapshot.json'])
  })

  it('leaves the migrations folder itself untouched', async () => {
    await writeFile(join(dir, 'schema.ts'), projects)
    await generate()
    await writeFile(join(dir, 'schema.ts'), projectsWithKey)
    const before = await listing(join(dir, 'drizzle'))
    await schemaDrift(options)
    expect(await listing(join(dir, 'drizzle'))).toEqual(before)
  })

  it('fails, with what drizzle-kit said, when the schema cannot be loaded', async () => {
    await writeFile(join(dir, 'schema.ts'), "throw new Error('broken schema')\n")
    // drizzle-kit itself exits with 0 here; the check must still fail.
    await expect(schemaDrift(options)).rejects.toThrow(
      /drizzle-kit could not generate with \.\/drizzle\.config\.ts\n[^]*broken schema/,
    )
  })

  it('fails when drizzle-kit itself fails, for a schema file that does not exist', async () => {
    await writeFile(join(dir, 'drizzle.config.ts'), config.replace('./schema.ts', './missing.ts'))
    await expect(schemaDrift(options)).rejects.toThrow(
      /drizzle-kit could not generate with \.\/drizzle\.config\.ts\n[^]*No schema files found/,
    )
  })

  it('fails when generating would need to ask whether a table was renamed', async () => {
    await writeFile(join(dir, 'schema.ts'), projects)
    await generate()
    await writeFile(
      join(dir, 'schema.ts'),
      projects.replace("pgTable('projects'", "pgTable('plans'"),
    )
    // drizzle-kit exits with 0 here too, having generated nothing, as it has no terminal to ask in.
    await expect(schemaDrift(options)).rejects.toThrow(/drizzle-kit could not generate/)
  })

  it('generates with the configuration db:generate uses, not only its paths', async () => {
    const snakeCase = config.replace("out: './drizzle'", "out: './drizzle', casing: 'snake_case'")
    await writeFile(join(dir, 'drizzle.config.ts'), snakeCase)
    await writeFile(
      join(dir, 'schema.ts'),
      `import { pgTable, text } from 'drizzle-orm/pg-core'\nexport const plans = pgTable('plans', { projectName: text() })\n`,
    )
    await generate()
    // Without the casing, the check would find project_name changed to projectName.
    await expect(schemaDrift(options)).resolves.toEqual([])
  })

  it('fails when the configuration names no migrations folder', async () => {
    await writeFile(join(dir, 'drizzle.config.ts'), "export default { dialect: 'postgresql' }\n")
    await expect(schemaDrift(options)).rejects.toThrow(
      './drizzle.config.ts names no migrations folder (out)',
    )
  })

  it('fails when the migrations folder cannot be copied', async () => {
    await writeFile(join(dir, 'schema.ts'), projects)
    await writeFile(join(dir, 'drizzle'), 'not a folder')
    await expect(schemaDrift(options)).rejects.toThrow(/directory/)
  })
})

describe('outputOf', () => {
  it('reads what a failed child process wrote', () => {
    expect(outputOf(Object.assign(new Error('x'), { stdout: 'out', stderr: 'err' }))).toEqual({
      stdout: 'out',
      stderr: 'err',
    })
  })

  it('reads nothing from an error that carries no output, such as a process that did not start', () => {
    expect(outputOf(Object.assign(new Error('spawn ENOENT'), { stdout: undefined }))).toEqual({
      stdout: '',
      stderr: '',
    })
  })
})

describe('the db:check command', () => {
  it('succeeds and says so when the schema and migrations agree', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await writeFile(join(dir, 'schema.ts'), projects)
    await generate()
    await expect(main(options)).resolves.toBe(0)
    expect(log).toHaveBeenCalledWith('The schema and the migrations agree.')
  })

  it('fails and names the missing migration when they differ', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await writeFile(join(dir, 'schema.ts'), projects)
    await expect(main(options)).resolves.toBe(1)
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/generating would add 0000_\w+\.sql, meta\/0000_snapshot\.json/),
    )
    expect(error).toHaveBeenCalledWith(expect.stringContaining('npm run db:generate -w backend'))
  })

  it('fails with the reason, and how to answer a rename, when drizzle-kit cannot generate', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await writeFile(join(dir, 'schema.ts'), "throw new Error('broken schema')\n")
    await expect(main(options)).resolves.toBe(1)
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/broken schema[^]*in a terminal/))
  })

  it("checks the backend's own schema by default", async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(main()).resolves.toBe(0)
  })
})
