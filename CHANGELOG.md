# Changelog

## 0.1.0 - 2026-11-06

First public release.

- Footer status with session-wide token total (all branches, de-duplicated) and current-branch total, without replacing the default footer.
- Live per-turn clock (`◷ 43s`) that keeps counting through tool calls, retries and queued follow-ups.
- Per-turn summary line under each reply (`↳ 43s · 8.2k tok`, colors only the token amount) persisted in the session as a renderer-only entry.
- Seven usage tiers: neutral, light/deep green, orange, purple, rose, gold; only 10M+ is bold.
- `/tokens` panel with every branch: path total, tokens added since the fork point, fork id, turn count.
- Handles reloads, `session_tree` navigation, compaction, aborted turns, interrupted processes and non-TUI modes.
- Runtime modules are TypeScript only, so `/reload` really picks up edits.
