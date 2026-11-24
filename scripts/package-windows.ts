// Builds the folder of the Windows portable zip (SC-120, DD-061) from the built backend and
// frontend (`npm run build` first): the folder the zip holds, laid out as the Docker image is, so the
// backend finds its frontend and its migrations where it always does.
//
//   node scripts/package-windows.ts --out <folder> [--node <node.exe>] [--winsw <WinSW.exe>]
//
// On Windows the Node.js runtime is the one running this script, with its LICENSE beside it, as
// in an official Node.js download or the runtime of actions/setup-node. Elsewhere, --node names a
// Windows node.exe. WinSW (SC-121) is downloaded at its pinned version and checked against its
// pinned checksum, unless --winsw names a copy, which is checked the same way.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const winsw = {
  url: 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe',
  sha256: 'b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f',
}

const repo = resolve(import.meta.dirname, '..')
const packaging = join(repo, 'packaging', 'windows')

const { values } = parseArgs({
  options: { out: { type: 'string' }, node: { type: 'string' }, winsw: { type: 'string' } },
})
if (values.out === undefined) fail('--out <folder> is required.')
const out = resolve(values.out)

const nodeExe = values.node ?? (process.platform === 'win32' ? process.execPath : undefined)
if (nodeExe === undefined) fail('--node <node.exe> is required when not run on Windows.')
const nodeLicense = join(dirname(nodeExe), 'LICENSE')
if (!existsSync(nodeLicense)) fail(`No LICENSE next to ${nodeExe}; the zip must carry Node.js's.`)

for (const built of ['backend/dist/server.js', 'frontend/dist/index.html']) {
  if (!existsSync(join(repo, built))) fail(`${built} is missing: run \`npm run build\` first.`)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// The application, as in the image.
for (const path of [
  'package.json',
  'backend/package.json',
  'backend/dist',
  'backend/drizzle',
  'frontend/dist',
  'LICENSE',
  'NOTICE',
  'README.md',
  // The user guide, which the README links to, so that its instructions are in the folder too.
  'docs/user-guide',
]) {
  cpSync(join(repo, path), join(out, path), { recursive: true })
}
cpSync(join(repo, 'backend/config.example.yaml'), join(out, 'config.example.yaml'))

// The backend's run-time dependencies, installed as the image installs them, then copied without
// npm's links to the workspace packages, which the backend does not import.
const staging = join(tmpdir(), `cold-seance-package-${process.pid}`)
rmSync(staging, { recursive: true, force: true })
for (const path of [
  'package.json',
  'package-lock.json',
  '.npmrc',
  'backend/package.json',
  'frontend/package.json',
]) {
  cpSync(join(repo, path), join(staging, path))
}
run('npm', ['ci', '--omit=dev', '--workspace', 'backend', '--no-audit', '--no-fund'], staging)
cpSync(join(staging, 'node_modules'), join(out, 'node_modules'), {
  recursive: true,
  filter: (source) => basename(source) !== '@cold-seance',
})
rmSync(staging, { recursive: true, force: true })

// Node.js's runtime, and WinSW as the service wrapper, each with its licence.
mkdirSync(join(out, 'licenses'))
cpSync(nodeExe, join(out, 'node.exe'))
cpSync(nodeLicense, join(out, 'licenses', 'Node.js.txt'))
const wrapper = values.winsw ?? (await download(winsw.url))
const digest = createHash('sha256').update(readFileSync(wrapper)).digest('hex')
if (digest !== winsw.sha256) fail(`${wrapper} has SHA-256 ${digest}, not WinSW's ${winsw.sha256}.`)
cpSync(wrapper, join(out, 'cold-seance-service.exe'))

// The project's own Windows files, with Windows line endings, which cmd.exe needs.
for (const [from, to] of [
  ['start.cmd', 'start.cmd'],
  ['cold-seance-service.xml', 'cold-seance-service.xml'],
  ['backup.ps1', 'backup.ps1'],
  ['README.txt', 'README.txt'],
  ['licenses/WinSW.txt', 'licenses/WinSW.txt'],
] as const) {
  const text = readFileSync(join(packaging, from), 'utf8')
  writeFileSync(join(out, to), text.replace(/\r?\n/g, '\r\n'))
}

console.log(`The Windows package is in ${out}`)

function run(command: string, args: string[], cwd: string): void {
  // npm is a .cmd file on Windows, which only a shell runs; the arguments here need no quoting.
  const result =
    process.platform === 'win32'
      ? spawnSync([command, ...args].join(' '), { cwd, stdio: 'inherit', shell: true })
      : spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed.`)
}

async function download(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) fail(`${url} answered ${response.status}.`)
  const path = join(tmpdir(), `cold-seance-${basename(url)}`)
  writeFileSync(path, Buffer.from(await response.arrayBuffer()))
  return path
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
