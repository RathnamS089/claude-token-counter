/** [input, output, cache_write, cache_read, messages] */
export type Tokens = [number, number, number, number, number]
export type Row = { key: string; t: Tokens }
export type Summary = {
  total: Tokens
  today: Tokens
  todayKey: string
  /** total tokens per local day, last 53 weeks, days with usage only */
  calendar: Record<string, number>
  session: Tokens
  years: Row[]
  months: Row[]
  days: Row[]
  models: Row[]
  sessions: number
  firstDay: string | null
  files: number
  scannedAt: number
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'token-counter': { summary: Summary | null }
  }
}
