# pi-herdr-task-label

A Pi extension that asks the active agent to write a concise, coherent task
title for its row in Herdr.

It exists for sessions that are too small or informal for task-tree tracking.
Unlike `pi-todo-herdr`, it does not require an explicit task tree. A deterministic
prompt-derived label appears immediately, then Pi replaces it with an intentional
3–7 word title when it begins work.

## Features

- Reports a display-only `$session_task` token to the current Herdr pane
- Provides `set_herdr_title`, an agent-facing tool with a strict 42-character limit
- Instructs Pi to write a coherent 3–7 word title when the objective changes
- Uses an immediate prompt-derived fallback if the agent does not call the tool
- Persists labels across Pi reloads, resumes, forks, and tree navigation
- Restores an initial label from the Pi session name or latest user prompt
- Supports manual labels and returning to automatic mode
- Coexists with Herdr's official managed Pi integration and `pi-todo-herdr`
- Clears its token when Pi quits

No prompt or label is sent outside the local Pi and Herdr processes.

## Requirements

- Pi 0.85 or newer
- Node.js 20 or newer
- Herdr with the Pi integration installed

## Install

While this repository is private, install it using GitHub SSH authentication:

```bash
pi install git:git@github.com:Niko-Sn/pi-herdr-task-label.git
```

For local development:

```bash
pi install /absolute/path/to/pi-herdr-task-label
```

Run `/reload` in an existing Pi session after installation.

## Configure Herdr

Add `$session_task` to the Pi agent rows in `~/.config/herdr/config.toml`:

```toml
[ui]
sidebar_width = 46
agent_panel_sort = "spaces"

[ui.sidebar.agents.rows_by_agent]
pi = [
  ["state_icon", "agent"],
  ["$session_task"],
]
```

Apply it without restarting the Herdr server:

```bash
herdr config check
herdr server reload-config
```

## Commands

| Command | Purpose |
| --- | --- |
| `/herdr-label <task>` | Set and hold a manual label |
| `/herdr-label-auto` | Resume labels derived from prompts |
| `/herdr-label-clear` | Clear the label and pause automatic updates |

## How titles are chosen

At the beginning of substantive work, Pi is instructed to call
`set_herdr_title` with a coherent, action-oriented title of 3–7 words. The tool
schema rejects titles longer than 42 characters, so Pi must shorten an oversized
title before it can be displayed.

A deterministic fallback is still derived immediately from the user prompt.
Conversational prefixes are removed, long text is clipped at a word boundary,
and acknowledgement-only follow-ups retain the previous label. The agent-written
title replaces that fallback when the tool is called. No additional model request
is made.

## Development

```bash
npm install
npm run check
```

## Publishing later

The package is marked `private` in `package.json` while under development.
Before publishing to npm, remove that field, review the package name, and run:

```bash
npm pack --dry-run
npm publish
```

## License

MIT
