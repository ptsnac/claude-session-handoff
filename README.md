# claude-session-handoff

A Claude Code mod that adds a row above the prompt with a session timer and a
one-click handoff to a fresh context window.

```
session 1h 23m 07s   context 64%   [ Create handoff ]
```

Once a handoff is written:

```
session 1h 31m 40s   context 66%   Handoff ready (2m ago)   [ Start fresh with handoff ]   [ Regenerate ]
```

## Why not `/compact`?

`/compact` replaces your conversation with a summary, so anything the summary
misses is gone. This mod leaves the conversation alone and instead:

1. Forks the current conversation (tool-less, served from the prompt cache, so
   it is quick and cheap) and asks it to write a structured handoff: goal,
   current state, decisions and constraints, files and commands, dead ends,
   open questions, next steps and how to verify.
2. Appends a real `git status`, diff stat and recent log, captured by the mod
   rather than recalled by the model.
3. Saves it as a Markdown file whose YAML front matter records the old session's ID and the
   `claude --resume <id>` command, so the full transcript is always one step
   away if the handoff missed something.

**Start fresh with handoff** then runs `/clear` and submits the handoff as the
first message of the new context, asking Claude to check the current state and
confirm the next step before changing anything.

## Requirements

- Claude Code with function-hook mods (tested on 2.1.288). The mod API is early
  access and may change between releases.
- `git` on your `PATH` (optional; the git snapshot is skipped outside a repo).

## Install

Pick a permanent folder for the mod and clone it there. Set
`SESSION_HANDOFF_DIR` to wherever you keep your code:

```sh
SESSION_HANDOFF_DIR="$HOME/code/claude-session-handoff"
git clone https://github.com/ptsnac/claude-session-handoff.git "$SESSION_HANDOFF_DIR"
```

Then load it in one of two ways.

**Every session** - add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env`
block of `~/.claude/settings.json`. It takes an absolute path or one starting
with `~`, but not `$HOME` or other variables, so print the line to paste from
the same shell:

```sh
echo "\"CLAUDE_CODE_PLUGIN_DIRS\": \"$SESSION_HANDOFF_DIR\""
```

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "<the path printed above>"
  }
}
```

Separate several folders with `:` on macOS and Linux.

**One session** - pass the folder when starting Claude Code:

```sh
claude --plugin-dir "$SESSION_HANDOFF_DIR"
```

## Use

| Action | How |
| --- | --- |
| Write a handoff | Click **Create handoff**, or type `/handoff` |
| Start a clean context with it | Click **Start fresh with handoff** |
| Rewrite a stale handoff | Click **Regenerate** |
| Use the keyboard | `ctrl+x tab` to focus the row, then `h` (handoff) or `n` (start fresh) |

Handoffs are saved to:

```
~/.claude/handoffs/<project-path-slug>/<YYYY-MM-DD-HHMMSS>-<session-id>.md
```

The timer counts from the start of the current context and resets on `/clear`.

## Good to know

- A handoff made while Claude is replying covers the conversation up to its
  last completed message, not the reply in progress.
- The handoff goes stale as you keep working. The row shows its age; regenerate
  before starting fresh if you have done more since.
- Nothing is sent anywhere except the usual model request to Anthropic, made
  through your own Claude Code session.

## Develop

```sh
claude plugin validate .   # checks the manifest and what the module calls
claude plugin test .       # runs tests/*.test.tsx against the engine
```

The engine writes type declarations into `.claude-plugin/types/` the first
time it loads the mod (ignored by git); after that `tsc -p .` type-checks it.
Loaded with `--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS`, saving a file
hot-reloads the mod in the running session.

| File | Role |
| --- | --- |
| `hooks/register.tsx` | Everything that calls Claude Code: the hooks, the handoff state machine, writing the file, fresh start and the row's UI |
| `hooks/prompts.ts` | The handoff prompt and the fresh-start message. Edit here to change what a handoff contains |
| `hooks/document.ts` | Pure helpers that build the handoff file: path, YAML front matter, git snapshot section |
| `hooks/time.ts` | Time formatting |
| `types/index.d.ts` | The handoff state the row draws from |
| `tests/handoff.test.tsx` | Tests for the timer, handoff, fresh start, failure and concurrent requests |

The engine only follows `$` (the mod's handle on Claude Code) within a single
file, so every call through it stays in `register.tsx`; the other modules are
plain functions.
