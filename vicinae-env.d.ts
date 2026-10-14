/// <reference types="@vicinae/api">

/*
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 */

type ExtensionPreferences = {
  /** Linear API Key - Optional. Personal API key used instead of Sign in with Linear. Required for the local sidecar variant. */
	"linearApiKey"?: string;

	/** Notifications to Scan - More rows can find more PRs, but each refresh asks Linear for more notifications. */
	"pageSize"?: string;

	/** Include Read Notifications - Disable to show only unread Diffs notifications. */
	"includeRead"?: boolean;

	/** Merge Method - How pull requests are merged when you merge or enable auto-merge. */
	"mergeMethod"?: "squash" | "merge" | "rebase";

	/** Delete Branch on Merge - Delete the source branch after merging. */
	"deleteBranchOnMerge"?: boolean;
}

declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Command: Linear Diffs */
	export type Index = ExtensionPreferences & {
		
	}

	/** Command: Sync Linear Diffs */
	export type Sync = ExtensionPreferences & {
		
	}

	/** Command: Start Linear Diffs Sidecar */
	export type StartSidecar = ExtensionPreferences & {
		
	}
}

declare namespace Arguments {
  /** Command: Linear Diffs */
	export type Index = {
		
	}

	/** Command: Sync Linear Diffs */
	export type Sync = {
		
	}

	/** Command: Start Linear Diffs Sidecar */
	export type StartSidecar = {
		
	}
}