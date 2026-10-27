# context-bar

A slim bar above the chat box that shows how full the conversation's context window is, so you can see auto-compaction coming instead of being surprised by it.

## What it does

**In Cowork** (and any client that draws no add-on UI), Claude ends each reply with a one-line footer:

`Context ███████░░░░░░░░░░░░░░░░░░░░░┃ 22% · 222K / 1M · auto-compacts at 967K`

The first reply after a compaction adds `· compacted at 14:05 (900K → 60K)`. The figures are as of the start of the turn, and the line costs a few dozen tokens per reply.

**In Claude Code** (terminal, or the desktop app's Code tab) you also get a live bar above the prompt, toasts and a status line entry:

- **Fill bar**: green, then yellow, then red as the context fills, with a `┃` tick marking the auto-compact point. Text beside it shows `42% · 84K / 200K · auto-compacts at 167K (50% there)`.
- **Early warning**: a toast at 80% of the way to auto-compact.
- **Automatic handoff**: at 90%, your next message is prefixed with an instruction to run `/session-handoff:handoff` first, so the session state is saved to a `HANDOFF.*.md` file before anything is summarized. Requires the session-handoff plugin.
- **Compaction notices**: the bar switches to `⟳ Compacting the conversation…` while it runs, then a toast reports `Compacted 610K → 48K` and the bar shows when it last happened.
- **`/context-bar`** shows or hides the bar and the footer.

## Install

In the Claude desktop app: click **+** next to the prompt box, then **Plugins → Add marketplace**, enter `Santamaura/context-bar`, then **Add plugin**.

At the prompt of a terminal session:

```
/plugin install context-bar --marketplace Santamaura/context-bar
```

From a shell:

```
claude plugin install context-bar --marketplace Santamaura/context-bar
```

## Notes

Thresholds (80% warning, 90% handoff) are constants at the top of `hooks/register.tsx`.
