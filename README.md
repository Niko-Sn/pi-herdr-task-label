# pi-herdr-task-label

A Pi extension that labels each Pi agent row in Herdr with the task from its
latest meaningful user prompt.

It exists for sessions that are too small or informal for task-tree tracking.
Unlike `pi-todo-herdr`, it does not require Pi to create explicit tasks: every
substantive prompt can become the session label. Short acknowledgements such as
“yes”, “do it”, and “continue” retain the previous useful label.

## Features

- Reports a display-only `$session_task` token to the current Herdr pane
- Derives concise labels locally without an extra model request
- Persists labels across Pi reloads, resumes, forks, and tree navigation
- Uses Pi session names as an initial label when available
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
agent_panel_sort = "priority"

[ui.sidebar.agents.rows_by_agent]
pi = [
  ["state_icon", "$session_task"],
  ["agent", "state_text"],
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

## How labels are chosen

Prompts are collapsed to one line, conversational prefixes such as “can you”
and “let’s” are removed, and labels are capped at 64 characters. Common
acknowledgement-only follow-ups do not replace the previous label.

This is intentionally deterministic. It does not make an additional AI request,
so labels are immediate, private, and free, but they are concise prompt excerpts
rather than generated summaries.

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
