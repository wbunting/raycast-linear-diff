import { githubAuth } from "./auth";

const GITHUB_API = "https://api.github.com";

export type MergeMethod = "squash" | "merge" | "rebase";

type PullRequestRef = {
  owner: string;
  repo: string;
  number: number;
};

function parsePullRequestUrl(url: string): PullRequestRef {
  const match = new URL(url).pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) {
    throw new Error(`Not a GitHub pull request URL: ${url}`);
  }
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

async function githubHeaders(): Promise<Record<string, string>> {
  const token = await githubAuth.authorize();
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function githubRequest<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method: options.method ?? "GET",
    headers: await githubHeaders(),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    throw new Error(await formatGitHubError(response));
  }

  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}

async function githubGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${GITHUB_API}/graphql`, {
    method: "POST",
    headers: await githubHeaders(),
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(await formatGitHubError(response));
  }

  const payload = (await response.json()) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (payload.errors?.length) {
    throw new Error(payload.errors[0].message);
  }
  if (!payload.data) {
    throw new Error("GitHub returned no data.");
  }
  return payload.data;
}

async function formatGitHubError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: string };
    if (payload.message) {
      return payload.message;
    }
  } catch {
    // Fall through to the status-based message.
  }
  return `GitHub request failed: ${response.status}`;
}

const ENABLE_AUTO_MERGE_MUTATION = `
  mutation EnableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
    enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod }) {
      clientMutationId
    }
  }
`;

export async function mergePullRequest(
  url: string,
  method: MergeMethod,
  options: {
    auto?: boolean;
    deleteBranch?: boolean;
    sourceBranch?: string;
  } = {},
): Promise<void> {
  const ref = parsePullRequestUrl(url);

  if (options.auto) {
    // Auto-merge is GraphQL-only and needs the PR node id. Branch deletion is
    // governed by the repository's "delete branch on merge" setting.
    const { node_id } = await githubRequest<{ node_id: string }>(
      `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`,
    );
    await githubGraphQL(ENABLE_AUTO_MERGE_MUTATION, {
      pullRequestId: node_id,
      mergeMethod: method.toUpperCase(),
    });
    return;
  }

  await githubRequest(
    `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/merge`,
    { method: "PUT", body: { merge_method: method } },
  );

  if (options.deleteBranch && options.sourceBranch) {
    await deleteBranch(ref, options.sourceBranch);
  }
}

export async function closePullRequest(
  url: string,
  options: { deleteBranch?: boolean; sourceBranch?: string } = {},
): Promise<void> {
  const ref = parsePullRequestUrl(url);

  await githubRequest(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`, {
    method: "PATCH",
    body: { state: "closed" },
  });

  if (options.deleteBranch && options.sourceBranch) {
    await deleteBranch(ref, options.sourceBranch);
  }
}

async function deleteBranch(ref: PullRequestRef, branch: string) {
  try {
    await githubRequest(
      `/repos/${ref.owner}/${ref.repo}/git/refs/heads/${encodeURIComponent(branch)}`,
      { method: "DELETE" },
    );
  } catch {
    // Best-effort: the branch may already be gone, protected, or live on a
    // fork. The merge/close itself succeeded, so don't surface this.
  }
}
