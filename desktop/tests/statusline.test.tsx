import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { prettyModel, projectLabel } from '../hooks/register'

const BAND = {
  plugin: 'subagent-statusline-desktop',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 160,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

// what the engine draws when the mod passes
function engineBand(on: On) {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
}

test('the band shows context, cost, counters and usage without reset times', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-14T12:00:00Z') })
  engineBand(on)
  on('session.measure', ($, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { tokens: 84_000, window: 200_000, percent: 42 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 13, resetsAt: '2026-10-14T13:08:00Z' },
      { kind: 'seven_day', percentUsed: 4, resetsAt: '2026-10-19T12:00:00Z' },
    ],
    cost: { usd: 1.42 },
    changed: ['context', 'rateLimits', 'cost'],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ text: / 42%/ })).toBeDefined()
  expect(await ui.find({ text: /\$1\.42/ })).toBeDefined()
  expect(await ui.find({ text: /⚡ 0/ })).toBeDefined()
  expect(await ui.find({ text: /5h: / })).toBeDefined()
  expect(await ui.find({ text: /Week: / })).toBeDefined()
  expect(await ui.find({ text: /reset/ })).toBeUndefined()
  expect(await ui.find({ text: /engine band/ })).toBeUndefined()
  await ui.unmount()
})

test('the terminal keeps its own statusline', async ($, on) => {
  mock.clock(on)
  engineBand(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ text: /⚡/ })).toBeUndefined()
  expect(await ui.find({ text: /engine band/ })).toBeDefined()
  await ui.unmount()
})

test('the band yields to a survey', async ($, on) => {
  mock.clock(on)
  engineBand(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ text: /⚡/ })).toBeUndefined()
  expect(await ui.find({ text: /engine band/ })).toBeDefined()
  await ui.unmount()
})

test('the project label: repo, then folder, then none', async () => {
  expect(projectLabel('C:\\code\\app\\src', 'C:/code/app')).toBe('app')
  expect(projectLabel('C:\\Users\\me\\Documents\\notas', undefined)).toBe('notas')
  expect(
    projectLabel('C:\\Users\\me\\AppData\\Roaming\\Claude\\scratch-workspaces\\a\\b\\scratch-2026-10-14-d9f2ff', undefined),
  ).toBe('sin carpeta')
  expect(projectLabel('', undefined)).toBe('sin carpeta')
})

test('model ids read as names', async () => {
  expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(prettyModel('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
  expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(prettyModel(undefined)).toBe('⋯')
})
