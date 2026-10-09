export type Clock = {
  startedAt: number
  now: number
  contextPercent: number | null
}

export type Handoff =
  | { phase: 'idle' }
  | { phase: 'working'; since: number }
  | { phase: 'ready'; path: string; sessionId: string; at: number }
  | { phase: 'failed'; reason: string }

declare module 'claude-code' {
  interface PluginState {
    'session-handoff': { clock: Clock | null; handoff: Handoff }
  }
}
