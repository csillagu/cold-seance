import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { listen, startBackend, type Backend } from '../../src/start.ts'
import { createConfigFixture, type ConfigFixture } from '../helpers/config.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'

// The backend's start as the Docker image runs it (SC-028): it listens on the address in its
// settings, serves the built frontend beside the REST API, and closes cleanly when stopped.

const serverEntry = fileURLToPath(new URL('../../src/server.ts', import.meta.url))
const indexHtml = '<!doctype html><title>cold-seance</title>'

let x: TestDatabase
let fx: ConfigFixture
let frontendDir: string
let backend: Backend | undefined
let child: ChildProcess | undefined

beforeAll(async () => {
  x = await createTestDatabase()
  fx = createConfigFixture()
  frontendDir = join(fx.dir, 'dist')
  mkdirSync(frontendDir)
  writeFileSync(join(frontendDir, 'index.html'), indexHtml)
})

afterEach(async () => {
  await backend?.app.close()
  backend = undefined
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

describe('listen', () => {
  it('listens on the host and port in the settings and serves the frontend and the API there', async () => {
    const port = await freePort()
    backend = await startBackend({
      env: {
        COLD_SEANCE_DATABASE_URL: x.url,
        COLD_SEANCE_SERVER_HOST: '127.0.0.1',
        COLD_SEANCE_SERVER_PORT: String(port),
        ...fx.githubEnv,
      },
      cwd: fx.dir,
      frontendDir,
    })
    expect(await listen(backend)).toBe(`http://127.0.0.1:${port}`)

    const page = await fetch(`http://127.0.0.1:${port}/projects/1`)
    expect(page.status).toBe(200)
    expect(await page.text()).toBe(indexHtml)
    expect((await fetch(`http://127.0.0.1:${port}/api/openapi.json`)).status).toBe(401)
  })

  it('serves only the API, saying so, when there is no built frontend', async () => {
    const empty = join(fx.dir, 'empty')
    mkdirSync(empty, { recursive: true })
    const lines: string[] = []
    backend = await startBackend({
      env: { COLD_SEANCE_DATABASE_URL: x.url, ...fx.githubEnv },
      cwd: fx.dir,
      frontendDir: empty,
      server: { logger: { level: 'warn', stream: { write: (line: string) => lines.push(line) } } },
    })
    expect(lines.join()).toContain(`No built frontend in ${empty}; only the API is served`)
    expect((await backend.app.inject({ method: 'GET', url: '/' })).statusCode).toBe(404)
    expect((await backend.app.inject({ method: 'GET', url: '/api/openapi.json' })).statusCode).toBe(
      401,
    )
  })
})

/** Starts the server process with the test settings and `settings`, collecting its output. */
function startServer(settings: Record<string, string>) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('COLD_SEANCE_')),
  )
  const started = spawn(process.execPath, [serverEntry], {
    cwd: fx.dir,
    env: { ...env, ...fx.githubEnv, COLD_SEANCE_DATABASE_URL: x.url, ...settings },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child = started
  const out = { text: '' }
  started.stdout.on('data', (chunk: Buffer) => (out.text += chunk.toString()))
  started.stderr.on('data', (chunk: Buffer) => (out.text += chunk.toString()))
  const exited = new Promise<number | null>((resolve) => started.on('exit', resolve))
  return { process: started, out, exited }
}

describe('the server process', () => {
  it('refuses to start, saying why in one line, when it cannot listen on the configured port', async () => {
    const taken = createServer()
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve))
    try {
      const address = taken.address()
      if (address === null || typeof address === 'string') throw new Error('no port')
      const server = startServer({ COLD_SEANCE_SERVER_PORT: String(address.port) })
      expect(await server.exited).toBe(1)
      expect(server.out.text).toContain(
        `The backend cannot listen on 127.0.0.1:${address.port}, so the tool does not start: EADDRINUSE`,
      )
      expect(server.out.text).not.toContain('    at ')
    } finally {
      await new Promise((resolve) => taken.close(resolve))
    }
  })

  it('stops at once on SIGTERM while it is still starting', async () => {
    // A database address that never answers keeps the migration step waiting.
    const silent = createServer()
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
    try {
      const address = silent.address()
      if (address === null || typeof address === 'string') throw new Error('no port')
      const server = startServer({
        COLD_SEANCE_DATABASE_URL: `postgres://u:p@127.0.0.1:${address.port}/db`,
      })
      // Wait until the process is up, holding a connection to the silent "database".
      await expect
        .poll(() => new Promise((resolve) => silent.getConnections((_, n) => resolve(n))), {
          timeout: 20_000,
        })
        .toBe(1)
      server.process.kill('SIGTERM')
      expect(await server.exited).toBe(1)
      expect(server.out.text).toContain('SIGTERM received while starting; the tool does not start')
    } finally {
      silent.close()
    }
  })

  it('listens on the configured port and exits cleanly, with code 0, on SIGTERM', async () => {
    const port = await freePort()
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('COLD_SEANCE_')),
    )
    child = spawn(process.execPath, [serverEntry], {
      cwd: fx.dir,
      env: {
        ...env,
        ...fx.githubEnv,
        COLD_SEANCE_DATABASE_URL: x.url,
        COLD_SEANCE_SERVER_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))
    const exited = new Promise<number | null>((resolve) => child?.on('exit', resolve))

    // The default host is 127.0.0.1.
    await expect
      .poll(() => output, { timeout: 20_000 })
      .toContain(`Server listening at http://127.0.0.1:${port}`)
    expect((await fetch(`http://127.0.0.1:${port}/api/openapi.json`)).status).toBe(401)

    child.kill('SIGTERM')
    expect(await exited).toBe(0)
    expect(output).toContain('SIGTERM received; closing')
  })
})
