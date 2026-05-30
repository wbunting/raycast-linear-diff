import { existsSync } from "node:fs";
import { DB_PATH } from "./paths";
import { ReviewInbox, ReviewPullRequest } from "./linear";

type SqliteDatabase = {
  prepare: (sql: string) => {
    all: () => unknown[];
  };
  close: () => void;
};

// `node:sqlite` is an experimental built-in without published type exports, so
// it is loaded via require() and typed manually.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (
    path: string,
    options?: { readOnly?: boolean; open?: boolean },
  ) => SqliteDatabase;
};

type PullRequestRow = {
  id: string;
  title: string;
  number: number;
  source_branch: string;
  target_branch: string;
  head_sha: string | null;
  url: string;
  status: ReviewPullRequest["status"];
  merge_status: string;
  opened_at: string;
  updated_at: string;
  creator_name: string | null;
  creator_email: string | null;
  linear_url: string | null;
  inbox_url: string | null;
  notification_ids: string;
  notification_title: string | null;
  notification_subtitle: string | null;
  last_notification_at: string;
  unread: number;
};

type CheckRow = {
  pull_request_id: string;
  name: string;
  workflow_name: string | null;
  status: string | null;
  url: string | null;
  is_required: number;
};

type MetadataRow = {
  key: string;
  value: string;
};

export function readReviewInboxFromDb(): ReviewInbox | undefined {
  if (!existsSync(DB_PATH)) {
    return undefined;
  }

  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const pullRequestRows = db
      .prepare("select * from pull_requests order by last_notification_at desc")
      .all() as PullRequestRow[];
    const checkRows = db.prepare("select * from checks").all() as CheckRow[];
    const metadataRows = db
      .prepare("select key, value from metadata")
      .all() as MetadataRow[];
    const checksByPullRequestId = new Map<string, CheckRow[]>();

    for (const check of checkRows) {
      const checks = checksByPullRequestId.get(check.pull_request_id) ?? [];
      checks.push(check);
      checksByPullRequestId.set(check.pull_request_id, checks);
    }

    return {
      viewer: {
        id: getMetadata(metadataRows, "viewer_id") ?? "",
        name: getMetadata(metadataRows, "viewer_name") ?? "",
        email: getMetadata(metadataRows, "viewer_email"),
        hasGitHubCodeAccess:
          getMetadata(metadataRows, "viewer_has_github_code_access") === "true",
      },
      syncedAt: getMetadata(metadataRows, "synced_at"),
      pullRequests: pullRequestRows.map((row) => ({
        id: row.id,
        title: row.title,
        number: row.number,
        sourceBranch: row.source_branch,
        targetBranch: row.target_branch,
        headSha: row.head_sha,
        url: row.url,
        status: row.status,
        mergeStatus: row.merge_status,
        openedAt: row.opened_at,
        updatedAt: row.updated_at,
        checks: (checksByPullRequestId.get(row.id) ?? []).map((check) => ({
          name: check.name,
          workflowName: check.workflow_name,
          status: check.status,
          url: check.url,
          isRequired: Boolean(check.is_required),
        })),
        creator: row.creator_name
          ? {
              name: row.creator_name,
              email: row.creator_email,
            }
          : null,
        linearUrl: row.linear_url ?? undefined,
        inboxUrl: row.inbox_url ?? undefined,
        notificationIds: JSON.parse(row.notification_ids) as string[],
        notificationTitle: row.notification_title ?? undefined,
        notificationSubtitle: row.notification_subtitle,
        lastNotificationAt: row.last_notification_at,
        unread: Boolean(row.unread),
      })),
    };
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

function getMetadata(rows: MetadataRow[], key: string) {
  return rows.find((row) => row.key === key)?.value;
}
