import { getPreferenceValues } from "@raycast/api";
import { getAccessToken, OAuthService } from "@raycast/utils";
import type { Preferences } from "./linear";

const preferences = getPreferenceValues<Preferences>();

// If the user set a personal API key it takes precedence (and is required for
// the local sidecar variant); otherwise OAuthService runs the Linear OAuth
// flow through Raycast's PKCE proxy.
export const linearAuth = OAuthService.linear({
  scope: "read write",
  personalAccessToken: preferences.linearApiKey?.trim() || undefined,
});

export const githubAuth = OAuthService.github({ scope: "repo" });

// Linear expects personal API keys raw and OAuth tokens as Bearer.
export function getLinearAuthorizationHeader(): string {
  const { token, type } = getAccessToken();
  return type === "oauth" ? `Bearer ${token}` : token;
}
