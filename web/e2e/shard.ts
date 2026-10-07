// Splits the flows into shards of about the same length (docs/TESTING.md, "How many shards").
//
// Playwright's own `--shard` cuts the run by test count in file order, so a shard that drew the
// long files (a11y, shelf) ran twice as long as one that did not. Here every test weighs what it
// took in CI (e2e/durations.json), and the heaviest go first to the shard with the least so far.
// A file in serial mode (`describe.configure({ mode: 'serial' })`) stays whole, as Playwright
// would keep it. A test not in the file yet weighs the median.
//
//   tsx e2e/shard.ts list 2/4 [playwright filters, e.g. --grep-invert @full] > shard.txt
//   playwright test --test-list shard.txt
//
//   tsx e2e/shard.ts record <run id>…   # e2e/durations.json from CI runs' job logs (needs gh)
//
// The list is computed from the same filters the run gets, so a PR's core suite and the full
// suite are each balanced on their own.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const DURATIONS = new URL('./durations.json', import.meta.url)
const web = new URL('..', import.meta.url)

type Listed = { key: string; file: string }

/** Every test the filters select, as `file › describe › title` (the form --test-list reads). */
function listTests(filters: string[]): Listed[] {
  const json = execFileSync('./node_modules/.bin/playwright', ['test', '--list', '--reporter=json', ...filters], {
    cwd: web,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  type Suite = { title: string; specs?: { title: string; file: string }[]; suites?: Suite[] }
  const tests: Listed[] = []
  const walk = (suite: Suite, path: string[]) => {
    for (const spec of suite.specs ?? []) tests.push({ key: [spec.file, ...path, spec.title].join(' › '), file: spec.file })
    for (const child of suite.suites ?? []) walk(child, [...path, child.title])
  }
  // The top suites are the files; their titles are the file names.
  for (const file of (JSON.parse(json) as { suites: Suite[] }).suites) walk(file, [])
  return tests
}

const serialFiles = new Set<string>()
const isSerial = (file: string) => {
  if (!serialFiles.has(`checked:${file}`)) {
    serialFiles.add(`checked:${file}`)
    if (/describe\.configure\(\{\s*mode:\s*'serial'/.test(readFileSync(new URL(file, new URL('./', import.meta.url)), 'utf8'))) serialFiles.add(file)
  }
  return serialFiles.has(file)
}

function list(shardArg: string, filters: string[]) {
  const [current, total] = shardArg.split('/').map(Number) as [number, number]
  if (!(current >= 1 && current <= total)) throw new Error(`Not a shard: ${shardArg} (want i/N)`)
  const durations = JSON.parse(readFileSync(DURATIONS, 'utf8')) as Record<string, number>
  const known = Object.values(durations).sort((a, b) => a - b)
  const median = known[Math.floor(known.length / 2)] ?? 5

  // Units: a test, or a whole file in serial mode.
  const units = new Map<string, { keys: string[]; weight: number }>()
  for (const test of listTests(filters)) {
    const id = isSerial(test.file) ? test.file : test.key
    const unit = units.get(id) ?? { keys: [], weight: 0 }
    unit.keys.push(test.key)
    unit.weight += durations[test.key] ?? median
    units.set(id, unit)
  }
  const shards = Array.from({ length: total }, () => ({ keys: [] as string[], weight: 0 }))
  // Heaviest first, each to the lightest shard; ties by name, so every shard computes the same split.
  for (const [, unit] of [...units].sort(([a, x], [b, y]) => y.weight - x.weight || a.localeCompare(b))) {
    const lightest = shards.reduce((min, shard) => (shard.weight < min.weight ? shard : min))
    lightest.keys.push(...unit.keys)
    lightest.weight += unit.weight
  }
  const mine = shards[current - 1]!
  console.error(`shard ${current}/${total}: ${mine.keys.length} tests, ~${Math.round(mine.weight)} test-s (shards: ${shards.map((s) => Math.round(s.weight)).join(', ')})`)
  console.log(mine.keys.join('\n'))
}

/** e2e/durations.json from the job logs of CI runs: each passed test's time, first attempt, the median over the runs. */
function record(runs: string[]) {
  const seen = new Map<string, number[]>()
  // "✓  12 e2e/home.spec.ts:37:1 › describe › title (2.3s)", or with a project "[name] › ".
  const line = /^\S+Z\s+✓\s+\d+\s+(?:\[[^\]]*\] › )?e2e\/([^:]+):\d+:\d+ › (.*) \((\d+(?:\.\d+)?)(ms|s|m)\)\s*$/
  for (const run of runs) {
    const jobs = JSON.parse(execFileSync('gh', ['api', `repos/fabkho/libellus/actions/runs/${run}/jobs?per_page=100`], { encoding: 'utf8' })) as {
      jobs: { id: number; name: string }[]
    }
    for (const job of jobs.jobs.filter((j) => j.name.startsWith('user flows (shard'))) {
      const log = execFileSync('gh', ['api', '--allow-escape-sequences', `repos/fabkho/libellus/actions/jobs/${job.id}/logs`], {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
      })
      for (const raw of log.split('\n')) {
        // eslint-disable-next-line no-control-regex
        const match = raw.replace(/\x1b\[[0-9;]*m/g, '').trimEnd().match(line)
        if (!match || /\(retry #\d+\)$/.test(match[2]!)) continue
        const [, file, title, value, unit] = match
        const seconds = Number(value) * (unit === 'ms' ? 0.001 : unit === 'm' ? 60 : 1)
        // The list reporter puts a test's tags after its title.
        const key = `${file} › ${title!.replace(/( @[\w-]+)+$/, '')}`
        seen.set(key, [...(seen.get(key) ?? []), seconds])
      }
    }
  }
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]!
  const durations = Object.fromEntries([...seen].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => [key, Math.round(median(values) * 10) / 10]))
  writeFileSync(DURATIONS, `${JSON.stringify(durations, null, 2)}\n`)
  console.error(`${Object.keys(durations).length} tests from ${runs.length} run(s), ${Math.round(Object.values(durations).reduce((a, b) => a + b, 0))} test-s in all`)
}

const [command, ...rest] = process.argv.slice(2)
if (command === 'list' && rest[0]) list(rest[0], rest.slice(1))
else if (command === 'record' && rest.length) record(rest)
else {
  console.error('usage: tsx e2e/shard.ts list <i/N> [playwright filters…] | record <run id>…')
  process.exit(2)
}
