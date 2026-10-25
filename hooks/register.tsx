import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Row, Summary, Tokens } from '../types'

const PANE = 'token-counter'
const REFRESH_MS = 60_000
const summary = atom({ plugin: 'token-counter', key: 'summary' } as const, null)

const sum = (t: Tokens) => t[0] + t[1] + t[2] + t[3]

const fmt = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B`
  : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
  : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K`
  : String(n)

const bar = (value: number, max: number, width = 16) =>
  '█'.repeat(max > 0 ? Math.max(value > 0 ? 1 : 0, Math.round((value / max) * width)) : 0)

const LEVELS = ['#8b949e33', '#9be9a8', '#40c463', '#30a14e', '#216e39']
const WEEKS = 53
const DAY_MS = 86_400_000

type Cell = { key: string; total: number; level: number }

// weeks of 7 days (Sunday first), the last column ending today; future days null
function contributionGrid(calendar: Record<string, number>, todayKey: string) {
  const today = Date.parse(`${todayKey}T00:00:00Z`)
  const lastSunday = today - new Date(today).getUTCDay() * DAY_MS
  const start = lastSunday - (WEEKS - 1) * 7 * DAY_MS
  const sorted = Object.values(calendar).filter(v => v > 0).sort((a, b) => a - b)
  const quartile = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0
  const cuts = [quartile(0.25), quartile(0.5), quartile(0.75)]
  const level = (v: number) => (v <= 0 ? 0 : 1 + cuts.filter(c => v > c).length)

  const weeks: (Cell | null)[][] = []
  for (let w = 0; w < WEEKS; w++) {
    const week: (Cell | null)[] = []
    for (let d = 0; d < 7; d++) {
      const at = start + (w * 7 + d) * DAY_MS
      const key = new Date(at).toISOString().slice(0, 10)
      const total = calendar[key] ?? 0
      week.push(at > today ? null : { key, total, level: level(total) })
    }
    weeks.push(week)
  }

  const days = weeks.flat().filter((c): c is Cell => c !== null)
  let streak = 0
  let longest = 0
  for (const c of days) {
    streak = c.total > 0 ? streak + 1 : 0
    longest = Math.max(longest, streak)
  }
  const yearTotal = days.reduce((n, c) => n + c.total, 0)
  const activeDays = days.filter(c => c.total > 0).length

  return { weeks, yearTotal, activeDays, longest }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function contributionSvg(weeks: (Cell | null)[][]) {
  const size = 10
  const gap = 3
  const left = 28
  const top = 16
  const step = size + gap
  const cells: string[] = []
  const labels: string[] = []
  let lastMonth = -1
  weeks.forEach((week, w) => {
    const first = week.find(c => c !== null)
    const month = first ? Number(first.key.slice(5, 7)) - 1 : -1
    if (month !== lastMonth && first && Number(first.key.slice(8, 10)) <= 7) {
      labels.push(`<text x="${left + w * step}" y="10">${MONTHS[month]}</text>`)
    }
    lastMonth = month
    week.forEach((c, d) => {
      if (!c) return
      cells.push(
        `<rect x="${left + w * step}" y="${top + d * step}" width="${size}" height="${size}" rx="2" fill="${LEVELS[c.level]}">` +
          `<title>${c.key}: ${c.total.toLocaleString('en-US')} tokens</title></rect>`,
      )
    })
  })
  ;['Mon', 'Wed', 'Fri'].forEach((name, i) => {
    labels.push(`<text x="0" y="${top + (1 + i * 2) * step + size - 1}">${name}</text>`)
  })
  const width = left + weeks.length * step
  const height = top + 7 * step

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<g font-family="-apple-system, sans-serif" font-size="9" fill="#8b949e">${labels.join('')}</g>` +
    cells.join('') +
    '</svg>'
  )
}

let isScanning = false

async function scan($: EngineInterface) {
  if (isScanning) return
  isScanning = true
  try {
    const home = (await $.env.get('HOME')) ?? ''
    const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
    const roots = [...new Set([`${configDir}/projects`, `${home}/.claude/projects`])]
    const sessionId = await $.session.id()
    const ran = await $.process.run(
      ['/usr/bin/perl', `${$.plugin.root}/hooks/scan.pl`, `${home}/.claude/token-ledger`, sessionId, ...roots],
      { timeoutMs: 600_000 },
    )
    const scannedAt = await $.clock.now()
    if (ran.exitCode !== 0) {
      const prev = await read($, summary)
      await update($, summary, () => (prev ? { ...prev, error: ran.stderr.slice(0, 300) } : null))
      return
    }
    const next: Summary = { ...JSON.parse(ran.stdout), scannedAt }
    await update($, summary, () => next)
    await $.ui.status(`Tokens · session ${fmt(sum(next.session))} · today ${fmt(sum(next.today))}`)
  } finally {
    isScanning = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'tokens',
      description: 'Open the token counter pane (session, daily, yearly and lifetime usage)',
    })
    void $.ui.open({ id: PANE, title: 'Token counter' })
    void scan($)
    $.clock.every(REFRESH_MS, () => void scan($))

    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void scan($)

    return done
  })

  on('command.run', { command: 'tokens' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Token counter' })
    void scan($)

    return { text: 'Token counter pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const s = await read($, summary)
    if (!s) return <Text dimColor>Scanning Claude Code transcripts…</Text>

    const table = (title: string, rows: Row[]) => {
      const max = Math.max(0, ...rows.map(r => sum(r.t)))
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{title}</Text>
          {rows.length === 0 && <Text dimColor>none yet</Text>}
          {rows.map(r => (
            <Text>
              {r.key.padEnd(10)} {fmt(sum(r.t)).padStart(7)} <Text dimColor>{bar(sum(r.t), max)}</Text>
            </Text>
          ))}
        </Box>
      )
    }
    const graph = contributionGrid(s.calendar ?? {}, s.todayKey ?? new Date().toISOString().slice(0, 10))
    const graphView =
      'Svg' in elements ? (
        <elements.Svg
          source={contributionSvg(graph.weeks)}
          alt={`Token contribution graph: ${fmt(graph.yearTotal)} tokens in the last year`}
          isInteractive
        />
      ) : (
        <Box flexDirection="column">
          {[0, 1, 2, 3, 4, 5, 6].map(d => (
            <Text>
              {graph.weeks.slice(-Math.max(4, Math.floor((e.props.bodyColumns - 2) / 2))).map(week => {
                const c = week[d]
                return c ? <Text color={LEVELS[c.level]}>■ </Text> : '  '
              })}
            </Text>
          ))}
        </Box>
      )
    const [inp, out, cw, cr, msgs] = s.total

    return (
      <Box flexDirection="column">
        <Text bold>Lifetime {fmt(sum(s.total))} tokens</Text>
        <Text dimColor>
          in {fmt(inp)} · out {fmt(out)} · cache write {fmt(cw)} · cache read {fmt(cr)}
        </Text>
        <Text dimColor>
          {msgs} responses · {s.sessions} sessions · since {s.firstDay ?? '—'}
        </Text>
        <Box flexDirection="column" marginTop={1}>
          <Text>This session  <Text bold>{fmt(sum(s.session))}</Text> <Text dimColor>(out {fmt(s.session[1])})</Text></Text>
          <Text>Today         <Text bold>{fmt(sum(s.today))}</Text> <Text dimColor>(out {fmt(s.today[1])})</Text></Text>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            {fmt(graph.yearTotal)} tokens in the last year
          </Text>
          <Text dimColor>
            {graph.activeDays} active days · longest streak {graph.longest} days
          </Text>
          {graphView}
          <Text dimColor>
            Less{' '}
            {LEVELS.map(c => (
              <Text color={c}>■</Text>
            ))}{' '}
            More
          </Text>
        </Box>
        {table('Per year', s.years)}
        {table('Per month', s.months)}
        {table('Last 14 days', s.days)}
        {table('By model', s.models)}
        <Box marginTop={1}>
          <Button key="refresh" label="Refresh" onPress={() => void scan($)} />
        </Box>
        {s.error && <Text dimColor>Last scan failed: {s.error}</Text>}
        <Text dimColor>Counts Claude Code on this Mac only; updated every minute.</Text>
      </Box>
    )
  })
}
