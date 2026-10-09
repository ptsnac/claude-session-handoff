// Pure pieces of a handoff file. The engine follows `$` only within one file,
// so everything that calls it stays in register.tsx and hands its results here.
import { fileStamp, formatElapsed } from './time'

export const GIT_COMMANDS = [
  ['status', '--short', '--branch'],
  ['diff', '--stat', 'HEAD'],
  ['log', '--oneline', '-10'],
]

export const formatGitSnapshot = (outputs: readonly (string | undefined)[]) =>
  GIT_COMMANDS.map((args, i) => {
    const text = outputs[i]?.trim() || '(empty)'
    return `### git ${args.join(' ')}\n\n\`\`\`\n${text}\n\`\`\``
  }).join('\n\n')

export const handoffPath = (home: string, root: string, sessionId: string, at: number) =>
  `${home}/.claude/handoffs/${root.replace(/[^A-Za-z0-9]/g, '-')}/${fileStamp(at)}-${sessionId.slice(0, 8)}.md`

// Each value as a JSON string, which is also a valid YAML double-quoted scalar.
const frontMatter = (fields: Record<string, string>) =>
  ['---', ...Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), '---'].join(
    '\n',
  )

export const handoffDocument = (handoff: {
  at: number
  root: string
  sessionId: string
  model: string
  startedAt: number
  contextPercent: number | undefined
  body: string
  git: string | undefined
}) => {
  const header = frontMatter({
    generated: new Date(handoff.at).toISOString(),
    project: handoff.root,
    session: handoff.sessionId,
    resume: `claude --resume ${handoff.sessionId}`,
    model: handoff.model,
    context_used: handoff.contextPercent === undefined ? 'unknown' : `${handoff.contextPercent}%`,
    session_age: formatElapsed(handoff.at - handoff.startedAt),
  })
  const gitSection = handoff.git
    ? `\n\n## Git snapshot (captured by the mod)\n\n${handoff.git}\n`
    : '\n'

  return `${header}\n\n${handoff.body.trim()}${gitSection}`
}
