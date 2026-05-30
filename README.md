# Linear Diffs for Raycast

A fast review inbox for **[Linear Diffs](https://linear.app/docs/diffs)** pull requests, right inside Raycast. It shows each PR's review status, CI check summary, branch metadata, and quick actions — and it opens instantly because it reads from a local SQLite cache instead of waiting on the network.

## Features

- **Instant list** of the pull requests surfaced in your Linear Diffs review notifications.
- **At-a-glance status** — approved / in review / draft / merged / closed, plus a merge-status line.
- **CI check summary** — counts of passing, pending, and failing checks, with the failing check named directly in the list.
- **Filters** by status, unread, or failing checks.
- **Quick actions** — open in the Linear app or browser, open the PR, jump straight to a failing check, copy the URL or source branch, and mark the Linear notification read.
- **Merge from Raycast** — merge a PR (`⌘⇧M`) or enable GitHub auto-merge (`⌘⇧A`) without leaving the list, using your configured merge method. Powered by the GitHub CLI (`gh`).
- **Background sync** via a lightweight sidecar process that polls Linear once a minute.

## How it works

Linear's public GraphQL API does not expose a root `pullRequests` list — Diffs PR data is only reachable through `PullRequestNotification`. This extension scans your recent notifications, dedupes the attached pull requests, and keeps the latest state Linear has synced from GitHub.

To keep the Raycast UI snappy, fetching is decoupled from rendering:

```
┌─────────────────┐    polls every 60s     ┌──────────────┐
│ sidecar.cjs     │ ─────────────────────► │ Linear API   │
│ (detached node) │                        └──────────────┘
│                 │ writes
│                 │ ──────► ~/.linear-diffs-raycast/linear-diffs.sqlite
└─────────────────┘                                 ▲
                                                    │ reads (read-only)
                                            ┌───────┴────────┐
                                            │ Linear Diffs   │
                                            │ Raycast command│
                                            └────────────────┘
```

- **`sidecar.cjs`** is a detached Node process (it survives Raycast closing). It reads a private config file, polls Linear, and writes pull requests + checks into SQLite in a single transaction.
- **The `Linear Diffs` command** reads that SQLite file synchronously and re-reads every 2 seconds while open, so opening Raycast never blocks on Linear.
- **The `Sync Linear Diffs` command** runs on a schedule as a watchdog: it restarts the sidecar if Raycast notices it has stopped, and updates the command subtitle with the active/failing counts.

All state lives under `~/.linear-diffs-raycast/`:

| File | Purpose |
| --- | --- |
| `linear-diffs.sqlite` | Cached pull requests, checks, and viewer metadata |
| `config.json` | Sidecar config written from your preferences (`chmod 600`) |
| `sidecar.pid` | PID of the running sidecar |
| `sidecar.log` | Sidecar stdout/stderr |

## Setup

1. Create a **personal API key** in [Linear → Settings → Security & access → Personal API keys](https://linear.app/settings/account/security).
2. Install dependencies:
   ```sh
   npm install
   ```
3. Start the extension in development mode:
   ```sh
   npm run dev
   ```
4. Open the **Linear Diffs** command in Raycast and paste your API key into the `Linear API Key` preference.
5. Run **Start Linear Diffs Sidecar** once to begin background polling. Within a minute the list populates from SQLite.

## Preferences

| Preference | Default | Description |
| --- | --- | --- |
| **Linear API Key** | — | Personal API key used for all requests. Stored locally by Raycast. |
| **Notifications to Scan** | `1000` | How many recent notifications each refresh pulls (25–1000). Higher finds more PRs but is heavier per refresh. |
| **Include Read Notifications** | on | When off, only unread Diffs notifications are shown. |
| **Merge Method** | Squash and Merge | Method `gh pr merge` uses for both direct merge and auto-merge (`squash` / `merge` / `rebase`). |
| **Delete Branch on Merge** | off | When on, deletes the source branch after a successful merge. |

## Commands

| Command | Mode | Description |
| --- | --- | --- |
| **Linear Diffs** | view | The review inbox. Reads from SQLite. |
| **Sync Linear Diffs** | no-view (every 5m) | Watchdog that restarts the sidecar and refreshes the subtitle. |
| **Start Linear Diffs Sidecar** | no-view | Starts the background poller manually. |

## Requirements

- A Node.js runtime with the experimental **`node:sqlite`** module (Node 22+). Raycast bundles a compatible runtime; the sidecar runs under the same `process.execPath`.
- A Linear workspace with Diffs enabled and GitHub connected.
- For the merge actions: the **GitHub CLI** (`brew install gh`) authenticated via `gh auth login`. Linear's public API exposes no merge mutation, so merges go through `gh` against the GitHub PR directly. The extension looks for `gh` in `/opt/homebrew/bin`, `/usr/local/bin`, and `/usr/bin`.

## Development

```sh
npm run dev        # ray develop with hot reload
npm run lint       # ESLint + Prettier (Raycast config)
npm run fix-lint   # auto-fix lint/format issues
npm run build      # production build into ./dist
```

Source layout:

| File | Responsibility |
| --- | --- |
| `src/index.tsx` | The `Linear Diffs` list view and all rendering/actions |
| `src/sync.ts` | Watchdog command (subtitle + sidecar restart) |
| `src/start-sidecar.ts` | Manual sidecar start command |
| `src/sidecar.ts` | Spawns/tracks the detached sidecar; writes config |
| `src/db.ts` | Read-only SQLite access for the UI |
| `src/linear.ts` | Linear GraphQL types and the in-process fetch path |
| `src/github.ts` | `gh` CLI wrapper for merging / enabling auto-merge |
| `src/paths.ts` | Shared filesystem paths |
| `assets/sidecar.cjs` | The standalone background poller |

## Privacy

Your Linear API key never leaves your machine — it is stored by Raycast's preference store and written to `~/.linear-diffs-raycast/config.json` (mode `600`) for the sidecar. All network traffic goes directly to `api.linear.app`.

## License

[MIT](LICENSE)
