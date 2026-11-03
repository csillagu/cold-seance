import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createConfigFixture, type ConfigFixture } from '../helpers/config.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'

// FR-187 (SC-109, DD-060): the tool does not start when its configuration gives a GitHub function
// neither a GitHub App nor a personal access token, or both, and names the function. The tool is
// started as the server process, with a configuration file, against a reachable empty database.

const serverEntry = fileURLToPath(new URL('../../src/server.ts', import.meta.url))

let x: TestDatabase
let fx: ConfigFixture
let child: ChildProcess | undefined

beforeAll(async () => {
  // A reachable empty PostgreSQL database: no migration applied.
  x = await createTestDatabase({ migrate: false })
  fx = createConfigFixture()
})

afterEach(() => {
  child?.kill('SIGKILL')
  child = undefined
})

afterAll(async () => {
  fx?.remove()
  await x?.drop()
})

/** A port nothing listens on at the moment. */
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  if (address === null || typeof address === 'string') throw new Error('no port')
  return address.port
}

/** The test GitHub App `tc-app`, as the configuration file gives it to one function. */
const tcApp = () => `{ appId: 260, privateKeyFile: ${fx.keyFiles.readIssues} }`

/** A personal access token of the GitHub account `tc-bot`. */
const tcBotToken = 'ghp_tcBotToken0123456789'

/** Writes the configuration file: the database (`x` unless given), the port, and `github`. */
function configFile(port: number, github: string, databaseUrl = x.url): string {
  return fx.write(
    `config-${port}.yaml`,
    `server:\n  port: ${port}\ndatabase:\n  url: ${databaseUrl}\ngithub:\n${github}`,
  )
}

/** Starts the tool with the configuration file at `path` alone, collecting its output. */
function startTool(path: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('COLD_SEANCE_')),
  )
  const started = spawn(process.execPath, [serverEntry], {
    cwd: fx.dir,
    env: { ...env, COLD_SEANCE_CONFIG_FILE: path },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child = started
  const out = { text: '' }
  started.stdout.on('data', (chunk: Buffer) => (out.text += chunk.toString()))
  started.stderr.on('data', (chunk: Buffer) => (out.text += chunk.toString()))
  const exited = new Promise<number | null>((resolve) => started.on('exit', resolve))
  return { out, exited }
}

/** Whether anything answers HTTP on the port: the REST API's description, say. */
async function answers(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/api/openapi.json`, { signal: AbortSignal.timeout(2000) })
    return true
  } catch {
    return false
  }
}

describe('TC-262: a function given neither an App nor a token stops the start', () => {
  it('TC-262: stops, naming writing to issues as given neither an App nor a token, and the REST API does not answer', async () => {
    const port = await freePort()
    const path = configFile(
      port,
      `  apps:\n    readIssues: ${tcApp()}\n    projectsStatus: ${tcApp()}\n`,
    )

    const tool = startTool(path)

    expect(await tool.exited).toBe(1)
    expect(tool.out.text).toContain(
      'the GitHub function for writing to issues is given neither a GitHub App (github.apps.writeIssues) nor a personal access token',
    )
    // Only writing to issues is named.
    expect(tool.out.text).not.toContain('reading issues is given')
    expect(tool.out.text).not.toContain('Projects status field is given')
    expect(await answers(port)).toBe(false)
  })
})

describe('TC-263: a function given both an App and a token stops the start', () => {
  it('TC-263: stops, naming writing to issues as given both an App and a token, and the REST API does not answer', async () => {
    const port = await freePort()
    const path = configFile(
      port,
      `  apps:\n    readIssues: ${tcApp()}\n    writeIssues: ${tcApp()}\n    projectsStatus: ${tcApp()}\n` +
        `  tokens:\n    writeIssues: ${tcBotToken}\n`,
    )

    const tool = startTool(path)

    expect(await tool.exited).toBe(1)
    expect(tool.out.text).toContain(
      'the GitHub function for writing to issues is given both a GitHub App (github.apps.writeIssues) and a personal access token',
    )
    expect(tool.out.text).not.toContain('reading issues is given')
    expect(tool.out.text).not.toContain('Projects status field is given')
    // The token is not echoed.
    expect(tool.out.text).not.toContain(tcBotToken)
    expect(await answers(port)).toBe(false)
  })
})

describe('a configuration that gives each function one of an App and a token', () => {
  it('starts the tool, with Apps and a token mixed across functions, and the REST API answers', async () => {
    // The same inputs as TC-262, with writing to issues given tc-bot's token: the check above
    // would see a tool that started. Its own database, since the start migrates it.
    const own = await createTestDatabase({ migrate: false })
    try {
      const port = await freePort()
      const path = configFile(
        port,
        `  apps:\n    readIssues: ${tcApp()}\n    projectsStatus: ${tcApp()}\n` +
          `  tokens:\n    writeIssues: ${tcBotToken}\n`,
        own.url,
      )

      const tool = startTool(path)

      await expect
        .poll(() => tool.out.text, { timeout: 20_000 })
        .toContain(`Server listening at http://127.0.0.1:${port}`)
      expect(await answers(port)).toBe(true)
      expect(tool.out.text).not.toContain(tcBotToken)
    } finally {
      child?.kill('SIGKILL')
      child = undefined
      await own.drop()
    }
  })
})
