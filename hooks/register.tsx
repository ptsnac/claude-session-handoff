import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Clock, Handoff } from '../types'

const clock = atom({ plugin: 'session-handoff', key: 'clock' } as const, null)
const handoff = atom({ plugin: 'session-handoff', key: 'handoff' } as const, {
  phase: 'idle',
})

const HANDOFF_PROMPT = `Stop working on the task. Your only job now is to write a handoff document for a brand-new Claude Code session that will have NONE of this conversation's context. Nothing else carries over, so favour completeness and precision over brevity: a missing detail costs the next session far more than an extra line.

Output the markdown document only: no preamble, no closing remarks, no tool calls.

Use exactly these sections:

# Handoff: <short title of the work>

## Goal
What the user is ultimately trying to achieve, in their terms, and what "done" looks like.

## Current state
What is complete and verified, what is in progress (and how far), and what is broken or unverified.

## Decisions and constraints
Each decision made and why, options rejected and why, and every preference or constraint the user stated in this conversation. Quote the user verbatim where the wording matters.

## Files, commands and references
Every file path, directory, command, URL, ID, host, branch, config key and value that matters, each with one line on its role.

## Gotchas and dead ends
Approaches tried that failed and why, errors hit and how they were resolved, and anything that looks right but is not.

## Open questions
Unresolved decisions waiting on the user.

## Next steps
A numbered list, in order. The first step must be concrete enough to act on immediately.

## How to verify
Commands, tests or checks that confirm the work is correct.

Rules:
- Prefer exact names, paths, numbers and error text over paraphrase.
- Never invent anything that is not in the conversation. If something is uncertain, say so.
- Write "None" under a section that is genuinely empty.
- Use British English and never use the em dash character.`

const pad = (n: number) => String(n).padStart(2, '0')

const formatElapsed = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60

  return h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`
}

const formatAge = (ms: number) => {
  const minutes = Math.floor(ms / 60_000)

  return minutes < 1 ? 'just now' : `${minutes}m ago`
}

const stampOf = (ms: number) => {
  const d = new Date(ms)

  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

const setHandoff = ($: EngineInterface, value: Handoff) => update($, handoff, () => value)

const tick = async ($: EngineInterface) => {
  const usage = await $.session.usage()
  const next: Clock = {
    startedAt: usage.startedAt,
    now: await $.clock.now(),
    contextPercent: usage.context.percent ?? null,
  }
  await update($, clock, () => next)
}

const gitSnapshot = async ($: EngineInterface, cwd: string) => {
  const git = (args: string[]) =>
    $.process.run(['git', ...args], { cwd, timeoutMs: 10_000 }).catch(() => undefined)

  const inside = await git(['rev-parse', '--is-inside-work-tree'])
  if (inside?.exitCode !== 0) {
    return undefined
  }

  const [status, diff, log] = await Promise.all([
    git(['status', '--short', '--branch']),
    git(['diff', '--stat', 'HEAD']),
    git(['log', '--oneline', '-10']),
  ])
  const block = (title: string, text: string | undefined) =>
    `### ${title}\n\n\`\`\`\n${text?.trim() || '(empty)'}\n\`\`\``

  return [
    block('git status --short --branch', status?.stdout),
    block('git diff --stat HEAD', diff?.stdout),
    block('git log --oneline -10', log?.stdout),
  ].join('\n\n')
}

const createHandoff = async ($: EngineInterface): Promise<Handoff> => {
  const current = await read($, handoff)
  if (current.phase === 'working') {
    return current
  }

  const since = await $.clock.now()
  await setHandoff($, { phase: 'working', since })

  try {
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
    const prompt = git
      ? `${HANDOFF_PROMPT}\n\nCurrent git state of ${root}, captured just now:\n\n${git}`
      : HANDOFF_PROMPT
    const reply = await $.model.fork({ prompt })

    if (!reply.isAnswered) {
      const reason =
        reply.reason === 'nothing-to-fork'
          ? 'nothing to hand off yet'
          : `handoff failed (${reply.reason})`
      const failed: Handoff = { phase: 'failed', reason }
      await setHandoff($, failed)
      $.ui.toast(reason)

      return failed
    }

    const at = await $.clock.now()
    const slug = root.replace(/[^A-Za-z0-9]/g, '-')
    const path = `${home}/.claude/handoffs/${slug}/${stampOf(at)}-${sessionId.slice(0, 8)}.md`
    const context = usage.context.percent === undefined ? 'unknown' : `${usage.context.percent}%`
    const header = [
      '<!--',
      `generated: ${new Date(at).toISOString()}`,
      `project: ${root}`,
      `session: ${sessionId} (resume with: claude --resume ${sessionId})`,
      `model: ${model}`,
      `context used: ${context}`,
      `session age: ${formatElapsed(at - usage.startedAt)}`,
      '-->',
    ].join('\n')
    const gitSection = git ? `\n\n## Git snapshot (captured by the mod)\n\n${git}\n` : '\n'

    await $.fs.write(path, `${header}\n\n${reply.text.trim()}${gitSection}`)

    const ready: Handoff = { phase: 'ready', path, sessionId, at }
    await setHandoff($, ready)
    $.ui.toast(`Handoff saved: ${path}`)

    return ready
  } catch (error) {
    const reason = `handoff failed: ${error instanceof Error ? error.message : String(error)}`
    const failed: Handoff = { phase: 'failed', reason }
    await setHandoff($, failed)
    $.ui.toast(reason)

    return failed
  }
}

const startFresh = async ($: EngineInterface) => {
  const current = await read($, handoff)
  if (current.phase !== 'ready') {
    return
  }

  const text = await $.fs.read(current.path).catch(() => undefined)
  if (text === undefined) {
    $.ui.toast(`Cannot read ${current.path}`)

    return
  }

  try {
    await $.command.run({ command: 'clear' })
  } catch (error) {
    $.ui.toast(`/clear failed: ${error instanceof Error ? error.message : String(error)}`)

    return
  }
  await setHandoff($, { phase: 'idle' })

  await $.prompt.submit({
    asUser: true,
    text:
      `I'm continuing work from a previous Claude Code session. Its handoff is below ` +
      `(saved at ${current.path}). If something important is missing, the full earlier ` +
      `transcript is session ${current.sessionId}.\n\n` +
      `Read the handoff, briefly check the current state against it (files, git status, ` +
      `whatever applies), then tell me where things stand and confirm the next step ` +
      `before making changes.\n\n---\n\n${text}`,
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)

    await $.command.register({
      name: 'handoff',
      description: 'Write a handoff for a fresh context window (session-handoff mod)',
    })
    await tick($)
    $.clock.every(1000, () => void tick($))

    return started
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await setHandoff($, { phase: 'idle' })
    }

    return next(e)
  })

  on('command.run', { command: 'handoff' }, async $ => {
    const result = await createHandoff($)

    return {
      text:
        result.phase === 'ready'
          ? `Handoff saved to ${result.path}. Press "Start fresh with handoff" above the prompt to load it into a clean context.`
          : result.phase === 'failed'
            ? `Handoff not written: ${result.reason}`
            : 'A handoff is already being written.',
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const time = await read($, clock)
    if (time === null) {
      return next(e)
    }

    const state = await read($, handoff)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text>
          <Text dimColor>session </Text>
          <Text bold>{formatElapsed(time.now - time.startedAt)}</Text>
        </Text>
        {time.contextPercent !== null && (
          <Text dimColor>context {time.contextPercent}%</Text>
        )}

        {state.phase === 'idle' && (
          <Button
            key="create"
            label="Create handoff"
            hotkey="h"
            onPress={() => void createHandoff($)}
          />
        )}

        {state.phase === 'working' && (
          <Text color="yellow">
            Writing handoff... {formatElapsed(time.now - state.since)}
          </Text>
        )}

        {state.phase === 'ready' && (
          <Text color="green">Handoff ready ({formatAge(time.now - state.at)})</Text>
        )}
        {state.phase === 'ready' && (
          <Button
            key="fresh"
            label="Start fresh with handoff"
            hotkey="n"
            variant="primary"
            onPress={() => void startFresh($)}
          />
        )}
        {state.phase === 'ready' && (
          <Button
            key="regenerate"
            label="Regenerate"
            hotkey="h"
            dimColor
            onPress={() => void createHandoff($)}
          />
        )}

        {state.phase === 'failed' && <Text color="red">{state.reason}</Text>}
        {state.phase === 'failed' && (
          <Button
            key="retry"
            label="Retry handoff"
            hotkey="h"
            onPress={() => void createHandoff($)}
          />
        )}
      </Box>
    )
  })
}
