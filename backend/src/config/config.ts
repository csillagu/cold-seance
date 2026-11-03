import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml, YAMLError } from 'yaml'

/**
 * The configuration loader (SC-109, DD-059): reads the YAML configuration file, applies the
 * environment variables that override it, reads the GitHub Apps' key files, and returns the
 * settings for the rest of the backend. A required setting that is missing, a value that is not
 * valid, or a key file that cannot be read stops the start with a message naming the setting.
 */

/** The tool's functions on GitHub, each of which may have its own App (DD-058, SRC-207). */
export const githubFunctions = ['readIssues', 'writeIssues', 'projectsStatus'] as const
export type GitHubFunction = (typeof githubFunctions)[number]

export interface GitHubAppConfig {
  appId: number
  /** The path of the App's private key file, as configured. */
  privateKeyFile: string
  /** The contents of the private key file, read at start. */
  privateKey: string
  /** Set only if the App sends webhooks (DD-058). */
  webhookSecret: string | undefined
}

export interface Config {
  database: {
    /** The address of the PostgreSQL database the tool uses (FR-177). */
    url: string
    /** A direct connection to the same database, for migrations (DD-057); `url` if not set. */
    directUrl: string
  }
  github: {
    apps: Record<GitHubFunction, GitHubAppConfig>
    /** The interval of the re-check of linked issues, one hour unless set (SRC-213). */
    recheckIntervalMinutes: number
  }
}

type Kind = 'databaseUrl' | 'secret' | 'positiveInteger' | 'keyFile'

/** One setting: where it sits in the YAML file, the environment variable that overrides it. */
export interface Setting {
  path: readonly string[]
  kind: Kind
  required: boolean
}

export const envPrefix = 'COLD_SEANCE_'

/** The environment variable that names the configuration file. */
export const configFileEnv = `${envPrefix}CONFIG_FILE`

/** The configuration file read when `COLD_SEANCE_CONFIG_FILE` is not set, if it exists. */
export const defaultConfigFile = 'config.yaml'

export const defaultRecheckIntervalMinutes = 60

/** Every setting named in DD-059. */
export const settings: readonly Setting[] = [
  { path: ['database', 'url'], kind: 'databaseUrl', required: true },
  { path: ['database', 'directUrl'], kind: 'databaseUrl', required: false },
  ...githubFunctions.flatMap((fn): Setting[] => [
    { path: ['github', 'apps', fn, 'appId'], kind: 'positiveInteger', required: true },
    { path: ['github', 'apps', fn, 'privateKeyFile'], kind: 'keyFile', required: true },
    { path: ['github', 'apps', fn, 'webhookSecret'], kind: 'secret', required: false },
  ]),
  { path: ['github', 'recheckIntervalMinutes'], kind: 'positiveInteger', required: false },
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

  const values: Values = { numbers: new Map(), strings: new Map(), keyFiles: new Map() }
  for (const setting of settings) {
    const raw = rawValue(setting, file, env, problems)
    if (raw === undefined) {
      if (setting.required) problems.push(`${settingName(setting)} is required but not set`)
      continue
    }
    convert(setting, raw, values, cwd, problems)
  }

  if (problems.length > 0) throw new ConfigError(problems)

  // Every required setting is in its map now: a missing one was reported above.
  const key = (...path: string[]) => path.join('.')
  const url = values.strings.get(key('database', 'url'))!
  const app = (fn: GitHubFunction): GitHubAppConfig => {
    const keyFile = values.keyFiles.get(key('github', 'apps', fn, 'privateKeyFile'))!
    return {
      appId: values.numbers.get(key('github', 'apps', fn, 'appId'))!,
      privateKeyFile: keyFile.path,
      privateKey: keyFile.contents,
      webhookSecret: values.strings.get(key('github', 'apps', fn, 'webhookSecret')),
    }
  }
  return {
    database: { url, directUrl: values.strings.get(key('database', 'directUrl')) ?? url },
    github: {
      apps: {
        readIssues: app('readIssues'),
        writeIssues: app('writeIssues'),
        projectsStatus: app('projectsStatus'),
      },
      recheckIntervalMinutes:
        values.numbers.get(key('github', 'recheckIntervalMinutes')) ??
        defaultRecheckIntervalMinutes,
    },
  }
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

function reportUnknownFileKeys(node: unknown, prefix: readonly string[], problems: string[]): void {
  if (!isMapping(node)) return
  for (const [key, child] of Object.entries(node)) {
    const path = [...prefix, key].join('.')
    if (sectionPaths.has(path)) reportUnknownFileKeys(child, [...prefix, key], problems)
    else if (!settingPaths.has(path)) {
      problems.push(`${path} in the configuration file is not a setting the tool knows`)
    }
  }
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
      const n =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && /^\s*\d+\s*$/.test(value)
            ? Number(value)
            : NaN
      if (Number.isSafeInteger(n) && n > 0) values.numbers.set(path, n)
      else problems.push(`${name} must be a whole number greater than 0`)
      return
    }
    case 'databaseUrl':
      // The value is never echoed: a database address usually carries a password.
      if (typeof value === 'string' && isPostgresUrl(value)) values.strings.set(path, value)
      else problems.push(`${name} must be a PostgreSQL connection URL (postgres://…)`)
      return
    case 'secret':
      if (typeof value === 'string') values.strings.set(path, value)
      else problems.push(`${name} must be a string; quote it in the configuration file`)
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
