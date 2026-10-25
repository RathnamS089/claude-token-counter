# token-counter

A Claude Code mod that adds a **Token counter** pane beside the chat (Claude desktop app's Code tab, or the terminal) and a status line entry.

The pane shows:

- this session and today
- a GitHub-style contribution graph of daily tokens over the last year (hover a day in the desktop app for its count), with active days and longest streak
- lifetime total, split into input / output / cache write / cache read
- per year, per month (last 12), per day (last 14) and per model

Run `/tokens` to reopen the pane. It refreshes after each turn and once a minute.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install token-counter --marketplace RathnamS089/claude-token-counter
```

From a shell:

```bash
claude plugin install token-counter --marketplace RathnamS089/claude-token-counter
```

In the Claude desktop app: click + next to the prompt box, then Plugins, Add marketplace with `RathnamS089/claude-token-counter`, then Add plugin.

Needs macOS (or any system with `/usr/bin/perl`).

## How it counts

`hooks/scan.pl` (macOS's built-in `/usr/bin/perl`, no installs needed) reads the Claude Code transcripts in `~/.claude/projects/**/*.jsonl` and folds each assistant response's `usage` into a ledger at `~/.claude/token-ledger/`. Each response is counted once (keyed by message id + request id), and files are read incrementally from where the last scan stopped.

The ledger keeps totals after Claude Code deletes old transcripts (`cleanupPeriodDays`, 30 days by default), so the yearly and lifetime numbers keep growing from the first scan on. To recover more history, raise that setting in `~/.claude/settings.json`, e.g. `"cleanupPeriodDays": 3650`.

## Limits

- Claude Code only, on this Mac. Chats on claude.ai, the desktop chat tab, and other machines don't write local transcripts, so they aren't counted. Anthropic exposes no API for a consumer account's lifetime token usage.
- History before the first scan is limited to the transcripts still on disk.
