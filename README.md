# pi-session-tokens

Lightweight token accounting for the [Pi](https://pi.dev) coding agent. No dependencies, no changes to Pi itself, no statistics injected into the model context.

```text
Σ 128.4k · ⎇ 42.6k · ◷ 43s        ← footer status: session total · branch total · live clock

↳ 43s · 8.2k tok                   ← one line under each reply
```

## What it shows

| Where | Example | Meaning |
|---|---|---|
| Footer (idle) | `Σ 128.4k · ⎇ 42.6k` | Session total across **all** branches, then the current path |
| Footer (running) | `Σ 128.4k · ⎇ 42.6k · ◷ 43s` | Adds a live clock for the current turn |
| Under a reply | `↳ 43s · 8.2k tok` | Elapsed time and usage of that turn |
| `/tokens` | panel | Every branch: path total, tokens added since the fork, turn count |

Only the session total uses the theme's normal foreground; labels, the branch total and the clock stay dim, so the status line matches the rest of Pi's footer.

## Install

```bash
pi install npm:pi-session-tokens
```

From git:

```bash
pi install git:github.com/DDashes/pi-session-tokens
```

Try it without installing anything:

```bash
pi -e npm:pi-session-tokens
```

Then run `/reload` if Pi is already open. **Load it only once** — a global entry, a `-e` flag and an installed package at the same time will all write the same footer key and each append their own turn records.

Requires Pi 1.5.0 or newer. Nothing to configure.

## Counting rules

- Token usage is read from Pi's normalized `input + output + cacheRead + cacheWrite`. Reasoning and `cacheWrite1h` are subsets already contained in output/cache, so they are never added twice.
- Included: assistant messages, nested model calls reported by tools, compaction and branch summaries, and `usage` entries such as idle cache warming. Sub-agent sessions and sessions forked into **separate files** are not merged; each session file reports its own total.
- The session total de-duplicates entries by id, so shared ancestors are counted once. **Branch totals include shared history and must not be summed** — `/tokens` says so as well.
- A turn is one continuous busy period: tool calls, automatic retries, compaction retries and queued follow-ups all belong to it. It settles on `agent_settled`, so elapsed time includes tool execution and waiting, not just model generation.
- Elapsed time is wall-clock, shown as whole seconds (`43s`, `2m 08s`). Live clock and final value use the same format.
- `*` marks incomplete usage: some recorded call reported nothing or only a zero-initialized usage from a failed/aborted request. `—` means nothing usable at all. The plugin never guesses.
- Turns recorded by the plugin are custom session entries: they render in the TUI but never reach the model. Turn numbers (`T12`, `T12+`) appear only inside `/tokens` — `+` means old history or unsettled calls make the count partial. Compaction can hide older summary lines from the active chat view, but totals and turn counts stay intact.
- An interrupted process is finished on the next start and marked `interrupted` with no invented duration.

## Colors

Only the token amount inside `↳ … tok` is colored, judged on the raw integer of the turn total.

| Tokens in one turn | Style |
|---|---|
| < 100k | theme text color |
| 100k – < 500k | light green |
| 500k – < 2M | deep green |
| 2M – < 10M | orange |
| 10M – < 30M | warm purple, bold |
| 30M – < 100M | rose, bold |
| ≥ 100M | gold, bold |

The green band is deliberate: a common turn should read as "not much". Only 10M+ is bold. Colors encode usage, not quality or cost — heavy cache reads reach high tiers too. Separate palettes are used for dark and light themes; `NO_COLOR` or `TERM=dumb` disables them.

## `/tokens`

```text
SESSION  ·  Σ 35.0k tok
↑ 20.0k  ↓ 10.0k  cache 5.0k

● a3f2c1d8  current  ·  T8
  30,000 tok  ·  +10,000 since a3f2c1d8
○ b7c1e4a2
  25,000 tok  ·  +5,000 since a3f2c1d8

Branch totals share ancestors; do not add rows.
* partial usage  ·  Tn+ recorded turns only
↑/↓ page  ·  Enter/Esc close
```

Up/down pages, Enter or Esc closes. The panel is a snapshot; reopen it after new activity.

## Development

```bash
npm test
```

Requires Node ≥ 22.18 for the tests (type stripping); verified on v24.22.2. The tests use synthetic sessions only — no model calls, no credentials, no real session files. `PI_TEST_ROOT` points them at another Pi installation.

**Runtime modules must be `.ts`.** Pi's `/reload` clears its extension cache and re-reads `.ts`, but Node caches an imported `.mjs` for the lifetime of the process. This caused a real bug: the entry point updated while `stats.mjs` kept the old thresholds and palette, so a 662.1k turn still rendered with the previous five-tier palette. `test/reload-test.mjs` guards both the import suffix and that edits actually take effect after a reload.

Manual check after changes: finish one turn with a tool call, look at the reply line and `/tokens`, create a second branch with `/tree`, then `/reload`, `/compact` and switch sessions to confirm totals never double count.

## License

MIT
