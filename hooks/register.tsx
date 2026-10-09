import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Handoff, SettledHandoff, WrittenHandoff } from '../types'
import { GIT_COMMANDS, formatGitSnapshot, handoffDocument, handoffPath } from './document'
import { freshStartPrompt, handoffPrompt } from './prompts'
import { formatAge, formatElapsed } from './time'

const handoff = atom({ plugin: 'session-handoff', key: 'handoff' } as const, {
  phase: 'idle',
})

const setHandoff = ($: EngineInterface, value: Handoff) => update($, handoff, () => value)

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const gitSnapshot = async ($: EngineInterface, cwd: string) => {
  const git = (args: readonly string[]) =>
    $.process.run(['git', ...args], { cwd, timeoutMs: 10_000 }).catch(() => undefined)

  if ((await git(['rev-parse', '--is-inside-work-tree']))?.exitCode !== 0) {
    return undefined
  }
  const outputs = await Promise.all(GIT_COMMANDS.map(git))

  return formatGitSnapshot(outputs.map(output => output?.stdout))
}

// Forks the conversation into a handoff file. Throws, with a reason fit to show, when it cannot.
const writeHandoff = async ($: EngineInterface): Promise<WrittenHandoff> => {
  const [root, sessionId, model, usage, home] = await Promise.all([
    $.session.root(),
    $.session.id(),
    $.session.model(),
    $.session.usage(),
    $.env.get('HOME'),
  ])
  if (home === undefined) {
    throw new Error('HOME is not set')
  }

  const git = await gitSnapshot($, root)
  const reply = await $.model.fork({ prompt: handoffPrompt(git, root) })
  if (!reply.isAnswered) {
    throw new Error(
      reply.reason === 'nothing-to-fork'
        ? 'nothing to hand off yet'
        : `the model did not answer (${reply.reason})`,
    )
  }

  const at = await $.clock.now()
  const path = handoffPath(home, root, sessionId, at)
  await $.fs.write(
    path,
    handoffDocument({
      at,
      root,
      sessionId,
      model,
      startedAt: usage.startedAt,
      contextPercent: usage.context.percent,
      body: reply.text,
      git,
    }),
  )

  return { path, sessionId, at }
}

const describe = (result: SettledHandoff) =>
  result.phase === 'ready'
    ? `Handoff saved to ${result.path}. Press "Start fresh with handoff" above the prompt to load it into a clean context.`
    : `Handoff failed: ${result.reason}`

// What the row shows for each phase: a status line and the handoff button's label.
const view = (state: Handoff, now: number) => {
  switch (state.phase) {
    case 'idle':
      return { action: { key: 'create', label: 'Create handoff' } }
    case 'working':
      return { status: { color: 'yellow', text: `Writing handoff... ${formatElapsed(now - state.since)}` } }
    case 'ready':
      return {
        status: { color: 'green', text: `Handoff ready (${formatAge(now - state.at)})` },
        action: { key: 'regenerate', label: 'Regenerate' },
      }
    case 'failed':
      return {
        status: { color: 'red', text: `Handoff failed: ${state.reason}` },
        action: { key: 'retry', label: 'Retry handoff' },
      }
  }
}

// Set synchronously before the first await, so a press and /handoff arriving
// together share one fork instead of racing past a read-then-write guard.
let inFlight: Promise<SettledHandoff> | undefined

const createHandoff = ($: EngineInterface) => {
  inFlight ??= (async () => {
    await setHandoff($, { phase: 'working', since: await $.clock.now() })
    const result = await writeHandoff($).then(
      (written): SettledHandoff => ({ phase: 'ready', ...written }),
      (error): SettledHandoff => ({ phase: 'failed', reason: reasonOf(error) }),
    )
    await setHandoff($, result)
    $.ui.toast(describe(result))

    return result
  })().finally(() => {
    inFlight = undefined
  })

  return inFlight
}

const startFresh = async ($: EngineInterface) => {
  const current = await read($, handoff)
  if (current.phase !== 'ready') {
    return
  }

  // Read back from disk rather than state, so edits made to the file before
  // starting fresh are what the new context receives.
  const text = await $.fs.read(current.path).catch(() => undefined)
  if (text === undefined) {
    $.ui.toast(`Cannot read ${current.path}`)
    return
  }

  // The session.end hook resets the handoff state once /clear has run.
  const cleared = await $.command.run({ command: 'clear' }).then(
    () => true,
    error => {
      $.ui.toast(`/clear failed: ${reasonOf(error)}`)
      return false
    },
  )
  if (!cleared) {
    return
  }

  await $.prompt
    .submit({ asUser: true, text: freshStartPrompt({ ...current, text }) })
    .catch(error =>
      $.ui.toast(`Context cleared but the handoff was not loaded (${reasonOf(error)}). It is saved at ${current.path}`),
    )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)

    // A reload drops the old module's fork mid-flight; do not leave the row stuck on "Writing".
    if ((await read($, handoff)).phase === 'working') {
      await setHandoff($, { phase: 'failed', reason: 'interrupted by a reload of the mod' })
    }
    await $.command.register({
      name: 'handoff',
      description: 'Write a handoff for a fresh context window (session-handoff mod)',
    })
    $.clock.every(1000, () => $.ui.invalidate('ui.render'))

    return started
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await setHandoff($, { phase: 'idle' })
    }

    return next(e)
  })

  on('command.run', { command: 'handoff' }, async $ => ({ text: describe(await createHandoff($)) }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const [usage, now, state] = await Promise.all([
      $.session.usage(),
      $.clock.now(),
      read($, handoff),
    ])
    const { status, action } = view(state, now)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text>
          <Text dimColor>session </Text>
          <Text bold>{formatElapsed(now - usage.startedAt)}</Text>
        </Text>
        {usage.context.percent !== undefined && (
          <Text dimColor>context {usage.context.percent}%</Text>
        )}
        {status && <Text color={status.color}>{status.text}</Text>}
        {state.phase === 'ready' && (
          <Button
            key="fresh"
            label="Start fresh with handoff"
            hotkey="n"
            variant="primary"
            onPress={() => void startFresh($)}
          />
        )}
        {action && (
          <Button
            key={action.key}
            label={action.label}
            hotkey="h"
            onPress={() => void createHandoff($)}
          />
        )}
      </Box>
    )
  })
}
