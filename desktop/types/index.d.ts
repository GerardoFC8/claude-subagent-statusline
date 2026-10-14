export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Usage = {
  percent?: number
  tokens?: number
  window: number
  rateLimits: Limit[]
  costUsd?: number
}

export type MainModel = { model: string; effort?: string | number }

export type AgentRow = {
  id: string
  description: string
  type: string
  name?: string
  status: string
  model?: string
  effort?: string | number
  tokens: number
  startedAt: number
  endedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'subagent-statusline-desktop': {
      usage: Usage | null
      main: MainModel | null
      agents: Record<string, AgentRow>
      startedAt: number
      project: string
    }
  }
}
