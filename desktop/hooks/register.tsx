import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { AgentRow, Limit, MainModel, Usage } from '../types'

const usage = atom({ plugin: 'subagent-statusline-desktop', key: 'usage' } as const, null)
const main = atom({ plugin: 'subagent-statusline-desktop', key: 'main' } as const, null)
const agents = atom({ plugin: 'subagent-statusline-desktop', key: 'agents' } as const, {})
const startedAt = atom({ plugin: 'subagent-statusline-desktop', key: 'startedAt' } as const, 0)
const project = atom({ plugin: 'subagent-statusline-desktop', key: 'project' } as const, '')

const TERMINAL = new Set(['completed', 'failed', 'killed'])
const LIVE = new Set(['pending', 'running', 'waiting'])

// claude-opus-5-5[1m] -> Opus 5.5
export function prettyModel(id: string | undefined): string {
  if (!id) return '⋯'
  const m = /claude-(fable|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?!\d)/i.exec(id)
  if (!m) return id
  const [, name = '', major, minor] = m
  const family = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase()
  return minor ? `${family} ${major}.${minor}` : `${family} ${major}`
}

export function prettyEffort(effort: string | number | undefined): string | undefined {
  if (effort === undefined) return undefined
  return typeof effort === 'number' ? `${Math.round(effort / 1000)}k` : effort
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return `${n}`
}

export function bar(percent: number, cells: number): { full: string; empty: string } {
  const p = Math.min(100, Math.max(0, percent))
  let filled = Math.round((p / 100) * cells)
  if (p > 0 && filled === 0) filled = 1
  return { full: '█'.repeat(filled), empty: '░'.repeat(cells - filled) }
}

export const levelColor = (p: number) => (p >= 80 ? 'error' : p >= 50 ? 'warning' : 'success')

const NO_FOLDER = 'sin carpeta'

// the repo's folder name in a repo, else the folder's; a session the app
// started without a folder runs in a scratch workspace of its own
export function projectLabel(cwd: string | undefined, repoRoot: string | undefined): string {
  const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop()
  if (!cwd || /[\\/]Claude[\\/]scratch-workspaces[\\/]/i.test(cwd)) return NO_FOLDER
  return (repoRoot && base(repoRoot)) || base(cwd) || NO_FOLDER
}

function windowFor(model: string | undefined, u: Usage | null, m: MainModel | null): number {
  if (model && /haiku/i.test(model)) return 200_000
  if (model && /\[1m\]/i.test(model)) return 1_000_000
  if (u && (!model || !m || model === m.model)) return u.window
  return u?.window ?? 200_000
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const now = await $.clock.now()
    try {
      const u = await $.session.usage()
      await update($, startedAt, () => u.startedAt || now)
      await update($, usage, () => toUsage(u))
    } catch {
      await update($, startedAt, () => now)
    }
    try {
      const id = await $.session.model()
      await update($, main, prev => prev ?? { model: id })
    } catch {}

    const refreshProject = async () => {
      const [dir, repo] = await Promise.all([$.session.cwd(), $.session.repo().catch(() => null)])
      const label = projectLabel(dir, repo?.root)
      await update($, project, prev => (prev === label ? prev : label))
    }
    await refreshProject().catch(() => {})

    let ticks = 0
    const poll = async () => {
      if (++ticks % 5 === 0) await refreshProject().catch(() => {})
      const list = await $.agent.list()
      const t = await $.clock.now()
      await update($, agents, prev => {
        const out: Record<string, AgentRow> = { ...prev }
        const seen = new Set<string>()
        for (const a of list) {
          seen.add(a.id)
          const old = out[a.id]
          out[a.id] = {
            id: a.id,
            description: a.description,
            type: a.type,
            name: a.name,
            status: a.status,
            model: old?.model,
            effort: old?.effort,
            tokens: old?.tokens ?? 0,
            startedAt: old?.startedAt ?? t,
            endedAt: TERMINAL.has(a.status) ? (old?.endedAt ?? t) : undefined,
          }
        }
        // the engine drops finished tasks from its list after a while
        for (const row of Object.values(out)) {
          if (!seen.has(row.id) && LIVE.has(row.status)) {
            out[row.id] = { ...row, status: 'completed', endedAt: row.endedAt ?? t }
          }
        }
        return out
      })
      $.ui.invalidate('ui.render')
    }
    $.clock.every(1000, () => {
      poll().catch(() => {})
    })

    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => toUsage(e))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    const result = yield* stream
    const agentId = e.agentId
    const model = result.usage?.model ?? e.model
    if (agentId === undefined) {
      await update($, main, () => ({ model, effort: e.effort }))
    } else {
      const u = result.usage
      const used = u ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : undefined
      const t = await $.clock.now()
      await update($, agents, prev => {
        const old = prev[agentId]
        return {
          ...prev,
          [agentId]: {
            id: agentId,
            description: old?.description ?? '',
            type: old?.type ?? 'general-purpose',
            name: old?.name,
            status: old?.status ?? 'running',
            startedAt: old?.startedAt ?? t,
            endedAt: old?.endedAt,
            model,
            effort: e.effort,
            tokens: used ?? old?.tokens ?? 0,
          },
        }
      })
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // the terminal has the Node statusline of claude-subagent-statusline
    if (e.surface !== 'desktop' || e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const [u, m, list, since, place, now] = await Promise.all([
      read($, usage),
      read($, main),
      read($, agents),
      read($, startedAt),
      read($, project),
      $.clock.now(),
    ])
    const width = e.props.bodyColumns ?? e.viewport?.columns ?? 120

    const rows = Object.values(list)
    const running = rows.filter(a => LIVE.has(a.status))
    const done = rows.filter(a => a.status === 'completed').length
    const failed = rows.filter(a => a.status === 'failed' || a.status === 'killed').length

    const sep = <Text dimColor> │ </Text>
    const dot = <Text dimColor> · </Text>

    const effort = prettyEffort(m?.effort)
    const ctx = u?.percent
    const ctxBar = ctx !== undefined ? bar(ctx, 10) : undefined

    const limits = (u?.rateLimits ?? []).filter(l => l.kind === 'five_hour' || l.kind === 'seven_day')
    const limitView = (l: Limit) => {
      const label = l.kind === 'five_hour' ? '5h' : 'Week'
      return (
        <Text>
          <Text dimColor>{label}: </Text>
          <Text color={levelColor(l.percentUsed)}>{Math.round(l.percentUsed)}%</Text>
        </Text>
      )
    }

    const descRoom = Math.max(12, width - 70)
    const agentRow = (a: AgentRow) => {
      const win = windowFor(a.model, u, m)
      const pct = win > 0 ? (a.tokens / win) * 100 : 0
      const b = bar(pct, 16)
      const eff = prettyEffort(a.effort)
      const label = a.name ?? (a.type !== 'general-purpose' ? a.type : undefined)
      const desc = a.description.length > descRoom ? a.description.slice(0, descRoom - 1) + '…' : a.description
      return (
        <Box key={a.id} flexDirection="row">
          <Text dimColor>  ↳ </Text>
          <Text bold color="ide">{prettyModel(a.model)}</Text>
          {eff ? <Text dimColor> ({eff})</Text> : null}
          {label ? <Text>{' · '}{label}</Text> : null}
          {desc ? <Text dimColor wrap="truncate">{' · '}{desc}</Text> : null}
          <Text> </Text>
          <Text color={levelColor(pct)}>{b.full}</Text>
          <Text dimColor>{b.empty}</Text>
          <Text dimColor>
            {' '}{tokens(a.tokens)}/{tokens(win)} · {duration(now - a.startedAt)}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap">
          <Text bold dimColor={!place || place === NO_FOLDER}>{place || NO_FOLDER} </Text>
          <Text dimColor>[</Text>
          <Text color="claude">{prettyModel(m?.model)}</Text>
          {effort ? <Text dimColor> ({effort})</Text> : null}
          {u?.costUsd !== undefined ? <Text dimColor> · ${u.costUsd.toFixed(2)}</Text> : null}
          <Text dimColor>] </Text>
          {ctxBar ? (
            <Text>
              <Text color={levelColor(ctx!)}>{ctxBar.full}</Text>
              <Text dimColor>{ctxBar.empty}</Text>
              <Text color={levelColor(ctx!)}> {ctx}%</Text>
            </Text>
          ) : (
            <Text dimColor>ctx –</Text>
          )}
          {sep}
          <Text>⏱ {since ? duration(now - since) : '–'}</Text>
          {sep}
          <Text color={running.length ? 'warning' : undefined}>⚡ {running.length}</Text>
          {dot}
          <Text color="success">✓ {done}</Text>
          {dot}
          <Text color={failed ? 'error' : undefined}>✗ {failed}</Text>
          {limits.length ? sep : null}
          {limits.map((l, i) => (
            <Text key={l.kind}>
              {i > 0 ? <Text dimColor> · </Text> : null}
              {limitView(l)}
            </Text>
          ))}
        </Box>
        {running.map(agentRow)}
      </Box>
    )
  })
}

function toUsage(u: {
  context: { percent?: number; tokens?: number; window: number }
  rateLimits: readonly Limit[]
  cost?: { usd: number }
}): Usage {
  return {
    percent: u.context.percent,
    tokens: u.context.tokens,
    window: u.context.window,
    rateLimits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
    costUsd: u.cost?.usd,
  }
}
