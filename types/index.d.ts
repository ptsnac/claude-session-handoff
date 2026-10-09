export type WrittenHandoff = { path: string; sessionId: string; at: number }

export type Handoff =
  | { phase: 'idle' }
  | { phase: 'working'; since: number }
  | ({ phase: 'ready' } & WrittenHandoff)
  | { phase: 'failed'; reason: string }

export type SettledHandoff = Extract<Handoff, { phase: 'ready' | 'failed' }>

declare module 'claude-code' {
  interface PluginState {
    'session-handoff': { handoff: Handoff }
  }
}
