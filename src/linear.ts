import { environment, showToast, Toast } from "@raycast/api";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getLinearAuthorizationHeader } from "./auth";

const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";
const REVIEW_INBOX_CACHE_PATH = join(
  environment.supportPath,
  "review-inbox-v1.json",
);

export type Preferences = {
  linearApiKey?: string;
  pageSize?: string;
  includeRead?: boolean;
  mergeMethod?: "squash" | "merge" | "rebase";
  deleteBranchOnMerge?: boolean;
};

type GraphQLError = {
  message: string;
  extensions?: {
    userPresentableMessage?: string;
    code?: string;
  };
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: GraphQLError[];
};

type Viewer = {
  id: string;
  name: string;
  email?: string | null;
  hasGitHubCodeAccess?: boolean | null;
};

type PullRequestCheck = {
  name: string;
  workflowName?: string | null;
  status?: string | null;
  url?: string | null;
  isRequired?: boolean | null;
};

type PullRequest = {
  id: string;
  title: string;
  number: number;
  sourceBranch: string;
  targetBranch: string;
  headSha?: string | null;
  url: string;
  status: "draft" | "open" | "inReview" | "approved" | "merged" | "closed";
  mergeStatus: string;
  openedAt: string;
  updatedAt: string;
  checks: PullRequestCheck[];
  creator?: {
    name: string;
    email?: string | null;
  } | null;
};

type PullRequestNotification = {
  id: string;
  type: string;
  title: string;
  subtitle?: string | null;
  url?: string | null;
  inboxUrl?: string | null;
  readAt?: string | null;
  createdAt: string;
  updatedAt: string;
  pullRequestId?: string | null;
  pullRequest?: PullRequest | null;
};

type PageInfo = {
  hasNextPage: boolean;
  endCursor?: string | null;
};

export type ReviewPullRequest = PullRequest & {
  linearUrl?: string;
  inboxUrl?: string;
  notificationIds: string[];
  notificationTitle?: string;
  notificationSubtitle?: string | null;
  lastNotificationAt: string;
  unread: boolean;
};

export type ReviewInbox = {
  viewer: Viewer;
  pullRequests: ReviewPullRequest[];
  syncedAt?: string;
};

const REVIEW_INBOX_QUERY = `
  query LinearDiffReviewInbox($first: Int!, $after: String) {
    viewer {
      id
      name
      email
      hasGitHubCodeAccess
    }
    notifications(first: $first, after: $after, orderBy: updatedAt, includeArchived: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        type
        title
        subtitle
        url
        inboxUrl
        readAt
        createdAt
        updatedAt
        ... on PullRequestNotification {
          pullRequestId
          pullRequest {
            id
            title
            number
            sourceBranch
            targetBranch
            headSha
            url
            status
            mergeStatus
            openedAt
            updatedAt
            checks {
              name
              workflowName
              status
              url
              isRequired
            }
            creator {
              name
              email
            }
          }
        }
      }
    }
  }
`;

const MARK_NOTIFICATION_READ_MUTATION = `
  mutation MarkNotificationRead($id: String!, $readAt: DateTime!) {
    notificationUpdate(id: $id, input: { readAt: $readAt }) {
      success
    }
  }
`;

export function getPageSize(preferences: Preferences): number {
  const pageSize = Number.parseInt(preferences.pageSize ?? "100", 10);
  if (Number.isNaN(pageSize)) {
    return 100;
  }
  return Math.min(Math.max(pageSize, 25), 1000);
}

export async function fetchReviewInbox(
  preferences: Preferences,
): Promise<ReviewInbox> {
  const notifications: PullRequestNotification[] = [];
  let viewer: Viewer | undefined;
  let after: string | undefined;
  let remaining = getPageSize(preferences);

  while (remaining > 0) {
    const first = Math.min(remaining, 250);
    const data = await linearRequest<{
      viewer: Viewer;
      notifications: {
        pageInfo: PageInfo;
        nodes: PullRequestNotification[];
      };
    }>(getLinearAuthorizationHeader(), REVIEW_INBOX_QUERY, {
      first,
      after,
    });

    viewer = data.viewer;
    notifications.push(...data.notifications.nodes);
    remaining -= first;

    if (
      !data.notifications.pageInfo.hasNextPage ||
      !data.notifications.pageInfo.endCursor
    ) {
      break;
    }

    after = data.notifications.pageInfo.endCursor;
  }

  return {
    viewer: viewer ?? { id: "", name: "" },
    pullRequests: dedupePullRequests(
      notifications,
      preferences.includeRead !== false,
    ),
  };
}

export async function fetchAndCacheReviewInbox(
  preferences: Preferences,
): Promise<ReviewInbox> {
  const inbox = await fetchReviewInbox(preferences);
  const syncedInbox = { ...inbox, syncedAt: new Date().toISOString() };
  if (!existsSync(environment.supportPath)) {
    mkdirSync(environment.supportPath, { recursive: true });
  }
  writeFileSync(REVIEW_INBOX_CACHE_PATH, JSON.stringify(syncedInbox));
  return syncedInbox;
}

export function getCachedReviewInbox(): ReviewInbox | undefined {
  if (!existsSync(REVIEW_INBOX_CACHE_PATH)) {
    return undefined;
  }

  try {
    return JSON.parse(
      readFileSync(REVIEW_INBOX_CACHE_PATH, "utf8"),
    ) as ReviewInbox;
  } catch {
    return undefined;
  }
}

export async function markPullRequestRead(
  pullRequest: ReviewPullRequest,
): Promise<void> {
  const readAt = new Date().toISOString();
  const authorization = getLinearAuthorizationHeader();

  await Promise.all(
    pullRequest.notificationIds.map((id) =>
      linearRequest(authorization, MARK_NOTIFICATION_READ_MUTATION, {
        id,
        readAt,
      }),
    ),
  );

  await showToast({ style: Toast.Style.Success, title: "Marked as read" });
}

async function linearRequest<T>(
  authorization: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(LINEAR_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = (await response.json()) as GraphQLResponse<T>;
  if (!response.ok || payload.errors?.length) {
    const error = payload.errors?.[0];
    throw new Error(
      error?.extensions?.userPresentableMessage ??
        error?.message ??
        `Linear request failed: ${response.status}`,
    );
  }

  if (!payload.data) {
    throw new Error("Linear returned no data.");
  }

  return payload.data;
}

function dedupePullRequests(
  notifications: PullRequestNotification[],
  includeRead: boolean,
): ReviewPullRequest[] {
  const pullRequestsById = new Map<string, ReviewPullRequest>();

  for (const notification of notifications) {
    if (!notification.pullRequest || (!includeRead && notification.readAt)) {
      continue;
    }

    const existing = pullRequestsById.get(notification.pullRequest.id);
    if (existing) {
      existing.notificationIds.push(notification.id);
      existing.unread = existing.unread || !notification.readAt;
      if (
        new Date(notification.updatedAt) > new Date(existing.lastNotificationAt)
      ) {
        existing.linearUrl = notification.url ?? existing.linearUrl;
        existing.inboxUrl = notification.inboxUrl ?? existing.inboxUrl;
        existing.notificationTitle = notification.title;
        existing.notificationSubtitle = notification.subtitle;
        existing.lastNotificationAt = notification.updatedAt;
      }
      continue;
    }

    pullRequestsById.set(notification.pullRequest.id, {
      ...notification.pullRequest,
      linearUrl: notification.url ?? notification.inboxUrl ?? undefined,
      inboxUrl: notification.inboxUrl ?? undefined,
      notificationIds: [notification.id],
      notificationTitle: notification.title,
      notificationSubtitle: notification.subtitle,
      lastNotificationAt: notification.updatedAt,
      unread: !notification.readAt,
    });
  }

  return [...pullRequestsById.values()].sort(
    (first, second) =>
      new Date(second.lastNotificationAt).getTime() -
      new Date(first.lastNotificationAt).getTime(),
  );
}
