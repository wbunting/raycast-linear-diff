import { updateCommandMetadata } from "@raycast/api";
import { readReviewInboxFromDb } from "./db";
import { isSidecarRunning, startSidecar } from "./sidecar";

export default async function Command() {
  await startSidecar();

  const inbox = readReviewInboxFromDb();
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
    subtitle: isSidecarRunning()
      ? `${visiblePullRequests.length} active${failingCount ? `, ${failingCount} failing` : ""}`
      : "Sidecar stopped",
  });
}
