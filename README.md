# Linear Diffs

A fast review inbox for **[Linear Diffs](https://linear.app/docs/diffs)** pull requests, right inside Raycast. It shows each PR's review status, CI check summary, branch metadata, and quick actions — merge, auto-merge, or close without leaving Raycast.

## Features

- **Review inbox** of the pull requests surfaced in your Linear Diffs review notifications.
- **At-a-glance status** — approved / in review / draft / merged / closed, plus a merge-status line.
- **CI check summary** — counts of passing, pending, and failing checks, with the failing check named directly in the list.
- **Filters** by status, unread, or failing checks.
- **Quick actions** — open in the Linear app or browser, open the PR, jump straight to a failing check, copy the URL or source branch, and mark the Linear notification read.
- **Merge from Raycast** — merge a PR (`⌘⇧M`), enable GitHub auto-merge (`⌘⇧A`), or close a PR (`⌘⇧X`) via the GitHub API using your configured merge method.
- **Background refresh** every 5 minutes.

## Setup

1. Open the **Linear Diffs** command and **Sign in with Linear** when prompted.
2. The first time you merge, auto-merge, or close a pull request, **Sign in with GitHub** when prompted.

No API keys or CLI tools required.

### Optional: Linear API key

If you prefer a personal API key over OAuth, create one in [Linear → Settings → Security & access → Personal API keys](https://linear.app/settings/account/security) and set it in the extension preferences. When set, it is used instead of OAuth. It is required for the local sidecar variant (below).

## How it works

Linear's public GraphQL API does not expose a root `pullRequests` list — Diffs PR data is only reachable through `PullRequestNotification`. This extension scans your recent notifications, dedupes the attached pull requests, and keeps the latest state Linear has synced from GitHub.

Merges, auto-merge, and closes go through the GitHub API directly (Linear's public API exposes no merge mutation).

## Preferences

| Preference | Default | Description |
| --- | --- | --- |
| **Linear API Key** | — | Optional. Used instead of OAuth when set. Required for the sidecar variant. |
| **Notifications to Scan** | `1000` | How many recent notifications each refresh pulls (25–1000). Higher finds more PRs but is heavier per refresh. |
| **Include Read Notifications** | on | When off, only unread Diffs notifications are shown. |
| **Merge Method** | Squash and Merge | Merge method used for both direct merge and auto-merge (`squash` / `merge` / `rebase`). |
| **Delete Branch on Merge** | off | When on, deletes the source branch after a successful merge or close. |

## Commands

| Command | Mode | Description |
| --- | --- | --- |
| **Linear Diffs** | view | The review inbox. |
| **Sync Linear Diffs** | no-view (every 5m) | Background refresh; updates the command subtitle with active/failing counts. |

## Local sidecar variant (development only)

The repository supports a second build variant that decouples fetching from rendering for near-instant list loads. A detached Node process polls Linear once a minute and writes into a local SQLite database that the UI reads synchronously. It is not part of the Store build.

```sh
npm run variant:local   # sidecar enabled — requires the Linear API Key preference
npm run variant:store   # store build, no background process
npm run dev
```

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

In this variant the **Sync Linear Diffs** command acts as a watchdog (restarts the sidecar if it stopped), and a third command, **Start Linear Diffs Sidecar**, starts the poller manually. All state lives under `~/.linear-diffs-raycast/`:

| File | Purpose |
| --- | --- |
| `linear-diffs.sqlite` | Cached pull requests, checks, and viewer metadata |
| `config.json` | Sidecar config written from your preferences (`chmod 600`) |
| `sidecar.pid` | PID of the running sidecar |
| `sidecar.log` | Sidecar stdout/stderr |

The sidecar requires a Node.js runtime with the experimental **`node:sqlite`** module (Node 22+). Raycast bundles a compatible runtime; the sidecar runs under the same `process.execPath`.

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
| `src/sync.ts` | Background refresh command (subtitle + data refresh or sidecar watchdog) |
| `src/auth.ts` | Linear + GitHub OAuth services and auth header helpers |
| `src/flags.ts` | Build variant flag (toggled by `scripts/set-variant.mjs`) |
| `src/start-sidecar.ts` | Manual sidecar start command (local variant only) |
| `src/sidecar.ts` | Spawns/tracks the detached sidecar; writes config |
| `src/db.ts` | Read-only SQLite access for the UI (local variant) |
| `src/linear.ts` | Linear GraphQL types, fetching, and JSON cache |
| `src/github.ts` | GitHub API client for merge / auto-merge / close |
| `src/paths.ts` | Shared filesystem paths |
| `assets/sidecar.cjs` | The standalone background poller (local variant) |

## Privacy

Credentials never leave your machine: OAuth tokens are stored by Raycast, and an optional API key lives in Raycast's preference store (the sidecar variant also writes it to `~/.linear-diffs-raycast/config.json`, mode `600`). All network traffic goes directly to `api.linear.app` and `api.github.com`.

## License

[MIT](LICENSE)
