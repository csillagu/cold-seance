import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConfigFixture, type ConfigFixture } from '../../test/helpers/config.ts'
import {
  ConfigError,
  configFileEnv,
  envName,
  githubFunctions,
  loadConfig,
  settings,
  type GitHubFunction,
  type Setting,
} from './config.ts'

let fx: ConfigFixture

beforeEach(() => {
  fx = createConfigFixture()
})

afterEach(() => {
  fx.remove()
})

const dbUrl = 'postgres://tool:secret@db.example:5432/tool'

/** A file that sets every setting DD-059 names. */
function fullFile(): string {
  return `
server:
  host: 0.0.0.0
  port: 8080
database:
  url: ${dbUrl}
  directUrl: postgres://tool:secret@direct.example:5432/tool
github:
  recheckIntervalMinutes: 15
  webhookSecret: hook-repos
  apps:
    readIssues:
      appId: 11
      privateKeyFile: ${fx.keyFiles.readIssues}
      webhookSecret: hook-read
    writeIssues:
      appId: 12
      privateKeyFile: ${fx.keyFiles.writeIssues}
      webhookSecret: hook-write
    projectsStatus:
      appId: 13
      privateKeyFile: ${fx.keyFiles.projectsStatus}
      webhookSecret: hook-status
`
}

/** A file that gives every GitHub function its own personal access token, and nothing else. */
function tokenFile(): string {
  return `
database:
  url: ${dbUrl}
github:
  tokens:
    readIssues: ghp_read
    writeIssues: github_pat_write
    projectsStatus: ghp_status
`
}

const tokenEnv = (fn: GitHubFunction) => envName(['github', 'tokens', fn])

/** `fx.githubEnv` without the settings of `fn`'s App. */
function withoutApp(fn: GitHubFunction): Record<string, string> {
  const prefix = envName(['github', 'apps', fn])
  return Object.fromEntries(
    Object.entries(fx.githubEnv).filter(([key]) => !key.startsWith(`${prefix}_`)),
  )
}

function withFile(contents: string, extraEnv: Record<string, string> = {}) {
  const path = fx.write('config.yaml', contents)
  return { [configFileEnv]: path, ...extraEnv }
}

/** Runs `loadConfig` expecting it to refuse, and returns the error it throws. */
function refusal(env: Record<string, string | undefined>, cwd = fx.dir): ConfigError {
  let error: unknown
  try {
    loadConfig({ env, cwd })
  } catch (e) {
    error = e
  }
  if (!(error instanceof ConfigError)) {
    throw new Error(
      `loadConfig did not refuse the configuration with a ConfigError: ${String(error)}`,
    )
  }
  return error
}

const problemsOf = (env: Record<string, string | undefined>, cwd = fx.dir) =>
  refusal(env, cwd).problems

const name = (s: Setting) => s.path.join('.')

const labels: Record<GitHubFunction, string> = {
  readIssues: 'reading issues',
  writeIssues: 'writing to issues',
  projectsStatus: 'the Projects status field',
}

const neither = (fn: GitHubFunction) =>
  `the GitHub function for ${labels[fn]} is given neither a GitHub App (github.apps.${fn}) nor a personal access token (github.tokens.${fn}, ${tokenEnv(fn)}); give it one of them`

const both = (fn: GitHubFunction) =>
  `the GitHub function for ${labels[fn]} is given both a GitHub App (github.apps.${fn}) and a personal access token (github.tokens.${fn}, ${tokenEnv(fn)}); give it only one of them`

describe('envName', () => {
  it('derives the environment variable from the setting path', () => {
    expect(envName(['database', 'url'])).toBe('COLD_SEANCE_DATABASE_URL')
    expect(envName(['database', 'directUrl'])).toBe('COLD_SEANCE_DATABASE_DIRECT_URL')
    expect(envName(['github', 'apps', 'readIssues', 'privateKeyFile'])).toBe(
      'COLD_SEANCE_GITHUB_APPS_READ_ISSUES_PRIVATE_KEY_FILE',
    )
    expect(envName(['github', 'recheckIntervalMinutes'])).toBe(
      'COLD_SEANCE_GITHUB_RECHECK_INTERVAL_MINUTES',
    )
    expect(envName(['github', 'tokens', 'writeIssues'])).toBe(
      'COLD_SEANCE_GITHUB_TOKENS_WRITE_ISSUES',
    )
    expect(envName(['github', 'webhookSecret'])).toBe('COLD_SEANCE_GITHUB_WEBHOOK_SECRET')
  })
})

describe('settings', () => {
  it('names the listen address and every setting of DD-059: the database, each function’s App or token, the repository webhook secret, the re-check interval', () => {
    expect(settings.map(name)).toEqual([
      'server.host',
      'server.port',
      'database.url',
      'database.directUrl',
      ...githubFunctions.flatMap((fn) => [
        `github.apps.${fn}.appId`,
        `github.apps.${fn}.privateKeyFile`,
        `github.apps.${fn}.webhookSecret`,
      ]),
      ...githubFunctions.map((fn) => `github.tokens.${fn}`),
      'github.webhookSecret',
      'github.recheckIntervalMinutes',
    ])
  })
})

describe('loadConfig', () => {
  it('reads every setting from the YAML file and reads the key files', () => {
    const config = loadConfig({ env: withFile(fullFile()) })
    expect(config).toEqual({
      server: { host: '0.0.0.0', port: 8080 },
      database: { url: dbUrl, directUrl: 'postgres://tool:secret@direct.example:5432/tool' },
      github: {
        recheckIntervalMinutes: 15,
        webhookSecret: 'hook-repos',
        tokens: {},
        apps: {
          readIssues: {
            appId: 11,
            privateKeyFile: fx.keyFiles.readIssues,
            privateKey: 'key-readIssues',
            webhookSecret: 'hook-read',
          },
          writeIssues: {
            appId: 12,
            privateKeyFile: fx.keyFiles.writeIssues,
            privateKey: 'key-writeIssues',
            webhookSecret: 'hook-write',
          },
          projectsStatus: {
            appId: 13,
            privateKeyFile: fx.keyFiles.projectsStatus,
            privateKey: 'key-projectsStatus',
            webhookSecret: 'hook-status',
          },
        },
      },
    })
  })

  it('reads every setting from environment variables alone, with no file', () => {
    const env = {
      COLD_SEANCE_SERVER_HOST: '::',
      COLD_SEANCE_SERVER_PORT: '8443',
      COLD_SEANCE_DATABASE_URL: dbUrl,
      COLD_SEANCE_DATABASE_DIRECT_URL: 'postgresql://direct.example/tool',
      COLD_SEANCE_GITHUB_RECHECK_INTERVAL_MINUTES: '30',
      ...fx.githubEnv,
      COLD_SEANCE_GITHUB_APPS_READ_ISSUES_WEBHOOK_SECRET: 'r',
      COLD_SEANCE_GITHUB_APPS_WRITE_ISSUES_WEBHOOK_SECRET: 'w',
      COLD_SEANCE_GITHUB_APPS_PROJECTS_STATUS_WEBHOOK_SECRET: 'p',
      COLD_SEANCE_GITHUB_WEBHOOK_SECRET: 'repos',
    }
    // fx.dir has no config.yaml, so the default file is absent.
    const config = loadConfig({ env, cwd: fx.dir })
    expect(config.server).toEqual({ host: '::', port: 8443 })
    expect(config.database).toEqual({ url: dbUrl, directUrl: 'postgresql://direct.example/tool' })
    expect(config.github.recheckIntervalMinutes).toBe(30)
    expect(config.github.webhookSecret).toBe('repos')
    expect(config.github.tokens).toEqual({})
    expect(config.github.apps.readIssues).toEqual({
      appId: 1,
      privateKeyFile: fx.keyFiles.readIssues,
      privateKey: 'key-readIssues',
      webhookSecret: 'r',
    })
    expect(config.github.apps.writeIssues?.appId).toBe(2)
    expect(config.github.apps.writeIssues?.webhookSecret).toBe('w')
    expect(config.github.apps.projectsStatus?.appId).toBe(3)
    expect(config.github.apps.projectsStatus?.privateKey).toBe('key-projectsStatus')
    expect(config.github.apps.projectsStatus?.webhookSecret).toBe('p')
  })

  it('reads a personal access token for each function from the file, and no App', () => {
    const config = loadConfig({ env: withFile(tokenFile()) })
    expect(config.github.tokens).toEqual({
      readIssues: 'ghp_read',
      writeIssues: 'github_pat_write',
      projectsStatus: 'ghp_status',
    })
    expect(config.github.apps).toEqual({})
  })

  it('reads a personal access token from the environment alone, with no file', () => {
    const env = {
      COLD_SEANCE_DATABASE_URL: dbUrl,
      ...withoutApp('writeIssues'),
      [tokenEnv('writeIssues')]: 'ghp_fromEnv',
    }
    const config = loadConfig({ env, cwd: fx.dir })
    expect(config.github.tokens).toEqual({ writeIssues: 'ghp_fromEnv' })
    expect(Object.keys(config.github.apps)).toEqual(['readIssues', 'projectsStatus'])
  })

  it('accepts Apps and tokens mixed across functions, and one token for several, given with a YAML anchor', () => {
    const file = `
database: { url: ${dbUrl} }
github:
  apps:
    projectsStatus: { appId: 5, privateKeyFile: ${fx.keyFiles.projectsStatus} }
  tokens:
    readIssues: &token ghp_shared
    writeIssues: *token
`
    const config = loadConfig({ env: withFile(file) })
    expect(config.github.tokens).toEqual({ readIssues: 'ghp_shared', writeIssues: 'ghp_shared' })
    expect(config.github.apps).toEqual({
      projectsStatus: {
        appId: 5,
        privateKeyFile: fx.keyFiles.projectsStatus,
        privateKey: 'key-projectsStatus',
        webhookSecret: undefined,
      },
    })
  })

  it('does not read the key file of a function given a token instead of an App', () => {
    // A key file that cannot be read stops the start only for a function given an App.
    const env = {
      COLD_SEANCE_DATABASE_URL: dbUrl,
      ...withoutApp('readIssues'),
      [tokenEnv('readIssues')]: 'ghp_x',
    }
    expect(loadConfig({ env, cwd: fx.dir }).github.tokens).toEqual({ readIssues: 'ghp_x' })
  })

  describe('the environment variable wins over the file', () => {
    const otherKey = () => fx.write('other.pem', 'other-key')
    const overrides: Record<
      string,
      () => {
        env: string
        check: (c: ReturnType<typeof loadConfig>) => unknown
        /** The file the variable overrides, if not `fullFile()`. */
        file?: string
      }
    > = {
      'server.host': () => ({ env: '::1', check: (c) => c.server.host }),
      'server.port': () => ({ env: '4000', check: (c) => c.server.port }),
      'database.url': () => ({ env: 'postgres://env.example/db', check: (c) => c.database.url }),
      'database.directUrl': () => ({
        env: 'postgres://env-direct.example/db',
        check: (c) => c.database.directUrl,
      }),
      'github.recheckIntervalMinutes': () => ({
        env: '5',
        check: (c) => c.github.recheckIntervalMinutes,
      }),
      'github.webhookSecret': () => ({ env: 'env-repos', check: (c) => c.github.webhookSecret }),
      ...Object.fromEntries(
        githubFunctions.map((fn) => [
          `github.tokens.${fn}`,
          () => ({
            env: 'ghp_env',
            check: (c: ReturnType<typeof loadConfig>) => c.github.tokens[fn],
            file: tokenFile(),
          }),
        ]),
      ),
      ...Object.fromEntries(
        githubFunctions.flatMap((fn) => [
          [
            `github.apps.${fn}.appId`,
            () => ({
              env: '99',
              check: (c: ReturnType<typeof loadConfig>) => c.github.apps[fn]?.appId,
            }),
          ],
          [
            `github.apps.${fn}.privateKeyFile`,
            () => ({
              env: otherKey(),
              check: (c: ReturnType<typeof loadConfig>) => c.github.apps[fn]?.privateKey,
            }),
          ],
          [
            `github.apps.${fn}.webhookSecret`,
            () => ({
              env: 'env-secret',
              check: (c: ReturnType<typeof loadConfig>) => c.github.apps[fn]?.webhookSecret,
            }),
          ],
        ]),
      ),
    }

    it('covers every setting', () => {
      expect(Object.keys(overrides).sort()).toEqual(settings.map(name).sort())
    })

    for (const setting of settings) {
      it(`for ${name(setting)}`, () => {
        const override = overrides[name(setting)]!()
        const config = loadConfig({
          env: withFile(override.file ?? fullFile(), { [envName(setting.path)]: override.env }),
        })
        const expected =
          setting.kind === 'positiveInteger' || setting.kind === 'port'
            ? Number(override.env)
            : setting.kind === 'keyFile'
              ? 'other-key'
              : override.env
        expect(override.check(config)).toBe(expected)
      })
    }
  })

  it('takes the file value when the environment variable is set but empty', () => {
    const config = loadConfig({ env: withFile(fullFile(), { COLD_SEANCE_DATABASE_URL: '' }) })
    expect(config.database.url).toBe(dbUrl)
  })

  it('applies the defaults: localhost:3000, direct URL is the URL, one-hour re-check, no webhook secrets', () => {
    const config = loadConfig({
      env: { COLD_SEANCE_DATABASE_URL: dbUrl, ...fx.githubEnv },
      cwd: fx.dir,
    })
    expect(config.server).toEqual({ host: '127.0.0.1', port: 3000 })
    expect(config.database.directUrl).toBe(dbUrl)
    expect(config.github.recheckIntervalMinutes).toBe(60)
    for (const fn of githubFunctions) expect(config.github.apps[fn]?.webhookSecret).toBeUndefined()
    expect(config.github.webhookSecret).toBeUndefined()
  })

  it('accepts one App for all functions, given with a YAML anchor', () => {
    const file = `
database: { url: ${dbUrl} }
github:
  apps:
    readIssues: &app { appId: 7, privateKeyFile: ${fx.keyFiles.readIssues} }
    writeIssues: *app
    projectsStatus: *app
`
    const config = loadConfig({ env: withFile(file) })
    for (const fn of githubFunctions) {
      expect(config.github.apps[fn]).toMatchObject({ appId: 7, privateKey: 'key-readIssues' })
      expect(config.github.tokens).toEqual({})
    }
  })

  it('reads config.yaml from the working directory when no file is named', () => {
    fx.write('config.yaml', fullFile())
    expect(loadConfig({ env: {}, cwd: fx.dir }).github.recheckIntervalMinutes).toBe(15)
  })

  it('resolves a relative file name against the working directory', () => {
    mkdirSync(join(fx.dir, 'etc'))
    fx.write('etc/tool.yaml', fullFile())
    expect(
      loadConfig({ env: { [configFileEnv]: 'etc/tool.yaml' }, cwd: fx.dir }).database.url,
    ).toBe(dbUrl)
  })

  it('treats an empty file as setting nothing', () => {
    const config = loadConfig({
      env: withFile('', { COLD_SEANCE_DATABASE_URL: dbUrl, ...fx.githubEnv }),
    })
    expect(config.database.url).toBe(dbUrl)
  })

  it('treats an empty or null value in the file as not set', () => {
    const problems = problemsOf(withFile(`database:\n  url: ""\n  directUrl: ~\n`, fx.githubEnv))
    expect(problems).toEqual(['database.url (COLD_SEANCE_DATABASE_URL) is required but not set'])
  })

  describe('refuses to start, naming the setting', () => {
    for (const setting of settings.filter((s) => s.required)) {
      it(`when ${name(setting)} is missing`, () => {
        const env: Record<string, string> = { COLD_SEANCE_DATABASE_URL: dbUrl, ...fx.githubEnv }
        delete env[envName(setting.path)]
        expect(problemsOf(env)).toEqual([
          `${name(setting)} (${envName(setting.path)}) is required but not set`,
        ])
      })
    }

    it('with a message that lists every missing setting, and every function given neither an App nor a token', () => {
      const error = refusal({})
      expect(error.problems).toEqual([
        'database.url (COLD_SEANCE_DATABASE_URL) is required but not set',
        ...githubFunctions.map((fn) => neither(fn)),
      ])
      for (const problem of error.problems) expect(error.message).toContain(`- ${problem}`)
      expect(error.name).toBe('ConfigError')
    })

    it('when an App is given only its webhook secret, naming its id and key file as missing', () => {
      const env = {
        COLD_SEANCE_DATABASE_URL: dbUrl,
        ...withoutApp('projectsStatus'),
        COLD_SEANCE_GITHUB_APPS_PROJECTS_STATUS_WEBHOOK_SECRET: 's',
      }
      expect(problemsOf(env)).toEqual([
        'github.apps.projectsStatus.appId (COLD_SEANCE_GITHUB_APPS_PROJECTS_STATUS_APP_ID) is required but not set',
        'github.apps.projectsStatus.privateKeyFile (COLD_SEANCE_GITHUB_APPS_PROJECTS_STATUS_PRIVATE_KEY_FILE) is required but not set',
      ])
    })

    it('when a function is given both an App and a token, naming the function and not the App’s other settings', () => {
      // The App is given by its id alone: its missing key file is not reported, since the
      // function is to be given one of the two, not both.
      const env = {
        COLD_SEANCE_DATABASE_URL: dbUrl,
        ...withoutApp('readIssues'),
        COLD_SEANCE_GITHUB_APPS_READ_ISSUES_APP_ID: '1',
        [tokenEnv('readIssues')]: 'ghp_x',
      }
      expect(problemsOf(env)).toEqual([both('readIssues')])
    })

    it('when every function is given both, each by name, with the file giving the Apps and the environment the tokens', () => {
      const env = withFile(fullFile(), {
        [tokenEnv('readIssues')]: 'ghp_a',
        [tokenEnv('writeIssues')]: 'ghp_b',
        [tokenEnv('projectsStatus')]: 'ghp_c',
      })
      expect(problemsOf(env)).toEqual(githubFunctions.map((fn) => both(fn)))
    })

    it('when a token in the file is not a string, without echoing it', () => {
      const env = withFile(`github: { tokens: { writeIssues: 1234567 } }`, {
        COLD_SEANCE_DATABASE_URL: dbUrl,
        ...withoutApp('writeIssues'),
      })
      const problems = problemsOf(env)
      expect(problems).toEqual([
        'github.tokens.writeIssues (COLD_SEANCE_GITHUB_TOKENS_WRITE_ISSUES) must be a string; quote it in the configuration file',
      ])
      expect(problems.join()).not.toContain('1234567')
    })

    for (const [what, bad] of [
      ['a space', 'ghp_hunter2 x'],
      ['a line break', 'ghp_hunter2\n'],
      ['a character outside ASCII', 'ghp_hunter2é'],
    ] as const) {
      it(`when a token holds ${what}, without echoing it`, () => {
        const env = {
          COLD_SEANCE_DATABASE_URL: dbUrl,
          ...withoutApp('readIssues'),
          [tokenEnv('readIssues')]: bad,
        }
        const problems = problemsOf(env)
        expect(problems).toEqual([
          'github.tokens.readIssues (COLD_SEANCE_GITHUB_TOKENS_READ_ISSUES) must be the token alone: printable ASCII characters, with no spaces or line breaks',
        ])
        expect(problems.join()).not.toContain('hunter2')
      })
    }

    it('when the tokens section is not a mapping', () => {
      const env = withFile(`github: { tokens: ghp_x }`, {
        COLD_SEANCE_DATABASE_URL: dbUrl,
        ...fx.githubEnv,
      })
      expect(problemsOf(env)).toEqual(['github.tokens in the configuration file must be a mapping'])
    })

    it('when the repository webhook secret in the file is not a string', () => {
      const env = withFile(`github: { webhookSecret: 42 }`, {
        COLD_SEANCE_DATABASE_URL: dbUrl,
        ...fx.githubEnv,
      })
      expect(problemsOf(env)).toEqual([
        'github.webhookSecret (COLD_SEANCE_GITHUB_WEBHOOK_SECRET) must be a string; quote it in the configuration file',
      ])
    })

    it('when a key file does not exist', () => {
      const env: Record<string, string> = { COLD_SEANCE_DATABASE_URL: dbUrl, ...fx.githubEnv }
      env.COLD_SEANCE_GITHUB_APPS_WRITE_ISSUES_PRIVATE_KEY_FILE = join(fx.dir, 'missing.pem')
      expect(problemsOf(env)).toEqual([
        `github.apps.writeIssues.privateKeyFile (COLD_SEANCE_GITHUB_APPS_WRITE_ISSUES_PRIVATE_KEY_FILE): the key file ${join(fx.dir, 'missing.pem')} cannot be read: ENOENT`,
      ])
    })

    it('when a key file is a directory', () => {
      const env: Record<string, string> = { COLD_SEANCE_DATABASE_URL: dbUrl, ...fx.githubEnv }
      env.COLD_SEANCE_GITHUB_APPS_READ_ISSUES_PRIVATE_KEY_FILE = fx.dir
      expect(problemsOf(env)).toEqual([
        `github.apps.readIssues.privateKeyFile (COLD_SEANCE_GITHUB_APPS_READ_ISSUES_PRIVATE_KEY_FILE): the key file ${fx.dir} cannot be read: EISDIR`,
      ])
    })

    it('when the key file path in the file is not a string', () => {
      const problems = problemsOf(
        withFile(`github: { apps: { readIssues: { privateKeyFile: [a] } } }`, {
          COLD_SEANCE_DATABASE_URL: dbUrl,
          ...fx.githubEnv,
          COLD_SEANCE_GITHUB_APPS_READ_ISSUES_PRIVATE_KEY_FILE: '',
        }),
      )
      expect(problems).toEqual([
        'github.apps.readIssues.privateKeyFile (COLD_SEANCE_GITHUB_APPS_READ_ISSUES_PRIVATE_KEY_FILE) must be the path of a key file',
      ])
    })

    for (const bad of ['0', '-1', 'abc', '1.5', '99999999999999999999']) {
      it(`when an App id is ${bad}`, () => {
        const env = {
          COLD_SEANCE_DATABASE_URL: dbUrl,
          ...fx.githubEnv,
          COLD_SEANCE_GITHUB_APPS_READ_ISSUES_APP_ID: bad,
        }
        expect(problemsOf(env)).toEqual([
          'github.apps.readIssues.appId (COLD_SEANCE_GITHUB_APPS_READ_ISSUES_APP_ID) must be a whole number greater than 0',
        ])
      })
    }

    it('when the re-check interval in the file is not a whole number', () => {
      const problems = problemsOf(
        withFile(`github: { recheckIntervalMinutes: 0.5 }`, {
          COLD_SEANCE_DATABASE_URL: dbUrl,
          ...fx.githubEnv,
        }),
      )
      expect(problems).toEqual([
        'github.recheckIntervalMinutes (COLD_SEANCE_GITHUB_RECHECK_INTERVAL_MINUTES) must be a whole number greater than 0',
      ])
    })

    for (const bad of ['0', '65536', '-1', 'http', '80.5']) {
      it(`when the port is ${bad}`, () => {
        const env = { COLD_SEANCE_DATABASE_URL: dbUrl, ...fx.githubEnv }
        expect(problemsOf({ ...env, COLD_SEANCE_SERVER_PORT: bad })).toEqual([
          'server.port (COLD_SEANCE_SERVER_PORT) must be a port number from 1 to 65535',
        ])
      })
    }

    it('when the port in the file is not a whole number', () => {
      const env = withFile(`server: { port: 80.5 }`, {
        COLD_SEANCE_DATABASE_URL: dbUrl,
        ...fx.githubEnv,
      })
      expect(problemsOf(env)).toEqual([
        'server.port (COLD_SEANCE_SERVER_PORT) must be a port number from 1 to 65535',
      ])
    })

    it('accepts the lowest and highest port, and a quoted port in the file', () => {
      const env = { COLD_SEANCE_DATABASE_URL: dbUrl, ...fx.githubEnv }
      expect(
        loadConfig({ env: { ...env, COLD_SEANCE_SERVER_PORT: '1' }, cwd: fx.dir }).server.port,
      ).toBe(1)
      expect(
        loadConfig({ env: { ...env, COLD_SEANCE_SERVER_PORT: '65535' }, cwd: fx.dir }).server.port,
      ).toBe(65535)
      expect(loadConfig({ env: withFile(`server: { port: "8080" }`, env) }).server.port).toBe(8080)
    })

    it('when the host holds a space', () => {
      const env = { COLD_SEANCE_DATABASE_URL: dbUrl, ...fx.githubEnv }
      expect(problemsOf({ ...env, COLD_SEANCE_SERVER_HOST: '0.0.0.0 ' })).toEqual([
        'server.host (COLD_SEANCE_SERVER_HOST) must be a host name or an IP address',
      ])
    })

    it('when the host in the file is not a string', () => {
      const env = withFile(`server: { host: [a, b] }`, {
        COLD_SEANCE_DATABASE_URL: dbUrl,
        ...fx.githubEnv,
      })
      expect(problemsOf(env)).toEqual([
        'server.host (COLD_SEANCE_SERVER_HOST) must be a host name or an IP address',
      ])
    })

    it('accepts a quoted App id in the file', () => {
      const config = loadConfig({
        env: withFile(`github: { apps: { readIssues: { appId: "42" } } }`, {
          COLD_SEANCE_DATABASE_URL: dbUrl,
          ...fx.githubEnv,
          COLD_SEANCE_GITHUB_APPS_READ_ISSUES_APP_ID: '',
        }),
      })
      expect(config.github.apps.readIssues?.appId).toBe(42)
    })

    it('when the database address is not a PostgreSQL URL, without echoing it', () => {
      for (const bad of ['mysql://u:hunter2@h/db', 'not a url hunter2']) {
        const problems = problemsOf({ ...fx.githubEnv, COLD_SEANCE_DATABASE_URL: bad })
        expect(problems).toEqual([
          'database.url (COLD_SEANCE_DATABASE_URL) must be a PostgreSQL connection URL (postgres://…)',
        ])
        expect(problems.join()).not.toContain('hunter2')
      }
    })

    it('when the database address in the file is not a string', () => {
      const problems = problemsOf(withFile(`database: { url: 5432 }`, fx.githubEnv))
      expect(problems).toEqual([
        'database.url (COLD_SEANCE_DATABASE_URL) must be a PostgreSQL connection URL (postgres://…)',
      ])
    })

    it('when a webhook secret in the file is not a string', () => {
      const problems = problemsOf(
        withFile(`github: { apps: { projectsStatus: { webhookSecret: 12345 } } }`, {
          COLD_SEANCE_DATABASE_URL: dbUrl,
          ...fx.githubEnv,
        }),
      )
      expect(problems).toEqual([
        'github.apps.projectsStatus.webhookSecret (COLD_SEANCE_GITHUB_APPS_PROJECTS_STATUS_WEBHOOK_SECRET) must be a string; quote it in the configuration file',
      ])
    })

    it('when the named configuration file does not exist', () => {
      const path = join(fx.dir, 'nope.yaml')
      expect(
        problemsOf({ [configFileEnv]: path, COLD_SEANCE_DATABASE_URL: dbUrl, ...fx.githubEnv }),
      ).toEqual([`the configuration file ${path} (COLD_SEANCE_CONFIG_FILE) cannot be read: ENOENT`])
    })

    it('when the default configuration file exists but cannot be read', () => {
      mkdirSync(join(fx.dir, 'config.yaml'))
      expect(problemsOf({ COLD_SEANCE_DATABASE_URL: dbUrl, ...fx.githubEnv })).toEqual([
        `the configuration file ${join(fx.dir, 'config.yaml')} (the default file) cannot be read: EISDIR`,
      ])
    })

    it('when the file is not valid YAML, alone, giving the position without echoing the line', () => {
      // Nothing is set by the environment: the file-level problem is reported without a
      // "required but not set" line for each setting the broken file may have held.
      const problems = problemsOf(withFile('database:\n  url: [postgres://u:hunter2@h/db\n'))
      expect(problems).toHaveLength(1)
      expect(problems[0]).toMatch(
        /^the configuration file .*config\.yaml is not valid YAML at line \d+, column \d+$/,
      )
      expect(problems.join()).not.toContain('hunter2')
    })

    it('when the named file cannot be read, alone', () => {
      const path = join(fx.dir, 'nope.yaml')
      expect(problemsOf({ [configFileEnv]: path })).toEqual([
        `the configuration file ${path} (COLD_SEANCE_CONFIG_FILE) cannot be read: ENOENT`,
      ])
    })

    it('when the file does not hold a mapping', () => {
      const problems = problemsOf(withFile('- a\n- b\n'))
      expect(problems).toEqual([
        `the configuration file ${join(fx.dir, 'config.yaml')} must hold a mapping of settings`,
      ])
    })

    it('when a section is not a mapping, once, even if the environment sets the settings under it', () => {
      const problems = problemsOf(
        withFile('github: yes\n', { COLD_SEANCE_DATABASE_URL: dbUrl, ...fx.githubEnv }),
      )
      expect(problems).toEqual(['github in the configuration file must be a mapping'])
    })

    it('when the file holds a setting the tool does not know, at any level', () => {
      const file = `
databse: { url: ${dbUrl} }
database: { url: ${dbUrl}, pasword: x }
github:
  recheckInterval: 5
  apps:
    readIssues: { appId: 1, privateKeyFile: ${fx.keyFiles.readIssues}, webhookSecrt: s }
    reviewIssues: { appId: 2 }
  tokens:
    readIssue: ghp_x
`
      expect(problemsOf(withFile(file, fx.githubEnv))).toEqual([
        'databse in the configuration file is not a setting the tool knows',
        'database.pasword in the configuration file is not a setting the tool knows',
        'github.recheckInterval in the configuration file is not a setting the tool knows',
        'github.apps.readIssues.webhookSecrt in the configuration file is not a setting the tool knows',
        'github.apps.reviewIssues in the configuration file is not a setting the tool knows',
        'github.tokens.readIssue in the configuration file is not a setting the tool knows',
      ])
    })

    it('when a COLD_SEANCE_ environment variable is not a setting the tool knows', () => {
      const env = {
        COLD_SEANCE_DATABASE_URL: dbUrl,
        ...fx.githubEnv,
        COLD_SEANCE_DATABSE_URL: dbUrl,
        COLD_SEANCE_: 'x',
        UNRELATED_VARIABLE: 'kept out of it',
      }
      expect(problemsOf(env)).toEqual([
        'the environment variable COLD_SEANCE_DATABSE_URL is not a setting the tool knows',
        'the environment variable COLD_SEANCE_ is not a setting the tool knows',
      ])
    })

    it('with every problem at once', () => {
      const problems = problemsOf({
        ...fx.githubEnv,
        COLD_SEANCE_GITHUB_APPS_READ_ISSUES_APP_ID: 'x',
        COLD_SEANCE_GITHUB_APPS_PROJECTS_STATUS_PRIVATE_KEY_FILE: join(fx.dir, 'gone.pem'),
      })
      expect(problems).toHaveLength(3)
      expect(problems[0]).toContain('database.url')
      expect(problems[1]).toContain('github.apps.readIssues.appId')
      expect(problems[2]).toContain('github.apps.projectsStatus.privateKeyFile')
    })
  })

  it('resolves a relative key file path against the working directory', () => {
    const env: Record<string, string> = { COLD_SEANCE_DATABASE_URL: dbUrl, ...fx.githubEnv }
    env['COLD_SEANCE_GITHUB_APPS_READ_ISSUES_PRIVATE_KEY_FILE'] = 'readIssues.pem'
    const app = loadConfig({ env, cwd: fx.dir }).github.apps.readIssues
    expect(app).toMatchObject({ privateKeyFile: 'readIssues.pem', privateKey: 'key-readIssues' })
  })

  it('uses process.env and process.cwd() by default', () => {
    const ours = Object.keys(process.env).filter((key) => key.startsWith('COLD_SEANCE_'))
    const saved = Object.fromEntries(ours.map((key) => [key, process.env[key]]))
    const set = { COLD_SEANCE_DATABASE_URL: dbUrl, ...fx.githubEnv }
    const cwd = process.cwd()
    try {
      for (const key of ours) delete process.env[key]
      Object.assign(process.env, set)
      process.chdir(fx.dir)
      expect(loadConfig().database.url).toBe(dbUrl)
    } finally {
      process.chdir(cwd)
      for (const key of Object.keys(set)) delete process.env[key]
      Object.assign(process.env, saved)
    }
  })
})
