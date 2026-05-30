/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Linear API Key - Create a personal API key in Linear settings. */
  "linearApiKey": string,
  /** Notifications to Scan - More rows can find more PRs, but each refresh asks Linear for more notifications. */
  "pageSize": string,
  /** Include Read Notifications - Disable to show only unread Diffs notifications. */
  "includeRead": boolean,
  /** Merge Method - How the GitHub CLI merges pull requests when you merge or enable auto-merge. */
  "mergeMethod": "squash" | "merge" | "rebase",
  /** Delete Branch on Merge - Delete the source branch after merging. */
  "deleteBranchOnMerge": boolean
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `index` command */
  export type Index = ExtensionPreferences & {}
  /** Preferences accessible in the `sync` command */
  export type Sync = ExtensionPreferences & {}
  /** Preferences accessible in the `start-sidecar` command */
  export type StartSidecar = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `index` command */
  export type Index = {}
  /** Arguments passed to the `sync` command */
  export type Sync = {}
  /** Arguments passed to the `start-sidecar` command */
  export type StartSidecar = {}
}

