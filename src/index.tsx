import {
  Action,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  Icon,
  Keyboard,
  List,
  Toast,
  getPreferenceValues,
  open,
  showToast,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { readReviewInboxFromDb } from "./db";
import { mergePullRequest, MergeMethod } from "./github";
import {
  markPullRequestRead,
  Preferences,
  ReviewInbox,
  ReviewPullRequest,
} from "./linear";
import { isSidecarRunning, startSidecar } from "./sidecar";

type StatusFilter = "all" | ReviewPullRequest["status"] | "failing" | "unread";

const STATUS_FILTERS: { title: string; value: StatusFilter }[] = [
  { title: "All", value: "all" },
  { title: "Unread", value: "unread" },
  { title: "Failing Checks", value: "failing" },
  { title: "Draft", value: "draft" },
  { title: "Open", value: "open" },
  { title: "In Review", value: "inReview" },
  { title: "Approved", value: "approved" },
  { title: "Merged", value: "merged" },
  { title: "Closed", value: "closed" },
];

export default function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [data, setData] = useState<ReviewInbox | undefined>(() =>
    readReviewInboxFromDb(),
  );
  const [sidecarRunning, setSidecarRunning] = useState(() =>
    isSidecarRunning(),
  );

  function reloadFromDb() {
    setData(readReviewInboxFromDb());
    setSidecarRunning(isSidecarRunning());
  }

  useEffect(() => {
    const interval = setInterval(reloadFromDb, 2_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <List
      isLoading={false}
      searchBarPlaceholder="Search Linear Diffs pull requests"
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter Pull Requests"
          storeValue
          value={filter}
          onChange={(value) => setFilter(value as StatusFilter)}
        >
          {STATUS_FILTERS.map((filter) => (
            <List.Dropdown.Item
              key={filter.value}
              title={filter.title}
              value={filter.value}
            />
          ))}
        </List.Dropdown>
      }
      throttle
    >
      {filterPullRequests(data?.pullRequests ?? [], filter).length === 0 ? (
        <List.EmptyView
          icon={Icon.CodeBlock}
          title={
            sidecarRunning
              ? "No Linear Diffs PRs found"
              : "Linear Diffs sidecar is not running"
          }
          description={
            sidecarRunning
              ? "Waiting for the local SQLite database to receive synced PRs."
              : "Start the sidecar to poll Linear every minute and populate SQLite."
          }
          actions={
            <ActionPanel>
              <Action
                title="Start Sidecar"
                icon={Icon.Play}
                onAction={async () => {
                  await startSidecar();
                  reloadFromDb();
                }}
              />
              <Action
                title="Reload from SQLite"
                icon={Icon.RotateClockwise}
                onAction={reloadFromDb}
              />
            </ActionPanel>
          }
        />
      ) : (
        filterPullRequests(data?.pullRequests ?? [], filter).map(
          (pullRequest) => (
            <PullRequestItem
              key={pullRequest.id}
              pullRequest={pullRequest}
              preferences={preferences}
              reloadFromDb={reloadFromDb}
            />
          ),
        )
      )}
    </List>
  );
}

function PullRequestItem({
  pullRequest,
  preferences,
  reloadFromDb,
}: {
  pullRequest: ReviewPullRequest;
  preferences: Preferences;
  reloadFromDb: () => void;
}) {
  const failingChecks = pullRequest.checks.filter(isFailingCheck);
  const repo = getRepositoryName(pullRequest.url);

  const mergeMethod = (preferences.mergeMethod ?? "squash") as MergeMethod;
  const deleteBranch = preferences.deleteBranchOnMerge === true;
  const canMerge =
    pullRequest.status !== "merged" && pullRequest.status !== "closed";

  async function runMerge(options: { auto: boolean }) {
    if (options.auto) {
      const enabled = await confirmAlert({
        title: `Enable auto-merge for #${pullRequest.number}?`,
        message: `${pullRequest.title}\nWill ${mergeMethod} into ${pullRequest.targetBranch} once requirements pass.`,
        primaryAction: { title: "Enable Auto-Merge" },
        icon: Icon.Clock,
      });
      if (!enabled) {
        return;
      }
    } else {
      const confirmed = await confirmAlert({
        title: `Merge #${pullRequest.number} now?`,
        message: `${pullRequest.title}\n${pullRequest.sourceBranch} into ${pullRequest.targetBranch} (${mergeMethod}).`,
        primaryAction: {
          title: "Merge Pull Request",
          style: Alert.ActionStyle.Destructive,
        },
        icon: Icon.Checkmark,
      });
      if (!confirmed) {
        return;
      }
    }

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: options.auto ? "Enabling auto-merge…" : "Merging pull request…",
    });

    try {
      await mergePullRequest(pullRequest.url, mergeMethod, {
        auto: options.auto,
        deleteBranch,
      });
      toast.style = Toast.Style.Success;
      toast.title = options.auto ? "Auto-merge enabled" : "Pull request merged";
      reloadFromDb();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = options.auto ? "Auto-merge failed" : "Merge failed";
      toast.message = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <List.Item
      icon={statusIcon(pullRequest)}
      title={pullRequest.title}
      subtitle={`#${pullRequest.number} · ${pullRequest.sourceBranch} → ${pullRequest.targetBranch}`}
      keywords={[
        pullRequest.sourceBranch,
        pullRequest.targetBranch,
        repo ?? "",
        pullRequest.status,
        pullRequest.mergeStatus,
      ]}
      accessories={buildAccessories(pullRequest, repo)}
      actions={
        <ActionPanel>
          {pullRequest.linearUrl ? (
            <Action
              title="Open in Linear App"
              icon={Icon.AppWindow}
              shortcut={Keyboard.Shortcut.Common.Open}
              onAction={async () => {
                await open(
                  toLinearAppUrl(pullRequest.linearUrl ?? pullRequest.url),
                );
              }}
            />
          ) : null}
          {pullRequest.linearUrl ? (
            <Action.OpenInBrowser
              title="Open in Browser"
              url={pullRequest.linearUrl}
              icon={Icon.Globe}
            />
          ) : null}
          <Action.OpenInBrowser
            title="Open Pull Request"
            url={pullRequest.url}
            icon={Icon.Globe}
          />
          {canMerge ? (
            <Action
              title="Merge Pull Request"
              icon={Icon.Checkmark}
              style={Action.Style.Destructive}
              shortcut={{ modifiers: ["cmd", "shift"], key: "m" }}
              onAction={() => runMerge({ auto: false })}
            />
          ) : null}
          {canMerge ? (
            <Action
              title="Enable Auto-Merge"
              icon={Icon.Clock}
              shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
              onAction={() => runMerge({ auto: true })}
            />
          ) : null}
          {failingChecks.map((check) =>
            check.url ? (
              <Action.OpenInBrowser
                key={`${pullRequest.id}-${check.name}`}
                title={`Open Failing Check: ${check.name}`}
                url={check.url}
                icon={Icon.XMarkCircle}
              />
            ) : null,
          )}
          <Action.CopyToClipboard
            title="Copy Pull Request URL"
            content={pullRequest.url}
          />
          <Action.CopyToClipboard
            title="Copy Source Branch"
            content={pullRequest.sourceBranch}
          />
          <Action
            title="Mark Linear Notification Read"
            icon={Icon.CheckCircle}
            shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
            onAction={async () => {
              await markPullRequestRead(preferences.linearApiKey, pullRequest);
              reloadFromDb();
            }}
          />
          <Action
            title="Reload from SQLite"
            icon={Icon.RotateClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={reloadFromDb}
          />
          <Action
            title="Start Sidecar"
            icon={Icon.Play}
            onAction={async () => {
              await startSidecar();
              reloadFromDb();
            }}
          />
        </ActionPanel>
      }
    />
  );
}

function filterPullRequests(
  pullRequests: ReviewPullRequest[],
  filter: StatusFilter,
) {
  if (filter === "all") {
    return pullRequests.filter(
      (pullRequest) => pullRequest.status !== "merged",
    );
  }
  if (filter === "failing") {
    return pullRequests.filter((pullRequest) =>
      pullRequest.checks.some(isFailingCheck),
    );
  }
  if (filter === "unread") {
    return pullRequests.filter((pullRequest) => pullRequest.unread);
  }
  return pullRequests.filter((pullRequest) => pullRequest.status === filter);
}

function buildAccessories(
  pullRequest: ReviewPullRequest,
  repo: string | undefined,
): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];

  if (pullRequest.unread) {
    accessories.push({
      icon: { source: Icon.Dot, tintColor: Color.Blue },
      tooltip: "Unread",
    });
  }

  if (repo) {
    accessories.push({ text: repo, tooltip: `Repository: ${repo}` });
  }

  accessories.push(...checkAccessories(pullRequest));

  if (pullRequest.mergeStatus) {
    accessories.push(mergeStatusAccessory(pullRequest.mergeStatus));
  }

  accessories.push({
    tag: {
      value: formatStatus(pullRequest.status),
      color: statusColor(pullRequest.status),
    },
    tooltip: `Status: ${formatStatus(pullRequest.status)}`,
  });

  return accessories;
}

function checkAccessories(
  pullRequest: ReviewPullRequest,
): List.Item.Accessory[] {
  const total = pullRequest.checks.length;
  if (!total) {
    return [];
  }

  const failing = pullRequest.checks.filter(isFailingCheck);
  const pending = pullRequest.checks.filter(isPendingCheck);
  const passing = total - failing.length - pending.length;
  const accessories: List.Item.Accessory[] = [];

  if (passing > 0) {
    accessories.push({
      icon: { source: Icon.CheckCircle, tintColor: Color.Green },
      text: { value: String(passing), color: Color.Green },
      tooltip: `${passing} of ${total} checks passing`,
    });
  }

  if (pending.length) {
    accessories.push({
      icon: { source: Icon.Clock, tintColor: Color.Yellow },
      text: { value: String(pending.length), color: Color.Yellow },
      tooltip: `Pending: ${pending.map(formatCheckName).join(", ")}`,
    });
  }

  if (failing.length) {
    accessories.push({
      icon: { source: Icon.XMarkCircle, tintColor: Color.Red },
      text: {
        value:
          failing.length === 1
            ? formatCheckName(failing[0])
            : String(failing.length),
        color: Color.Red,
      },
      tooltip: `Failing: ${failing.map(formatCheckName).join(", ")}`,
    });
  }

  return accessories;
}

function mergeStatusAccessory(mergeStatus: string): List.Item.Accessory {
  const value = mergeStatus.toLowerCase();
  let color: Color = Color.SecondaryText;
  let label = formatStatus(mergeStatus);

  if (value.includes("conflict") || value.includes("dirty")) {
    color = Color.Red;
    label = "Conflict";
  } else if (value.includes("block")) {
    color = Color.Orange;
  } else if (
    value.includes("ready") ||
    value.includes("clean") ||
    value.includes("mergeable") ||
    value.includes("unblocked")
  ) {
    color = Color.Green;
  } else if (
    value.includes("behind") ||
    value.includes("unstable") ||
    value.includes("pending")
  ) {
    color = Color.Yellow;
  }

  return { tag: { value: label, color }, tooltip: `Merge: ${mergeStatus}` };
}

function statusColor(status: ReviewPullRequest["status"]): Color {
  switch (status) {
    case "approved":
      return Color.Green;
    case "merged":
      return Color.Purple;
    case "inReview":
      return Color.Blue;
    case "draft":
    case "closed":
      return Color.SecondaryText;
    case "open":
    default:
      return Color.PrimaryText;
  }
}

function formatCheckName(check: ReviewPullRequest["checks"][number]) {
  return check.workflowName && check.workflowName !== check.name
    ? `${check.workflowName} / ${check.name}`
    : check.name;
}

function statusIcon(pullRequest: ReviewPullRequest) {
  if (pullRequest.checks.some(isFailingCheck)) {
    return { source: Icon.XMarkCircle, tintColor: Color.Red };
  }

  switch (pullRequest.status) {
    case "approved":
      return { source: Icon.CheckCircle, tintColor: Color.Green };
    case "merged":
      return { source: Icon.ArrowNe, tintColor: Color.Purple };
    case "closed":
      return { source: Icon.XMarkCircle, tintColor: Color.SecondaryText };
    case "draft":
      return { source: Icon.Pencil, tintColor: Color.SecondaryText };
    case "inReview":
      return { source: Icon.Eye, tintColor: Color.Blue };
    case "open":
    default:
      return { source: Icon.CodeBlock, tintColor: Color.PrimaryText };
  }
}

function isFailingCheck(check: ReviewPullRequest["checks"][number]) {
  const status = check.status?.toLowerCase() ?? "";
  return [
    "failure",
    "failed",
    "error",
    "cancelled",
    "timed_out",
    "action_required",
  ].some((failure) => status.includes(failure));
}

function isPendingCheck(check: ReviewPullRequest["checks"][number]) {
  const status = check.status?.toLowerCase() ?? "";
  return ["queued", "pending", "in_progress", "waiting", "requested"].some(
    (pending) => status.includes(pending),
  );
}

function formatStatus(status: ReviewPullRequest["status"]) {
  return status
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function getRepositoryName(url: string) {
  try {
    const parsed = new URL(url);
    const [, owner, repository] = parsed.pathname.split("/");
    return owner && repository ? `${owner}/${repository}` : undefined;
  } catch {
    return undefined;
  }
}

function toLinearAppUrl(url: string) {
  return url.replace(/^https?:\/\//, "linear://");
}
