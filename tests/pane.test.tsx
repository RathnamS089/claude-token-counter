import { expect, test } from 'claude-code/testing'

const SCAN = {
  total: [350, 267756, 436067, 26700874, 175],
  today: [228, 207626, 294477, 20611335, 114],
  session: [22, 9350, 45337, 842177, 11],
  todayKey: '2026-10-25',
  calendar: { '2026-10-24': 6291381, '2026-10-25': 21113666 },
  years: [{ key: '2026', t: [350, 267756, 436067, 26700874, 175] }],
  months: [{ key: '2026-10', t: [350, 267756, 436067, 26700874, 175] }],
  days: [{ key: '2026-10-25', t: [228, 207626, 294477, 20611335, 114] }],
  models: [{ key: 'claude-opus-5-5', t: [350, 267756, 436067, 26700874, 175] }],
  sessions: 4,
  firstDay: '2026-10-24',
  files: 7,
}

const PANE = {
  plugin: 'token-counter',
  component: 'Pane',
  requestId: 'token-counter',
  props: {
    title: 'Token counter',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('the pane shows lifetime, session and per-year totals', async ($, on) => {
  on('command.register', () => ({ value: { command: 'tokens' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'sid' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(SCAN), stderr: '' } }))
  on('env.get', () => ({ value: '/Users/me' }))
  on('clock.now', () => ({ value: 0 }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Lifetime/ }))?.text).toBe('Lifetime 27.4M tokens')
    expect((await ui.find({ type: 'Text', text: /^2026 / }))?.text).toContain('27.4M')
    expect((await ui.find({ type: 'Text', text: /^This session/ }))?.text).toContain('896.9K')
    expect((await ui.find({ type: 'Text', text: /in the last year$/ }))?.text).toBe('27.4M tokens in the last year')
    expect((await ui.find({ type: 'Text', text: /active days/ }))?.text).toContain('2 active days · longest streak 2 days')
    if (surface === 'desktop') {
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props?.source)).toContain('2026-10-25: 21,113,666 tokens')
    }
    await ui.unmount()
  }
})
