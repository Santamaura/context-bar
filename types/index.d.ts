export type Fill = {
  tokens: number
  window: number
  threshold: number | null
  isAutoCompactOn: boolean
}

export type LastCompaction = {
  trigger: string
  before: number | null
  after: number | null
  at: number
}

export type Phase = 'idle' | 'compacting'

declare module 'claude-code' {
  interface PluginState {
    'context-bar': {
      fill: Fill | null
      phase: Phase
      last: LastCompaction | null
      isHidden: boolean
      hasWarned: boolean
      isHandoffArmed: boolean
      isHandoffDone: boolean
      isCompactionUnreported: boolean
    }
  }
}
