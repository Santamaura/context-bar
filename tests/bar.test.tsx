import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'context-bar',
  component: 'AbovePrompt',
  props: { hasSurvey: false },
} as const

const usage = (tokens: number) => ({
  value: {
    startedAt: 0,
    rateLimits: [],
    context: {
      tokens,
      window: 200_000,
      percent: Math.round((tokens / 200_000) * 100),
      breakdown: { autoCompactThreshold: 160_000, isAutoCompactEnabled: true, totalTokens: tokens },
    },
  },
})

test('the bar shows fill and the auto-compact point, then compaction', async ($, on) => {
  let tokens = 84_000
  let toasts: string[] = []
  on('session.usage', () => usage(tokens))
  on('ui.toast', (_, e: any) => {
    toasts.push(String(e.text ?? e))
    return { value: undefined }
  })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('prompt.submit', (_, e) => ({ text: e.text, context: e.context }))
  on('ui.status', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_790_000_000_000 }))
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] as any, tokensBefore: 150_000, tokensAfter: 20_000 }))

  await $.session.measure({ context: { tokens, window: 200_000 }, rateLimits: [], changed: ['context'] })
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const line = await ui.find({ type: 'Text', text: /auto-compacts at 160K/ })
  expect(line?.text).toContain('42% · 84K / 200K')
  await ui.unmount()

  tokens = 150_000
  await $.session.measure({ context: { tokens, window: 200_000 }, rateLimits: [], changed: ['context'] })
  expect(toasts.some(t => /auto-compact/.test(t))).toBe(true)

  const sent: any = await $.prompt.submit({ text: 'next task' })
  expect(sent.text).toBe('next task')
  expect(sent.context.join('\n')).toContain('/session-handoff:handoff')
  expect(sent.context.join('\n')).toContain('75% · 150K / 200K · auto-compacts at 160K')
  expect(sent.context.join('\n')).toMatch(/█{23}░┃░{5}/)

  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as any)
  expect(toasts.some(t => /Compacted 150K → 20K/.test(t))).toBe(true)
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /last compacted/ }))?.text).toContain('150K → 20K')
  await ui.unmount()

  const after: any = await $.prompt.submit({ text: 'and then' })
  expect(after.context.join('\n')).toContain('compacted at')
  expect(after.context.join('\n')).not.toContain('/session-handoff:handoff')
  const again: any = await $.prompt.submit({ text: 'once more' })
  expect(again.context.join('\n')).not.toContain('compacted at')
})
