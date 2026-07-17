// Build variant flag. Toggled by `scripts/set-variant.mjs` — do not edit by hand.
//
// local (true):  the detached sidecar process polls Linear every minute into
//                SQLite for near-instant list loads. Requires a Linear API key.
// store (false): no background process; data comes from the Linear API via
//                OAuth, cached as JSON, refreshed by the 5m background command.
export const SIDECAR_ENABLED = true;
