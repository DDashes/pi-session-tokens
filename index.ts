import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { rgbColor, truncateToWidth } from '@earendil-works/pi-tui';
import { START_TYPE, TURN_TYPE, sum, turns, branches, amount, duration, tier, palettes } from './stats.ts';

export default function sessionTokens(pi: ExtensionAPI) {
  let active: { id: string; started: number } | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let statusBase = '';
  let sessionAmount = '0';
  let branchAmount = '0';
  const stopTimer = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const paintStatus = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    const elapsed = active ? ` · ◷ ${duration(Math.max(0, performance.now() - active.started))}` : '';
    const plain = process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb';
    const theme = ctx.ui.theme;
    // Only the session total stands out; labels, branch usage and clock recede.
    const text = plain || !theme ? statusBase + elapsed
      : theme.fg('dim', 'Σ ') + theme.fg('text', sessionAmount)
        + theme.fg('dim', ` · ⎇ ${branchAmount}${elapsed}`);
    ctx.ui.setStatus('session-tokens', text);
  };
  const refresh = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    const sm = ctx.sessionManager;
    sessionAmount = amount(sum(sm.getEntries()));
    branchAmount = amount(sum(sm.getBranch()));
    statusBase = `Σ ${sessionAmount} · ⎇ ${branchAmount}`;
    paintStatus(ctx);
  };
  const finish = (ctx: ExtensionContext, aborted: boolean, recovered = false) => {
    stopTimer();
    if (!active) { refresh(ctx); return; }
    const running = active;
    const all = ctx.sessionManager.getEntries();
    if (all.some(e => e.type === 'custom' && e.customType === TURN_TYPE && (e.data as any)?.startId === running.id)) {
      active = undefined; refresh(ctx); return;
    }
    const index = all.findIndex(e => e.id === running.id);
    if (index < 0) { active = undefined; refresh(ctx); return; }
    // At recovery, only account for the active path: a copied fork must not absorb other branches.
    const pathIds = recovered ? new Set(ctx.sessionManager.getBranch().map(e => e.id)) : undefined;
    const added = all.slice(index + 1).filter(e => !pathIds || pathIds.has(e.id));
    const addedIds = new Set(added.map(e => e.id));
    const prior = turns(ctx.sessionManager.getBranch().filter(e => !addedIds.has(e.id)));
    pi.appendEntry(TURN_TYPE, {
      version: 1, startId: running.id, entryIds: added.map(e => e.id),
      number: prior.count + 1, partialHistory: prior.incomplete,
      elapsedMs: recovered ? null : Math.max(0, performance.now() - running.started),
      usage: sum(added), aborted, recovered,
    });
    active = undefined;
    refresh(ctx);
  };
  const start = (ctx: ExtensionContext) => {
    if (active) return; // automatic retries and queued follow-ups belong to this busy period
    const started = performance.now();
    pi.appendEntry(START_TYPE, { version: 1 });
    active = { id: ctx.sessionManager.getLeafId()!, started };
    refresh(ctx);
    if (ctx.hasUI) {
      stopTimer();
      // Repaint only the clock; do not rescan session history every second.
      timer = setInterval(() => paintStatus(ctx), 1000);
      timer.unref?.();
    }
  };
  pi.on('before_agent_start', (_e, ctx) => start(ctx));
  pi.on('agent_start', (_e, ctx) => start(ctx));
  pi.on('agent_settled', (e, ctx) => finish(ctx, e.aborted));
  pi.on('session_start', (_e, ctx) => {
    stopTimer();
    active = undefined;
    const path = ctx.sessionManager.getBranch();
    const lastStart = [...path].reverse().find(e => e.type === 'custom' && e.customType === START_TYPE);
    if (lastStart && !path.some(e => e.type === 'custom' && e.customType === TURN_TYPE && (e.data as any)?.startId === lastStart.id)) {
      active = { id: lastStart.id, started: 0 };
      finish(ctx, true, true); // process interruption: never invent elapsed time
    }
    refresh(ctx);
  });
  pi.on('turn_end', (_e, ctx) => refresh(ctx));
  pi.on('session_compact', (_e, ctx) => refresh(ctx));
  pi.on('session_tree', (_e, ctx) => refresh(ctx));
  pi.on('session_shutdown', (_e, ctx) => {
    stopTimer();
    try {
      if (active) finish(ctx, true);
    } finally {
      active = undefined;
      statusBase = '';
      if (ctx.hasUI) ctx.ui.setStatus('session-tokens', undefined);
    }
  });

  pi.registerEntryRenderer(TURN_TYPE, (entry, options, theme) => ({
    invalidate() {},
    render(width: number) {
      const d = entry.data as any;
      if (d?.version !== 1 || !d.usage) return [];
      const plain = process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb';
      const dim = (s: string) => plain ? s : theme.fg('dim', s);
      const tokenText = `${amount(d.usage)} tok`;
      const level = tier(d.usage.total);
      const color = palettes[theme.appearance === 'light' ? 'light' : 'dark'][level];
      const colored = plain ? tokenText
        : color && d.usage.total > 0
          ? theme.style(tokenText, { fg: rgbColor(...color as [number, number, number]), bold: level >= 4 })
          // Unstyled text would use the terminal's own foreground, which is often warm
          // and reads as gold. Keep the neutral tier on the theme's normal text color.
          : theme.fg('text', tokenText);
      const state = d.recovered ? ' · interrupted' : d.aborted ? ' · aborted' : '';
      const line = dim(`↳ ${duration(d.elapsedMs)} · `) + colored + dim(state);
      const lines = [truncateToWidth(line, width)];
      if (options.expanded) {
        lines.push(truncateToWidth(dim(`  ↑ ${d.usage.input.toLocaleString('en-US')} · ↓ ${d.usage.output.toLocaleString('en-US')} · cache R ${d.usage.cacheRead.toLocaleString('en-US')} / W ${d.usage.cacheWrite.toLocaleString('en-US')}`), width));
        if (d.usage.unknown) lines.push(truncateToWidth(dim('  * incomplete usage; total includes only reported tokens'), width));
      }
      return lines;
    },
  }));

  pi.registerCommand('tokens', {
    description: 'Session token totals and all branch usage (input + output + cache)',
    handler: async (_args, ctx) => {
      refresh(ctx);
      const entries = ctx.sessionManager.getEntries();
      const rows = branches(entries, ctx.sessionManager.getLeafId());
      const totals = sum(entries);
      const clean = (s: string) => s.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
      if (ctx.mode !== 'tui') {
        if (ctx.hasUI) ctx.ui.notify(`Σ ${amount(totals, true)} tok\n` + rows.map(r => `${r.current ? '●' : ' '} ${r.id} · ${amount(r.total, true)} tok · +${amount(r.added, true)} since ${r.fork ?? 'root'} · ${r.turns}`).join('\n'), 'info');
        return;
      }
      await ctx.ui.custom<void>((tui, theme, keys, done) => {
        let page = 0;
        let pageSize = 6;
        return {
          invalidate() {},
          render(width: number) {
            pageSize = Math.max(1, Math.min(6, Math.floor(((tui.terminal.rows || 24) - 10) / 3)));
            const pages = Math.max(1, Math.ceil(rows.length / pageSize));
            page = Math.min(page, pages - 1);
            const lines = [theme.bold(`SESSION  ·  Σ ${amount(totals)} tok`),
              theme.fg('dim', `↑ ${totals.input.toLocaleString('en-US')}  ↓ ${totals.output.toLocaleString('en-US')}  cache ${(totals.cacheRead + totals.cacheWrite).toLocaleString('en-US')}`), ''];
            for (const r of rows.slice(page * pageSize, (page + 1) * pageSize)) {
              lines.push(`${r.current ? '●' : '○'} ${r.id.slice(0, 8)}${r.label ? `  ${clean(r.label)}` : ''}  ·  ${r.turns}`);
              lines.push(`  ${amount(r.total, true)} tok  ·  +${amount(r.added, true)} since ${r.fork?.slice(0, 8) ?? 'root'}`);
              lines.push('');
            }
            if (!rows.length) lines.push('No branches yet.', '');
            lines.push(theme.fg('dim', 'Branch totals share ancestors; do not add rows.'));
            lines.push(theme.fg('dim', '* partial usage  ·  Tn+ recorded turns only'));
            lines.push(theme.fg('dim', `↑/↓ page ${page + 1}/${pages}  ·  Enter/Esc close`));
            return lines.map(s => truncateToWidth(s, width));
          },
          handleInput(data: string) {
            if (keys.matches(data, 'tui.select.cancel') || keys.matches(data, 'tui.select.confirm')) return done();
            const pages = Math.max(1, Math.ceil(rows.length / pageSize));
            if (keys.matches(data, 'tui.select.down')) page = (page + 1) % pages;
            else if (keys.matches(data, 'tui.select.up')) page = (page + pages - 1) % pages;
            else return;
            tui.requestRender();
          },
        };
      });
    },
  });
}
