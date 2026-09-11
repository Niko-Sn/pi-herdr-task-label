# pi-herdr-task-label

A Pi extension that shows the latest user prompt and an agent-written task title
on separate rows in Herdr. It does not require a task tree and coexists with
Herdr's managed Pi integration and `pi-todo-herdr`.

## Install

From npm:

```bash
pi install npm:pi-herdr-task-label
```

From GitHub:

```bash
pi install git:github.com/Niko-Sn/pi-herdr-task-label@v0.4.0
```

For local development:

```bash
pi install /absolute/path/to/pi-herdr-task-label
```

Run `/reload` in every existing Pi session after installing or updating.

## Requirements

- Pi 0.85 or newer
- Node.js 22.19 or newer
- [Herdr](https://herdr.dev/) with its [Pi integration](https://herdr.dev/docs/integrations/) installed

## Agent layout

The setup command configures three Pi rows:

1. State icon, `pi`, and workspace
2. Latest user prompt in darker gray
3. Agent-written task title in lighter gray

```toml
[ui.sidebar.agents.rows_by_agent]
pi = [
  ["state_icon", "agent", "workspace"],
  [{ token = "$last_prompt", fg = "#928374" }],
  [{ token = "$agent_task", fg = "#bdae93" }],
]
```

The latest prompt updates on every user turn. Pi sets a coherent, action-oriented
task title of 3–7 words when work begins or the objective materially changes.

## Label length

Both text rows default to 42 characters. Set the limit before starting Pi:

```bash
export PI_HERDR_TASK_LABEL_MAX_LENGTH=50
```

Valid values are integers from 10 through Herdr's maximum of 80. Missing or
invalid values use 42. The configured limit controls prompt clipping, manual
titles, agent-title validation, and agent guidance. Restart Pi after changing it.

## Configure Herdr

Run:

```text
/herdr-label-setup
```

The command resolves and displays the target config path, then asks for
confirmation before changing it. Nothing runs automatically during installation,
updates, startup, or `/reload`.

After confirmation, setup:

- Changes only `[ui.sidebar.agents.rows_by_agent].pi`
- Uses TOML-aware source ranges and preserves unrelated text and comments
- Validates a staged candidate with `herdr config check`
- Rejects dangling symlinks and follows valid symlinks to their target
- Detects concurrent edits and never clobbers a concurrently created file
- Creates `config.toml.bak-<timestamp>` before replacing an existing config
- Preserves file permissions and installs the validated candidate without clobbering
- Reloads the Herdr server

Press `Ctrl+B`, then `Shift+R` in Herdr to reload the client UI. Existing Pi
sessions also need `/reload` before they can report both metadata values.

The extension honors `HERDR_CONFIG_PATH`, then the platform config location:
`$XDG_CONFIG_HOME/herdr/config.toml`, `~/.config/herdr/config.toml`, or
`%APPDATA%\\herdr\\config.toml` on Windows.

### Optional sidebar settings

The setup command deliberately leaves general UI preferences untouched. The
current recommended settings are:

```toml
[ui]
sidebar_width = 46
sidebar_min_width = 36
sidebar_max_width = 56
agent_panel_sort = "spaces"
```

## Commands

| Command | Purpose |
| --- | --- |
| `/herdr-label-setup` | Confirm and install the styled three-row Pi layout |
| `/herdr-label <task>` | Set and hold a manual task title |
| `/herdr-label-auto` | Resume agent-managed task titles |
| `/herdr-label-clear` | Clear the task title and pause agent updates |

A manual title prevents `set_herdr_title` from replacing it until
`/herdr-label-auto` is run.

## Customize

Edit the `pi` rows in `config.toml`. Token entries support `fg`, `bold`, and
`dim`, for example:

```toml
[{ token = "$agent_task", fg = "#cccccc", bold = true }]
```

Rows may be reordered or removed, and built-in tokens such as `machine`, `tab`,
and `state_text` may be added. Apply manual changes with:

```bash
herdr config check
herdr server reload-config
```

Then press `Ctrl+B`, followed by `Shift+R` in Herdr. Package updates do not alter
the layout. Running `/herdr-label-setup` again resets only the `pi` assignment to
the extension default after confirmation and backup.

## Undo setup

If no relevant config edits were made afterward, restore the backup reported by
the setup command:

```bash
cp ~/.config/herdr/config.toml.bak-<timestamp> ~/.config/herdr/config.toml
herdr config check
herdr server reload-config
```

Then reload the Herdr client with `Ctrl+B`, followed by `Shift+R`. If the config
was edited after setup, remove or replace only the
`[ui.sidebar.agents.rows_by_agent].pi` assignment instead of restoring the whole
backup. If setup created a new config, no backup exists; remove that table or
assignment manually.

## State and privacy

The extension reports display-only `$last_prompt` and `$agent_task` metadata to
the current Herdr pane, persists state across reloads, resumes, forks, and tree
navigation, and clears both tokens when Pi quits. Prompts and titles remain within
the local Pi and Herdr processes.

## Development

```bash
npm install
npm run check
```

## License

MIT
