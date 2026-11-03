// Prints the unit-test coverage of each package as a Markdown table, from the json-summary
// reports that `npm run test:coverage` writes. CI appends it to the job summary.
import { readFileSync } from 'node:fs'

const packages = ['backend', 'frontend']
const metrics = ['lines', 'statements', 'functions', 'branches']

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

function cell(file: string, totals: unknown, metric: string): string {
  const entry = field(totals, metric)
  const [pct, covered, total] = ['pct', 'covered', 'total'].map((key) => field(entry, key))
  if (typeof pct !== 'number' || typeof covered !== 'number' || typeof total !== 'number') {
    throw new Error(`${file} has no totals for ${metric}.`)
  }
  return `${pct}% (${covered}/${total})`
}

const rows = packages.map((name) => {
  const file = `${name}/coverage/coverage-summary.json`
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const totals = field(parsed, 'total')
  return `| ${name} | ${metrics.map((metric) => cell(file, totals, metric)).join(' | ')} |`
})

console.log(
  [
    '### Unit test coverage',
    '',
    `| Package | ${metrics.map((m) => m.charAt(0).toUpperCase() + m.slice(1)).join(' | ')} |`,
    `|---|${metrics.map(() => '---').join('|')}|`,
    ...rows,
  ].join('\n'),
)
