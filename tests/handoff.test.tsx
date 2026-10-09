import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const SESSION_ID = 'abcdef12-3456-7890-abcd-ef1234567890'

type Fork = { isAnswered: true; text: string } | { isAnswered: false; reason: 'nothing-to-fork' }
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const world = (
  on: On,
  fork: Fork = { isAnswered: true, text: '# Handoff: test work\n\n## Goal\nShip it.' },
) => {
  const files = new Map<string, string>()
  const ran: string[] = []
  const submitted: string[] = []

  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/home/me' })
  on('session.start', () => ({ cwd: '/work/proj' }))
  on('session.usage', () => ({
    value: {
      startedAt: 1_000_000,
      context: { window: 200_000, tokens: 84_000, percent: 42 },
      rateLimits: [],
    },
  }))
  on('session.root', () => ({ value: '/work/proj' }))
  on('session.id', () => ({ value: SESSION_ID }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', (_$, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv.includes('rev-parse') ? 'true\n' : `out of ${e.argv.slice(1).join(' ')}\n`,
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('model.fork', () => ({ value: { ...fork, usage: USAGE } }))
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => ({ value: files.get(e.path) ?? '' }))
  on('command.run', (_$, e) => {
    ran.push(e.command)
    return { text: '' }
  })
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })

  return { clock, files, ran, submitted }
}

test('the band counts session time and runs the handoff to a fresh start', async ($, on) => {
  const { clock, files, ran, submitted } = world(on)
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  await clock.advance(83_000)

  const ui = await $.ui.mount({ plugin: 'session-handoff', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /1m 23s/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /context 42%/ })).toBeDefined()
  expect(await ui.find({ key: 'fresh' })).toBeUndefined()

  await ui.press({ key: 'create' })

  const path = [...files.keys()][0]
  expect(path).toMatch(/^\/home\/me\/\.claude\/handoffs\/-work-proj\/.*-abcdef12\.md$/)
  const written = files.get(path ?? '') ?? ''
  expect(written).toContain(`claude --resume ${SESSION_ID}`)
  expect(written).toContain('# Handoff: test work')
  expect(written).toContain('## Git snapshot')

  expect(await ui.find({ key: 'fresh' })).toBeDefined()
  await ui.press({ key: 'fresh' })

  expect(ran).toEqual(['clear'])
  expect(submitted).toHaveLength(1)
  expect(submitted[0]).toContain('# Handoff: test work')
  expect(await ui.find({ key: 'create' })).toBeDefined()
  await ui.unmount()
})

test('a session with nothing to fork reports it and offers a retry', async ($, on) => {
  world(on, { isAnswered: false, reason: 'nothing-to-fork' })
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'session-handoff', surface: 'terminal', ...BAND })
  await ui.press({ key: 'create' })

  expect(await ui.find({ type: 'Text', text: /nothing to hand off yet/ })).toBeDefined()
  expect(await ui.find({ key: 'retry' })).toBeDefined()
  await ui.unmount()
})
