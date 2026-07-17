import {
  Action,
  ActionPanel,
  Color,
  Icon,
  Keyboard,
  List,
  Toast,
  getPreferenceValues,
  open,
  showToast,
} from "@raycast/api";
import { withAccessToken } from "@raycast/utils";
import { useEffect, useState } from "react";
import { linearAuth } from "./auth";
import { readReviewInboxFromDb, setPullRequestStatusInDb } from "./db";
import { SIDECAR_ENABLED } from "./flags";
import { closePullRequest, mergePullRequest, MergeMethod } from "./github";
import {
  fetchAndCacheReviewInbox,
  getCachedReviewInbox,
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

function Command() {
  const preferences = getPreferenceValues<Preferences>();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [data, setData] = useState<ReviewInbox | undefined>(() =>
    SIDECAR_ENABLED ? readReviewInboxFromDb() : getCachedReviewInbox(),
  );
  const [isLoading, setIsLoading] = useState(!SIDECAR_ENABLED);
  const [sidecarRunning, setSidecarRunning] = useState(
    () => SIDECAR_ENABLED && isSidecarRunning(),
  );
  const [showingDetail, setShowingDetail] = useState(false);

  function reloadFromDb() {
    setData(readReviewInboxFromDb());
    setSidecarRunning(isSidecarRunning());
  }

  async function refreshFromLinear() {
    setIsLoading(true);
    try {
      setData(await fetchAndCacheReviewInbox(preferences));
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to refresh from Linear",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLoading(false);
    }
  }

  function reload() {
    if (SIDECAR_ENABLED) {
      reloadFromDb();
    } else {
      refreshFromLinear();
    }
  }

  // Optimistically reflect a local action (merge/close) so the list updates
  // immediately; the next sync overwrites it with authoritative state.
  function applyStatus(id: string, status: ReviewPullRequest["status"]) {
    if (SIDECAR_ENABLED) {
      setPullRequestStatusInDb(id, status);
      reloadFromDb();
      return;
    }
    setData(
      (current) =>
        current && {
          ...current,
          pullRequests: current.pullRequests.map((pullRequest) =>
            pullRequest.id === id ? { ...pullRequest, status } : pullRequest,
          ),
        },
    );
  }

  useEffect(() => {
    if (!SIDECAR_ENABLED) {
      refreshFromLinear();
      return;
    }
    const interval = setInterval(reloadFromDb, 2_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={showingDetail}
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
            !SIDECAR_ENABLED || sidecarRunning
              ? "No Linear Diffs PRs found"
              : "Linear Diffs sidecar is not running"
          }
          description={
            !SIDECAR_ENABLED
              ? "Pull requests from your Linear review notifications show up here."
              : sidecarRunning
                ? "Waiting for the local SQLite database to receive synced PRs."
                : "Start the sidecar to poll Linear every minute and populate SQLite."
          }
          actions={
            <ActionPanel>
              {SIDECAR_ENABLED ? (
                <Action
                  title="Start Sidecar"
                  icon={Icon.Play}
                  onAction={async () => {
                    await startSidecar();
                    reloadFromDb();
                  }}
                />
              ) : null}
              <Action
                title="Refresh"
                icon={Icon.RotateClockwise}
                onAction={reload}
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
              reload={reload}
              applyStatus={applyStatus}
              showingDetail={showingDetail}
              onToggleDetail={() => setShowingDetail((current) => !current)}
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
  reload,
  applyStatus,
  showingDetail,
  onToggleDetail,
}: {
  pullRequest: ReviewPullRequest;
  preferences: Preferences;
  reload: () => void;
  applyStatus: (id: string, status: ReviewPullRequest["status"]) => void;
  showingDetail: boolean;
  onToggleDetail: () => void;
}) {
  const failingChecks = pullRequest.checks.filter(isFailingCheck);
  const repo = getRepositoryName(pullRequest.url);

  const mergeMethod = (preferences.mergeMethod ?? "squash") as MergeMethod;
  const deleteBranch = preferences.deleteBranchOnMerge === true;
  const canMerge =
    pullRequest.status !== "merged" && pullRequest.status !== "closed";

  async function runMerge(options: { auto: boolean }) {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: options.auto ? "Enabling auto-merge…" : "Merging pull request…",
    });

    try {
      await mergePullRequest(pullRequest.url, mergeMethod, {
        auto: options.auto,
        deleteBranch,
        sourceBranch: pullRequest.sourceBranch,
      });
      toast.style = Toast.Style.Success;
      toast.title = options.auto ? "Auto-merge enabled" : "Pull request merged";
      if (!options.auto) {
        applyStatus(pullRequest.id, "merged");
      }
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = options.auto ? "Auto-merge failed" : "Merge failed";
      toast.message = error instanceof Error ? error.message : String(error);
    }
  }

  async function runClose() {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Closing pull request…",
    });

    try {
      await closePullRequest(pullRequest.url, {
        deleteBranch,
        sourceBranch: pullRequest.sourceBranch,
      });
      toast.style = Toast.Style.Success;
      toast.title = "Pull request closed";
      applyStatus(pullRequest.id, "closed");
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Close failed";
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
      accessories={
        showingDetail ? undefined : buildAccessories(pullRequest, repo)
      }
      detail={
        showingDetail ? (
          <List.Item.Detail
            markdown={buildDetailMarkdown(pullRequest)}
            metadata={
              <List.Item.Detail.Metadata>
                <List.Item.Detail.Metadata.Label
                  title="Status"
                  text={formatStatus(pullRequest.status)}
                  icon={statusIcon(pullRequest)}
                />
                <List.Item.Detail.Metadata.TagList title="Merge">
                  <List.Item.Detail.Metadata.TagList.Item
                    text={
                      mergeStatusAccessory(pullRequest.mergeStatus).tag
                        ?.value as string
                    }
                    color={
                      mergeStatusAccessory(pullRequest.mergeStatus).tag?.color
                    }
                  />
                </List.Item.Detail.Metadata.TagList>
                <List.Item.Detail.Metadata.Label
                  title="Checks"
                  text={formatChecksSummary(pullRequest)}
                />
                <List.Item.Detail.Metadata.Separator />
                <List.Item.Detail.Metadata.Label
                  title="Repository"
                  text={repo ?? "Unknown"}
                />
                <List.Item.Detail.Metadata.Label
                  title="Source"
                  text={pullRequest.sourceBranch}
                />
                <List.Item.Detail.Metadata.Label
                  title="Target"
                  text={pullRequest.targetBranch}
                />
                {pullRequest.creator?.name ? (
                  <List.Item.Detail.Metadata.Label
                    title="Author"
                    text={pullRequest.creator.name}
                  />
                ) : null}
                <List.Item.Detail.Metadata.Label
                  title="Updated"
                  text={new Date(pullRequest.updatedAt).toLocaleString()}
                />
              </List.Item.Detail.Metadata>
            }
          />
        ) : undefined
      }
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
          <Action
            title={showingDetail ? "Hide Details" : "Show Details"}
            icon={Icon.Sidebar}
            shortcut={{ modifiers: ["cmd"], key: "d" }}
            onAction={onToggleDetail}
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
          {canMerge ? (
            <Action
              title="Close Pull Request"
              icon={Icon.XMarkCircle}
              style={Action.Style.Destructive}
              shortcut={{ modifiers: ["cmd", "shift"], key: "x" }}
              onAction={runClose}
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
              await markPullRequestRead(pullRequest);
              reload();
            }}
          />
          <Action
            title="Refresh"
            icon={Icon.RotateClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={reload}
          />
          {SIDECAR_ENABLED ? (
            <Action
              title="Start Sidecar"
              icon={Icon.Play}
              onAction={async () => {
                await startSidecar();
                reload();
              }}
            />
          ) : null}
        </ActionPanel>
      }
    />
  );
}

export default withAccessToken(linearAuth)(Command);

function filterPullRequests(
  pullRequests: ReviewPullRequest[],
  filter: StatusFilter,
) {
  if (filter === "all") {
    return pullRequests.filter(
      (pullRequest) =>
        pullRequest.status !== "merged" && pullRequest.status !== "closed",
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

function mergeStatusAccessory(mergeStatus: string): {
  tag: { value: string; color: Color };
  tooltip: string;
} {
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

function buildDetailMarkdown(pullRequest: ReviewPullRequest): string {
  const failing = pullRequest.checks.filter(isFailingCheck);
  const pending = pullRequest.checks.filter(isPendingCheck);
  const passing = pullRequest.checks.filter(
    (check) => !isFailingCheck(check) && !isPendingCheck(check),
  );

  const sections = [
    `# ${pullRequest.title}`,
    pullRequest.notificationSubtitle
      ? `_${pullRequest.notificationSubtitle}_`
      : undefined,
    `\`${pullRequest.sourceBranch}\` → \`${pullRequest.targetBranch}\``,
    `Status: **${formatStatus(pullRequest.status)}**  ·  Merge: **${pullRequest.mergeStatus}**`,
  ];

  const checkList = (checks: ReviewPullRequest["checks"], mark: string) =>
    checks
      .map(
        (check) =>
          `- ${mark} ${formatCheckName(check)} — ${check.status ?? "unknown"}`,
      )
      .join("\n");

  if (failing.length) {
    sections.push(
      `## ❌ Failing (${failing.length})\n${checkList(failing, "❌")}`,
    );
  }
  if (pending.length) {
    sections.push(
      `## ⏳ Pending (${pending.length})\n${checkList(pending, "⏳")}`,
    );
  }
  if (passing.length) {
    sections.push(
      `## ✅ Passing (${passing.length})\n${checkList(passing, "✅")}`,
    );
  }
  if (!pullRequest.checks.length) {
    sections.push("_No checks reported._");
  }

  return sections.filter(Boolean).join("\n\n");
}

function formatChecksSummary(pullRequest: ReviewPullRequest): string {
  const total = pullRequest.checks.length;
  if (!total) {
    return "No checks";
  }
  const failing = pullRequest.checks.filter(isFailingCheck).length;
  const pending = pullRequest.checks.filter(isPendingCheck).length;
  const passing = total - failing - pending;
  return [
    `${passing}/${total} passing`,
    failing ? `${failing} failing` : undefined,
    pending ? `${pending} pending` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
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

function formatStatus(status: string) {
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
