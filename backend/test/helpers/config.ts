import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GitHubFunction } from '../../src/config/config.ts'

/** A temporary directory holding a configuration file and the GitHub Apps' key files. */
export interface ConfigFixture {
  dir: string
  /** Writes `name` in the directory and returns its path. */
  write(name: string, contents: string): string
  /** A key file per function, with contents `key-<function>`. */
  keyFiles: Record<GitHubFunction, string>
  /** Environment variables that configure every required GitHub setting. */
  githubEnv: Record<string, string>
  remove(): void
}

export function createConfigFixture(): ConfigFixture {
  const dir = mkdtempSync(join(tmpdir(), 'cold-seance-config-'))
  const write = (name: string, contents: string) => {
    const path = join(dir, name)
    writeFileSync(path, contents)
    return path
  }
  const keyFiles = {
    readIssues: write('readIssues.pem', 'key-readIssues'),
    writeIssues: write('writeIssues.pem', 'key-writeIssues'),
    projectsStatus: write('projectsStatus.pem', 'key-projectsStatus'),
  }
  const githubEnv = {
    COLD_SEANCE_GITHUB_APPS_READ_ISSUES_APP_ID: '1',
    COLD_SEANCE_GITHUB_APPS_READ_ISSUES_PRIVATE_KEY_FILE: keyFiles.readIssues,
    COLD_SEANCE_GITHUB_APPS_WRITE_ISSUES_APP_ID: '2',
    COLD_SEANCE_GITHUB_APPS_WRITE_ISSUES_PRIVATE_KEY_FILE: keyFiles.writeIssues,
    COLD_SEANCE_GITHUB_APPS_PROJECTS_STATUS_APP_ID: '3',
    COLD_SEANCE_GITHUB_APPS_PROJECTS_STATUS_PRIVATE_KEY_FILE: keyFiles.projectsStatus,
  }
  return {
    dir,
    write,
    keyFiles,
    githubEnv,
    remove: () => rmSync(dir, { recursive: true, force: true }),
  }
}
