import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { resolve } from 'node:path'
import { parse as parseYaml, YAMLError } from 'yaml'

/**
 * The configuration loader (SC-109, DD-059): reads the YAML configuration file, applies the
 * environment variables that override it, reads the GitHub Apps' key files, and returns the
 * settings for the rest of the backend. A required setting that is missing, a value that is not
 * valid, or a key file that cannot be read stops the start with a message naming the setting; a
 * GitHub function given both an App and a personal access token, or neither, stops it with a
 * message naming the function (DD-060, FR-187).
 */

/**
 * The tool's functions on GitHub, each of which is given its own App or personal access token, or
 * shares one with the others (DD-058, DD-060, SRC-207, SRC-229).
 */
export const githubFunctions = ['readIssues', 'writeIssues', 'projectsStatus'] as const
export type GitHubFunction = (typeof githubFunctions)[number]

/** How each function reads in a message. */
export const githubFunctionLabels: Record<GitHubFunction, string> = {
  readIssues: 'reading issues',
  writeIssues: 'writing to issues',
  projectsStatus: 'the Projects status field',
}

export interface GitHubAppConfig {
  appId: number
  /** The path of the App's private key file, as configured. */
  privateKeyFile: string
  /** The contents of the private key file, read at start. */
  privateKey: string
  /** Set only if the App sends webhooks (DD-058). */
  webhookSecret: string | undefined
}

/** The GitHub Projects status field the tool reads start and hold from (SRC-252). */
export interface StatusFieldConfig {
  /** The field's name, `Status` unless set. */
  name: string
  /** The option that means started, `In Progress` unless set. */
  started: string
  /** The option that means on hold, `On Hold` unless set. */
  onHold: string
}

export const defaultStatusField: StatusFieldConfig = {
  name: 'Status',
  started: 'In Progress',
  onHold: 'On Hold',
}

export interface Config {
  server: {
    /** The address the backend listens on: `127.0.0.1` unless set; the image sets `0.0.0.0`. */
    host: string
    /** The port the backend listens on, 3000 unless set. */
    port: number
    /**
     * The reverse proxies in front of the tool, as IP addresses or CIDR ranges (SC-132): a request
     * from one of them is counted against the client address its `X-Forwarded-For` names. Empty
     * unless set, and then the header is ignored (SRC-298).
     */
    trustedProxies: readonly string[]
  }
  database: {
    /** The address of the PostgreSQL database the tool uses (FR-177). */
    url: string
    /** A direct connection to the same database, for migrations (DD-057); `url` if not set. */
    directUrl: string
  }
  github: {
    /**
     * The App of each function given an App. Every function is in exactly one of `apps` and
     * `tokens` (DD-060): a function given both, or neither, stops the start.
     */
    apps: Partial<Record<GitHubFunction, GitHubAppConfig>>
    /** The personal access token of each function given one, as configured (DD-060). */
    tokens: Partial<Record<GitHubFunction, string>>
    /** The one secret of the webhooks set up on repositories and organizations, if they are used (DD-060). */
    webhookSecret: string | undefined
    /** The interval of the re-check of linked issues, one hour unless set (SRC-213). */
    recheckIntervalMinutes: number
    /**
     * The GitHub Projects status field start and hold come from (DD-015, SRC-252): its name, and
     * the names of its options for started and on hold.
     */
    statusField: StatusFieldConfig
  }
  /**
   * The first system admin, created at start while there is no system admin yet (FR-165, SC-053),
   * and ignored once one exists. Given by environment variables, or in the file.
   */
  firstAdmin: { username: string; password: string } | undefined
}

type Kind =
  | 'databaseUrl'
  | 'secret'
  | 'token'
  | 'positiveInteger'
  | 'keyFile'
  | 'host'
  | 'port'
  | 'name'
  | 'proxies'

/** One setting: where it sits in the YAML file, the environment variable that overrides it. */
export interface Setting {
  path: readonly string[]
  kind: Kind
  /** Whether the setting must be set; for a setting of a function's App, only when the function is given an App alone. */
  required: boolean
  /** The GitHub function whose App or token the setting gives. */
  of?: { fn: GitHubFunction; via: 'app' | 'token' }
}

export const envPrefix = 'COLD_SEANCE_'

/** The environment variable that names the configuration file. */
export const configFileEnv = `${envPrefix}CONFIG_FILE`

/** The configuration file read when `COLD_SEANCE_CONFIG_FILE` is not set, if it exists. */
export const defaultConfigFile = 'config.yaml'

export const defaultRecheckIntervalMinutes = 60

/** The listen address when none is set: this machine only, outside the Docker image. */
export const defaultServerHost = '127.0.0.1'
export const defaultServerPort = 3000

/** Every setting named in DD-059, the listen address and the first system admin (FR-165) included. */
export const settings: readonly Setting[] = [
  { path: ['server', 'host'], kind: 'host', required: false },
  { path: ['server', 'port'], kind: 'port', required: false },
  { path: ['server', 'trustedProxies'], kind: 'proxies', required: false },
  { path: ['database', 'url'], kind: 'databaseUrl', required: true },
  { path: ['database', 'directUrl'], kind: 'databaseUrl', required: false },
  ...githubFunctions.flatMap((fn): Setting[] => {
    const of = { fn, via: 'app' } as const
    return [
      { path: ['github', 'apps', fn, 'appId'], kind: 'positiveInteger', required: true, of },
      { path: ['github', 'apps', fn, 'privateKeyFile'], kind: 'keyFile', required: true, of },
      { path: ['github', 'apps', fn, 'webhookSecret'], kind: 'secret', required: false, of },
    ]
  }),
  ...githubFunctions.map((fn): Setting => ({
    path: ['github', 'tokens', fn],
    kind: 'token',
    required: false,
    of: { fn, via: 'token' },
  })),
  { path: ['github', 'webhookSecret'], kind: 'secret', required: false },
  { path: ['github', 'recheckIntervalMinutes'], kind: 'positiveInteger', required: false },
  { path: ['github', 'statusField', 'name'], kind: 'name', required: false },
  { path: ['github', 'statusField', 'started'], kind: 'name', required: false },
  { path: ['github', 'statusField', 'onHold'], kind: 'name', required: false },
  { path: ['firstAdmin', 'username'], kind: 'secret', required: false },
  { path: ['firstAdmin', 'password'], kind: 'secret', required: false },
]

/** `['github', 'apps', 'readIssues', 'appId']` → `COLD_SEANCE_GITHUB_APPS_READ_ISSUES_APP_ID`. */
export function envName(path: readonly string[]): string {
  return (
    envPrefix +
    path
      .map((part) => part.replace(/([a-z0-9])([A-Z])/g, '$1_$2'))
      .join('_')
      .toUpperCase()
  )
}

function settingName(setting: Setting): string {
  return `${setting.path.join('.')} (${envName(setting.path)})`
}

/** The start was refused: `problems` lists each setting that is missing or not valid. */
export class ConfigError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(
      `The configuration is not valid, so the tool does not start:\n${problems.map((p) => `- ${p}`).join('\n')}`,
    )
    this.name = 'ConfigError'
    this.problems = problems
  }
}

export interface LoadConfigOptions {
  /** Defaults to `process.env`. */
  env?: Record<string, string | undefined>
  /** The directory relative configuration and key file paths are resolved against; defaults to `process.cwd()`. */
  cwd?: string
}

type Raw = { source: 'file' | 'env'; value: unknown }

interface KeyFile {
  path: string
  contents: string
}

/** The converted values, by setting path, one map per kind of value. */
interface Values {
  numbers: Map<string, number>
  strings: Map<string, string>
  lists: Map<string, string[]>
  keyFiles: Map<string, KeyFile>
}

export function loadConfig(options: LoadConfigOptions = {}): Config {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const problems: string[] = []

  const file = readConfigFile(env, cwd, problems)
  // A file that cannot be used is reported alone: every setting it may hold would otherwise be
  // reported as not set as well.
  if (problems.length > 0) throw new ConfigError(problems)

  // A misspelt setting would otherwise be ignored without a word (a risk DD-059 names), so
  // anything the tool does not know stops the start.
  reportUnknownFileKeys(file, [], problems)
  reportUnknownEnv(env, problems)

  const raws = new Map(settings.map((s) => [s, rawValue(s, file, env, problems)]))
  // What each GitHub function is given: an App if any of its App's settings is set.
  const given = (fn: GitHubFunction, via: 'app' | 'token') =>
    settings.some((s) => s.of?.fn === fn && s.of.via === via && raws.get(s) !== undefined)
  const access = new Map(
    githubFunctions.map((fn) => [fn, { app: given(fn, 'app'), token: given(fn, 'token') }]),
  )

  const values: Values = {
    numbers: new Map(),
    strings: new Map(),
    lists: new Map(),
    keyFiles: new Map(),
  }
  for (const setting of settings) {
    // A function given both an App and a token, or neither, is reported below instead of its
    // settings: they are neither required nor read, its App's key file included.
    const of = setting.of && access.get(setting.of.fn)!
    if (of !== undefined && of.app === of.token) continue
    const raw = raws.get(setting)
    if (raw === undefined) {
      // A setting of a function's App is required only when the function is given an App (alone,
      // since a function given both was skipped above).
      const required = setting.required && (of === undefined || of.app)
      if (required) problems.push(`${settingName(setting)} is required but not set`)
      continue
    }
    convert(setting, raw, values, cwd, problems)
  }

  for (const [fn, { app, token }] of access) {
    if (app === token) problems.push(githubFunctionProblem(fn, app))
  }
  // The first system admin needs both a username and a password to be created and to sign in.
  const firstAdmin = (part: string) =>
    settings.find((s) => s.path.join('.') === `firstAdmin.${part}`)!
  if (
    (raws.get(firstAdmin('username')) === undefined) !==
    (raws.get(firstAdmin('password')) === undefined)
  ) {
    problems.push(
      `${settingName(firstAdmin('username'))} and ${settingName(firstAdmin('password'))} are given together or not at all`,
    )
  }

  if (problems.length > 0) throw new ConfigError(problems)

  // Every required setting is in its map now: a missing one was reported above.
  const key = (...path: string[]) => path.join('.')
  const url = values.strings.get(key('database', 'url'))!
  // Each function is given exactly one of an App and a token now: anything else was reported above.
  const apps: Partial<Record<GitHubFunction, GitHubAppConfig>> = {}
  const tokens: Partial<Record<GitHubFunction, string>> = {}
  for (const fn of githubFunctions) {
    const token = values.strings.get(key('github', 'tokens', fn))
    if (token !== undefined) {
      tokens[fn] = token
      continue
    }
    const keyFile = values.keyFiles.get(key('github', 'apps', fn, 'privateKeyFile'))!
    apps[fn] = {
      appId: values.numbers.get(key('github', 'apps', fn, 'appId'))!,
      privateKeyFile: keyFile.path,
      privateKey: keyFile.contents,
      webhookSecret: values.strings.get(key('github', 'apps', fn, 'webhookSecret')),
    }
  }
  return {
    server: {
      host: values.strings.get(key('server', 'host')) ?? defaultServerHost,
      port: values.numbers.get(key('server', 'port')) ?? defaultServerPort,
      trustedProxies: values.lists.get(key('server', 'trustedProxies')) ?? [],
    },
    database: { url, directUrl: values.strings.get(key('database', 'directUrl')) ?? url },
    github: {
      apps,
      tokens,
      webhookSecret: values.strings.get(key('github', 'webhookSecret')),
      recheckIntervalMinutes:
        values.numbers.get(key('github', 'recheckIntervalMinutes')) ??
        defaultRecheckIntervalMinutes,
      statusField: {
        name: values.strings.get(key('github', 'statusField', 'name')) ?? defaultStatusField.name,
        started:
          values.strings.get(key('github', 'statusField', 'started')) ?? defaultStatusField.started,
        onHold:
          values.strings.get(key('github', 'statusField', 'onHold')) ?? defaultStatusField.onHold,
      },
    },
    firstAdmin: firstAdminOf(values.strings),
  }
}

/** The first system admin's username and password, if both are given. */
function firstAdminOf(strings: Map<string, string>): Config['firstAdmin'] {
  const username = strings.get('firstAdmin.username')
  const password = strings.get('firstAdmin.password')
  return username !== undefined && password !== undefined ? { username, password } : undefined
}

/** A GitHub function given both an App and a token (`both`), or neither, named with its settings. */
function githubFunctionProblem(fn: GitHubFunction, both: boolean): string {
  const app = `a GitHub App (github.apps.${fn}, ${envName(['github', 'apps', fn])}_*)`
  const tokenPath = ['github', 'tokens', fn]
  const token = `a personal access token (${tokenPath.join('.')}, ${envName(tokenPath)})`
  const what = both ? `both ${app} and ${token}` : `neither ${app} nor ${token}`
  return `the GitHub function for ${githubFunctionLabels[fn]} is given ${what}; give it ${both ? 'only ' : ''}one of them`
}

/** Reads and parses the configuration file. A missing default file is not an error: env alone may configure the tool. */
function readConfigFile(
  env: Record<string, string | undefined>,
  cwd: string,
  problems: string[],
): unknown {
  const named = nonEmpty(env[configFileEnv])
  const path = resolve(cwd, named ?? defaultConfigFile)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if (named === undefined && errorCode(error) === 'ENOENT') return undefined
    const source = named === undefined ? 'the default file' : configFileEnv
    problems.push(`the configuration file ${path} (${source}) cannot be read: ${errorCode(error)}`)
    return undefined
  }
  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch (error) {
    // Only the position is reported: the library's message quotes the offending line, which may
    // hold a secret.
    const at = error instanceof YAMLError ? error.linePos?.[0] : undefined
    const where = at ? ` at line ${at.line}, column ${at.col}` : ''
    problems.push(`the configuration file ${path} is not valid YAML${where}`)
    return undefined
  }
  if (parsed === null || parsed === undefined) return undefined
  if (!isMapping(parsed)) {
    problems.push(`the configuration file ${path} must hold a mapping of settings`)
    return undefined
  }
  return parsed
}

const settingPaths = new Set(settings.map((s) => s.path.join('.')))
const sectionPaths = new Set(
  settings.flatMap((s) => s.path.slice(0, -1).map((_, i) => s.path.slice(0, i + 1).join('.'))),
)
const settingEnvNames = new Set([configFileEnv, ...settings.map((s) => envName(s.path))])

/** What a setting's name may look like; any other key is reported without being quoted. */
const keyPattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

/** The section whose keys sit beside secrets as values: a token pasted as a key is a name there too. */
const tokensSection = 'github.tokens'

function reportUnknownFileKeys(node: unknown, prefix: readonly string[], problems: string[]): void {
  if (!isMapping(node)) return
  for (const [key, child] of Object.entries(node)) {
    const path = [...prefix, key].join('.')
    if (sectionPaths.has(path)) reportUnknownFileKeys(child, [...prefix, key], problems)
    else if (!settingPaths.has(path)) problems.push(unknownKeyProblem(prefix, key))
  }
}

/**
 * An unknown key is named unless it may be a secret written as a key, such as `writeIssues:ghp_…`
 * without a space after the colon, or a bare token under `github.tokens`.
 */
function unknownKeyProblem(prefix: readonly string[], key: string): string {
  const section = prefix.join('.')
  if (section === tokensSection) {
    return `a key under ${tokensSection} in the configuration file is not one of ${githubFunctions.join(', ')}; it is not shown, since it may be a token`
  }
  if (keyPattern.test(key)) {
    return `${[...prefix, key].join('.')} in the configuration file is not a setting the tool knows`
  }
  const where = prefix.length === 0 ? 'at the top level' : `under ${section}`
  return `a key ${where} in the configuration file is not a setting the tool knows; it is not shown, since it may hold a secret`
}

function reportUnknownEnv(env: Record<string, string | undefined>, problems: string[]): void {
  for (const key of Object.keys(env)) {
    if (key.startsWith(envPrefix) && !settingEnvNames.has(key)) {
      problems.push(`the environment variable ${key} is not a setting the tool knows`)
    }
  }
}

/** The value of a setting, from its environment variable if set, else from the file. */
function rawValue(
  setting: Setting,
  file: unknown,
  env: Record<string, string | undefined>,
  problems: string[],
): Raw | undefined {
  const fromEnv = nonEmpty(env[envName(setting.path)])
  // The file is walked even when the environment variable is set, so a malformed file is reported.
  const fromFile = fileValue(setting.path, file, problems)
  if (fromEnv !== undefined) return { source: 'env', value: fromEnv }
  if (fromFile === undefined || fromFile === null || fromFile === '') return undefined
  return { source: 'file', value: fromFile }
}

function fileValue(path: readonly string[], file: unknown, problems: string[]): unknown {
  let node: unknown = file
  for (const [i, part] of path.entries()) {
    if (node === undefined || node === null) return undefined
    if (!isMapping(node)) {
      // Report a section that is not a mapping once, not once per setting under it.
      const message = `${path.slice(0, i).join('.')} in the configuration file must be a mapping`
      if (!problems.includes(message)) problems.push(message)
      return undefined
    }
    node = node[part]
  }
  return node
}

function convert(
  setting: Setting,
  raw: Raw,
  values: Values,
  cwd: string,
  problems: string[],
): void {
  const name = settingName(setting)
  const path = setting.path.join('.')
  const { value } = raw
  switch (setting.kind) {
    case 'positiveInteger': {
      const n = wholeNumber(value)
      if (Number.isSafeInteger(n) && n > 0) values.numbers.set(path, n)
      else problems.push(`${name} must be a whole number greater than 0`)
      return
    }
    case 'port': {
      const n = wholeNumber(value)
      if (Number.isSafeInteger(n) && n > 0 && n <= 65_535) values.numbers.set(path, n)
      else problems.push(`${name} must be a port number from 1 to 65535`)
      return
    }
    case 'host':
      if (typeof value === 'string' && /^\S+$/.test(value)) {
        values.strings.set(path, value)
      } else problems.push(`${name} must be a host name or an IP address`)
      return
    case 'proxies': {
      // A list in the file, or one string of addresses separated by commas, as an environment
      // variable can only give it.
      const items = typeof value === 'string' ? value.split(',') : value
      const proxies = Array.isArray(items)
        ? items.map((item: unknown) => (typeof item === 'string' ? item.trim() : ''))
        : []
      if (proxies.length > 0 && proxies.every(isAddressOrRange)) values.lists.set(path, proxies)
      else {
        problems.push(
          `${name} must be IP addresses or CIDR ranges, as a list or separated by commas`,
        )
      }
      return
    }
    case 'databaseUrl':
      // The value is never echoed: a database address usually carries a password.
      if (typeof value === 'string' && isPostgresUrl(value)) values.strings.set(path, value)
      else problems.push(`${name} must be a PostgreSQL connection URL (postgres://…)`)
      return
    case 'name':
      if (typeof value === 'string' && value.trim() !== '') values.strings.set(path, value.trim())
      else problems.push(`${name} must be a name that is not blank`)
      return
    case 'secret':
      if (typeof value === 'string') values.strings.set(path, value)
      else problems.push(`${name} must be a string; quote it in the configuration file`)
      return
    case 'token':
      // Neither message echoes the value. A token is used as given, whatever its kind (DD-060);
      // only a value no GitHub token can be is refused, such as one carrying a line break.
      if (typeof value !== 'string') {
        problems.push(`${name} must be a string; quote it in the configuration file`)
      } else if (!/^[\x21-\x7e]+$/.test(value)) {
        problems.push(
          `${name} must be the token alone: printable ASCII characters, with no spaces or line breaks`,
        )
      } else values.strings.set(path, value)
      return
    case 'keyFile':
      if (typeof value !== 'string') {
        problems.push(`${name} must be the path of a key file`)
        return
      }
      try {
        values.keyFiles.set(path, {
          path: value,
          contents: readFileSync(resolve(cwd, value), 'utf8'),
        })
      } catch (error) {
        problems.push(`${name}: the key file ${value} cannot be read: ${errorCode(error)}`)
      }
  }
}

/** An IP address, such as `127.0.0.1` or `::1`, or a CIDR range, such as `10.0.0.0/8`. */
function isAddressOrRange(value: string): boolean {
  const [address = '', bits, ...rest] = value.split('/')
  const family = isIP(address)
  if (family === 0 || rest.length > 0) return false
  if (bits === undefined) return true
  return /^\d{1,3}$/.test(bits) && Number(bits) <= (family === 4 ? 32 : 128)
}

/** A number, or a string of digits, as a number; anything else as NaN. */
function wholeNumber(value: unknown): number {
  if (typeof value === 'number') return value
  return typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : NaN
}

function isPostgresUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'postgres:' || protocol === 'postgresql:'
  } catch {
    return false
  }
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : String(error)
}
