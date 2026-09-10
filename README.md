# pi-herdr-task-label

A Pi extension that asks the active agent to write a concise, coherent task
title for its row in Herdr.

It exists for sessions that are too small or informal for task-tree tracking.
Unlike `pi-todo-herdr`, it does not require an explicit task tree. It displays
the latest user prompt and the agent's intentional 3–7 word task title on
separate rows.

## Features

- Reports display-only `$last_prompt` and `$agent_task` tokens to Herdr
- Provides `set_herdr_title`, an agent-facing tool with a strict 42-character limit
- Instructs Pi to write a coherent 3–7 word title when the objective changes
- Persists both lines across Pi reloads, resumes, forks, and tree navigation
- Supports manual agent-task titles and returning to automatic mode
- Migrates state from the previous single-token format
- Coexists with Herdr's official managed Pi integration and `pi-todo-herdr`
- Clears its tokens when Pi quits

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

Run the interactive setup command:

```text
/herdr-label-setup
```

Pi shows the target configuration path and requires explicit confirmation before
writing. Setup changes only the `rows_by_agent.pi` assignment, preserves unrelated
TOML text, creates a timestamped backup, writes atomically, validates with
`herdr config check`, restores the original on failure, and reloads the server.
Press `Ctrl+B`, then `Shift+R` in Herdr afterward to reload the client UI.

The command installs this layout:

```toml
[ui]
sidebar_width = 46
agent_panel_sort = "spaces"

[ui.sidebar.agents.rows_by_agent]
pi = [
  ["state_icon", "agent", "workspace"],
  ["$last_prompt"],
  ["$agent_task"],
]
```

You can also add the layout manually and apply it with `herdr config check` and
`herdr server reload-config`.

## Commands

| Command | Purpose |
| --- | --- |
| `/herdr-label <task>` | Set and hold a manual agent-task title |
| `/herdr-label-auto` | Resume agent-managed task titles |
| `/herdr-label-clear` | Clear the agent-task title and pause updates |
| `/herdr-label-setup` | Confirm and safely install the styled three-row Herdr layout |

## How titles are chosen

At the beginning of substantive work, Pi is instructed to call
`set_herdr_title` with a coherent, action-oriented title of 3–7 words. The tool
schema rejects titles longer than 42 characters, so Pi must shorten an oversized
title before it can be displayed.

The latest user prompt is independently collapsed to one line and clipped at a
readable word boundary. It updates even for short follow-ups such as “do it,”
while the agent-task row retains the coherent objective title.

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
