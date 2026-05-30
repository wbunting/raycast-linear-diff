#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const dir = path.join(os.homedir(), ".linear-diffs-raycast");
const dbPath = path.join(dir, "linear-diffs.sqlite");
const pidPath = path.join(dir, "sidecar.pid");
const configPath =
  process.env.LINEAR_DIFFS_CONFIG || path.join(dir, "config.json");

const query = `
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

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(pidPath, String(process.pid));

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
process.on("exit", () => {
  try {
    if (fs.readFileSync(pidPath, "utf8") === String(process.pid)) {
      fs.rmSync(pidPath, { force: true });
    }
  } catch {}
});

main();

async function main() {
  while (true) {
    const config = readConfig();
    try {
      await sync(config);
      console.log(`${new Date().toISOString()} synced Linear Diffs`);
    } catch (error) {
      console.error(`${new Date().toISOString()} sync failed`, error);
    }
    await sleep(config.pollIntervalMs || 60_000);
  }
}

function readConfig() {
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

async function sync(config) {
  const notifications = [];
  let viewer;
  let after;
  let remaining = Math.min(Math.max(config.pageSize || 1000, 25), 1000);

  while (remaining > 0) {
    const first = Math.min(remaining, 250);
    const data = await linearRequest(config.linearApiKey, query, {
      first,
      after,
    });
    viewer = data.viewer;
    notifications.push(...data.notifications.nodes);
    remaining -= first;
    if (
      !data.notifications.pageInfo.hasNextPage ||
      !data.notifications.pageInfo.endCursor
    )
      break;
    after = data.notifications.pageInfo.endCursor;
  }

  const pullRequests = dedupePullRequests(
    notifications,
    config.includeRead !== false,
  );
  writeDb(viewer || { id: "", name: "" }, pullRequests);
}

async function linearRequest(apiKey, query, variables) {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    const error = payload.errors?.[0];
    throw new Error(
      error?.extensions?.userPresentableMessage ||
        error?.message ||
        `Linear request failed: ${response.status}`,
    );
  }
  return payload.data;
}

function dedupePullRequests(notifications, includeRead) {
  const pullRequestsById = new Map();
  for (const notification of notifications) {
    if (!notification.pullRequest || (!includeRead && notification.readAt))
      continue;
    const existing = pullRequestsById.get(notification.pullRequest.id);
    if (existing) {
      existing.notificationIds.push(notification.id);
      existing.unread = existing.unread || !notification.readAt;
      if (
        new Date(notification.updatedAt) > new Date(existing.lastNotificationAt)
      ) {
        existing.linearUrl = notification.url || existing.linearUrl;
        existing.inboxUrl = notification.inboxUrl || existing.inboxUrl;
        existing.notificationTitle = notification.title;
        existing.notificationSubtitle = notification.subtitle;
        existing.lastNotificationAt = notification.updatedAt;
      }
      continue;
    }
    pullRequestsById.set(notification.pullRequest.id, {
      ...notification.pullRequest,
      linearUrl: notification.url || notification.inboxUrl || undefined,
      inboxUrl: notification.inboxUrl || undefined,
      notificationIds: [notification.id],
      notificationTitle: notification.title,
      notificationSubtitle: notification.subtitle,
      lastNotificationAt: notification.updatedAt,
      unread: !notification.readAt,
    });
  }
  return [...pullRequestsById.values()].sort(
    (a, b) => new Date(b.lastNotificationAt) - new Date(a.lastNotificationAt),
  );
}

function writeDb(viewer, pullRequests) {
  const db = new DatabaseSync(dbPath);
  db.exec("pragma journal_mode = WAL");
  db.exec(`
    create table if not exists metadata (key text primary key, value text not null);
    create table if not exists pull_requests (
      id text primary key,
      title text not null,
      number integer not null,
      source_branch text not null,
      target_branch text not null,
      head_sha text,
      url text not null,
      status text not null,
      merge_status text not null,
      opened_at text not null,
      updated_at text not null,
      creator_name text,
      creator_email text,
      linear_url text,
      inbox_url text,
      notification_ids text not null,
      notification_title text,
      notification_subtitle text,
      last_notification_at text not null,
      unread integer not null
    );
    create table if not exists checks (
      pull_request_id text not null,
      name text not null,
      workflow_name text,
      status text,
      url text,
      is_required integer not null
    );
    create index if not exists checks_pull_request_id_idx on checks (pull_request_id);
  `);

  db.exec("begin immediate");
  try {
    db.prepare("delete from pull_requests").run();
    db.prepare("delete from checks").run();
    const upsertMetadata = db.prepare(
      "insert into metadata (key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
    );
    upsertMetadata.run("viewer_id", viewer.id || "");
    upsertMetadata.run("viewer_name", viewer.name || "");
    upsertMetadata.run("viewer_email", viewer.email || "");
    upsertMetadata.run(
      "viewer_has_github_code_access",
      String(Boolean(viewer.hasGitHubCodeAccess)),
    );
    upsertMetadata.run("synced_at", new Date().toISOString());

    const insertPullRequest = db.prepare(`
      insert into pull_requests (
        id, title, number, source_branch, target_branch, head_sha, url, status, merge_status,
        opened_at, updated_at, creator_name, creator_email, linear_url, inbox_url,
        notification_ids, notification_title, notification_subtitle, last_notification_at, unread
      ) values (
        @id, @title, @number, @sourceBranch, @targetBranch, @headSha, @url, @status, @mergeStatus,
        @openedAt, @updatedAt, @creatorName, @creatorEmail, @linearUrl, @inboxUrl,
        @notificationIds, @notificationTitle, @notificationSubtitle, @lastNotificationAt, @unread
      )
    `);
    const insertCheck = db.prepare(`
      insert into checks (pull_request_id, name, workflow_name, status, url, is_required)
      values (@pullRequestId, @name, @workflowName, @status, @url, @isRequired)
    `);

    for (const pullRequest of pullRequests) {
      insertPullRequest.run({
        id: pullRequest.id,
        title: pullRequest.title,
        number: pullRequest.number,
        sourceBranch: pullRequest.sourceBranch,
        targetBranch: pullRequest.targetBranch,
        headSha: pullRequest.headSha || null,
        url: pullRequest.url,
        status: pullRequest.status,
        mergeStatus: pullRequest.mergeStatus,
        openedAt: pullRequest.openedAt,
        updatedAt: pullRequest.updatedAt,
        creatorName: pullRequest.creator?.name || null,
        creatorEmail: pullRequest.creator?.email || null,
        linearUrl: pullRequest.linearUrl || null,
        inboxUrl: pullRequest.inboxUrl || null,
        notificationIds: JSON.stringify(pullRequest.notificationIds),
        notificationTitle: pullRequest.notificationTitle || null,
        notificationSubtitle: pullRequest.notificationSubtitle || null,
        lastNotificationAt: pullRequest.lastNotificationAt,
        unread: pullRequest.unread ? 1 : 0,
      });
      for (const check of pullRequest.checks || []) {
        insertCheck.run({
          pullRequestId: pullRequest.id,
          name: check.name,
          workflowName: check.workflowName || null,
          status: check.status || null,
          url: check.url || null,
          isRequired: check.isRequired ? 1 : 0,
        });
      }
    }
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
  db.close();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
