export const HANDOFF_PROMPT = `Stop working on the task. Your only job now is to write a handoff document for a brand-new Claude Code session that will have NONE of this conversation's context. Nothing else carries over, so favour completeness and precision over brevity: a missing detail costs the next session far more than an extra line.

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

export const handoffPrompt = (git: string | undefined, root: string) =>
  git ? `${HANDOFF_PROMPT}\n\nCurrent git state of ${root}, captured just now:\n\n${git}` : HANDOFF_PROMPT

export const freshStartPrompt = (handoff: { path: string; sessionId: string; text: string }) =>
  `I'm continuing work from a previous Claude Code session. Its handoff is below ` +
  `(saved at ${handoff.path}). If something important is missing, the full earlier ` +
  `transcript is session ${handoff.sessionId}.\n\n` +
  `Read the handoff, briefly check the current state against it (files, git status, ` +
  `whatever applies), then tell me where things stand and confirm the next step ` +
  `before making changes.\n\n---\n\n${handoff.text}`
