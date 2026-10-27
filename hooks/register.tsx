import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Fill, LastCompaction, Phase } from '../types'

// Thresholds, as a share of the auto-compact point.
const WARN_AT = 0.8
const HANDOFF_AT = 0.9
const BAR_WIDTH = 30

const fill = atom({ plugin: 'context-bar', key: 'fill' } as const, null as Fill | null)
const phase = atom({ plugin: 'context-bar', key: 'phase' } as const, 'idle' as Phase)
const last = atom({ plugin: 'context-bar', key: 'last' } as const, null as LastCompaction | null)
const isHidden = atom({ plugin: 'context-bar', key: 'isHidden' } as const, false)
const hasWarned = atom({ plugin: 'context-bar', key: 'hasWarned' } as const, false)
const isHandoffArmed = atom({ plugin: 'context-bar', key: 'isHandoffArmed' } as const, false)
const isHandoffDone = atom({ plugin: 'context-bar', key: 'isHandoffDone' } as const, false)
const isCompactionUnreported = atom(
  { plugin: 'context-bar', key: 'isCompactionUnreported' } as const,
  false,
)

const HANDOFF_NOTE =
  '[context-bar] The conversation is close to its auto-compact point. Before ' +
  'anything else, run the /session-handoff:handoff skill (reuse the session ' +
  'name of an existing HANDOFF.*.md in the project if there is one) so ' +
  'nothing is lost in the summary, say in one line that you did, then ' +
  "continue with the user's request."

const COMPACT_KEEP =
  'Keep: the active task, decisions made and why, open questions, the next ' +
  'concrete steps, and the path of any HANDOFF file written this session.'

function short(n: number | null | undefined): string {
  if (n === null || n === undefined) return '?'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`

  return `${n}`
}

function clock(ms: number): string {
  const d = new Date(ms)

  return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`
}

/** Share of the way to the auto-compact point (or the window, when off). */
function share(f: Fill): number {
  const limit = f.threshold ?? f.window

  return limit > 0 ? f.tokens / limit : 0
}

/** The bar as text: filled blocks, free blocks, and ┃ at the auto-compact point. */
function barText(f: Fill): string {
  const filled = Math.min(BAR_WIDTH, Math.round((f.tokens / f.window) * BAR_WIDTH))
  const tick =
    f.threshold !== null
      ? Math.min(BAR_WIDTH - 1, Math.round((f.threshold / f.window) * BAR_WIDTH))
      : -1
  let out = ''
  for (let i = 0; i < BAR_WIDTH; i++) {
    out += i === tick ? '┃' : i < filled ? '█' : '░'
  }

  return out
}

function summaryText(f: Fill): string {
  const pct = Math.round((f.tokens / f.window) * 100)
  const compact =
    f.isAutoCompactOn && f.threshold !== null
      ? `auto-compacts at ${short(f.threshold)}`
      : 'auto-compact off'

  return `${pct}% · ${short(f.tokens)} / ${short(f.window)} · ${compact}`
}

async function measure($: EngineInterface, tokens?: number, window?: number) {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  const next: Fill = {
    tokens: tokens ?? usage.context.tokens ?? b?.totalTokens ?? 0,
    window: window ?? usage.context.window,
    threshold: b?.isAutoCompactEnabled ? (b.autoCompactThreshold ?? null) : null,
    isAutoCompactOn: b?.isAutoCompactEnabled ?? false,
  }
  await update($, fill, () => next)
  if (next.window > 0) $.ui.status(`Context ${summaryText(next)}`)

  const s = share(next)
  if (s >= WARN_AT && !(await read($, hasWarned))) {
    await update($, hasWarned, () => true)
    $.ui.toast(`Context ${Math.round(s * 100)}% of the way to auto-compact`)
  }
  if (s >= HANDOFF_AT && next.isAutoCompactOn && !(await read($, isHandoffDone))) {
    await update($, isHandoffArmed, () => true)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'context-bar',
      description: 'Show or hide the context fill bar',
    })
    const ran = await next(e)
    try {
      await measure($)
    } catch {
      // No reading yet; the first turn's measurement fills the bar.
    }

    return ran
  })

  on('command.run', { command: 'context-bar' }, async $ => {
    const hidden = await update($, isHidden, v => !v)

    return { text: hidden ? 'Context bar hidden.' : 'Context bar shown.' }
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('context')) {
      await measure($, e.context.tokens, e.context.window)
    }

    return next(e)
  })

  // Each prompt carries, unseen by the person, the footer the reply ends with
  // (for clients that draw no bar) and, near the threshold, the handoff note.
  // Bookkeeping never blocks the prompt: any failure lets it through unchanged.
  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta) return next(e)
    const extra: string[] = []
    try {
      if ((await read($, isHandoffArmed)) && !(await read($, isHandoffDone))) {
        await update($, isHandoffArmed, () => false)
        await update($, isHandoffDone, () => true)
        $.ui.toast('Near auto-compact: writing a handoff first')
        extra.push(HANDOFF_NOTE)
      }

      const f = await read($, fill)
      if (f !== null && f.window > 0 && !(await read($, isHidden))) {
        let footer = `Context ${barText(f)} ${summaryText(f)}`
        const l = await read($, last)
        if (l && (await read($, isCompactionUnreported))) {
          await update($, isCompactionUnreported, () => false)
          footer += ` · compacted at ${clock(l.at)} (${short(l.before)} → ${short(l.after)})`
        }
        extra.push(
          '[context-bar] End your reply with this line, on its own line after ' +
            'everything else, wrapped in single backticks exactly as given, ' +
            'and do not otherwise mention it: `' + footer + '`',
        )
      }
    } catch {
      return next(e)
    }

    return next(extra.length ? { ...e, context: [...(e.context ?? []), ...extra] } : e)
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    // Subagents' own compactions and precomputes are not the main conversation's.
    if (e.agentId !== undefined || e.trigger === 'precompute') return next(e)

    await update($, phase, () => 'compacting').catch(() => undefined)
    $.ui.toast(e.trigger === 'auto' ? 'Auto-compacting the conversation…' : 'Compacting the conversation…')

    const instructions = e.instructions ? `${e.instructions}\n\n${COMPACT_KEEP}` : COMPACT_KEEP
    const result = await next({ ...e, instructions })

    try {
      await update($, phase, () => 'idle')
      if (result.skip !== undefined) {
        $.ui.toast(`Compaction skipped: ${result.skip}`)

        return result
      }
      const entry: LastCompaction = {
        trigger: e.trigger,
        before: result.tokensBefore ?? null,
        after: result.tokensAfter ?? null,
        at: await $.clock.now().catch(() => Date.now()),
      }
      await update($, last, () => entry)
      await update($, isCompactionUnreported, () => true)
      await update($, hasWarned, () => false)
      await update($, isHandoffArmed, () => false)
      await update($, isHandoffDone, () => false)
      if (entry.after !== null) {
        await update($, fill, f => (f ? { ...f, tokens: entry.after ?? f.tokens } : f))
      }
      $.ui.toast(`Compacted ${short(entry.before)} → ${short(entry.after)}`)
    } catch {
      // The compaction stands either way; only the bar's bookkeeping missed.
    }

    return result
  }).catch(($, e, next) => next(e))

  // Clients that draw add-on UI (terminal, Claude Code desktop) get a live bar.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)

    const f = await read($, fill)
    const p = await read($, phase)
    const l = await read($, last)
    const { Box, Text } = $.ui.resolve(e)

    if (p === 'compacting') {
      return (
        <Box>
          <Text color="warning" bold>
            ⟳ Compacting the conversation…
          </Text>
        </Box>
      )
    }

    if (f === null || f.window <= 0) return next(e)

    const s = share(f)
    const color = s >= WARN_AT ? 'error' : s >= 0.6 ? 'warning' : 'success'
    const lastLine = l
      ? ` · last compacted ${clock(l.at)}${l.before !== null ? ` (${short(l.before)} → ${short(l.after)})` : ''}`
      : ''

    return (
      <Box>
        <Text mono color={color}>
          {barText(f)}
        </Text>
        <Text dimColor>
          {' '}
          {summaryText(f)}
          {lastLine}
        </Text>
      </Box>
    )
  })
}
