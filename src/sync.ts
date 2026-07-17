import { getPreferenceValues, updateCommandMetadata } from "@raycast/api";
import { withAccessToken } from "@raycast/utils";
import { linearAuth } from "./auth";
import { readReviewInboxFromDb } from "./db";
import { SIDECAR_ENABLED } from "./flags";
import { fetchAndCacheReviewInbox, Preferences, ReviewInbox } from "./linear";
import { isSidecarRunning, startSidecar } from "./sidecar";

async function syncCommand() {
  let inbox: ReviewInbox | undefined;

  if (SIDECAR_ENABLED) {
    await startSidecar();
    inbox = readReviewInboxFromDb();
  } else {
    inbox = await fetchAndCacheReviewInbox(getPreferenceValues<Preferences>());
  }

  const visiblePullRequests = (inbox?.pullRequests ?? []).filter(
    (pullRequest) => pullRequest.status !== "merged",
  );
  const failingCount = visiblePullRequests.filter((pullRequest) =>
    pullRequest.checks.some((check) => {
      const status = check.status?.toLowerCase() ?? "";
      return [
        "failure",
        "failed",
        "error",
        "cancelled",
        "timed_out",
        "action_required",
      ].some((failure) => status.includes(failure));
    }),
  ).length;

  await updateCommandMetadata({
    subtitle:
      SIDECAR_ENABLED && !isSidecarRunning()
        ? "Sidecar stopped"
        : `${visiblePullRequests.length} active${failingCount ? `, ${failingCount} failing` : ""}`,
  });
}

export default withAccessToken(linearAuth)(syncCommand);
