import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Raycast spawns node with a minimal PATH, so locate the `gh` binary in the
// common Homebrew/system locations and prepend them to PATH for the child.
const GH_CANDIDATES = [
  "/opt/homebrew/bin/gh",
  "/usr/local/bin/gh",
  "/usr/bin/gh",
];

const GH_PATH_PREFIX = "/opt/homebrew/bin:/usr/local/bin:/usr/bin";

export type MergeMethod = "squash" | "merge" | "rebase";

function resolveGhPath(): string {
  const gh = GH_CANDIDATES.find((path) => existsSync(path));
  if (!gh) {
    throw new Error(
      "GitHub CLI (gh) not found. Install it with `brew install gh` and run `gh auth login`.",
    );
  }
  return gh;
}

export async function mergePullRequest(
  url: string,
  method: MergeMethod,
  options: { auto?: boolean; deleteBranch?: boolean } = {},
): Promise<void> {
  const gh = resolveGhPath();
  const args = ["pr", "merge", url, `--${method}`];
  if (options.auto) {
    args.push("--auto");
  }
  if (options.deleteBranch) {
    args.push("--delete-branch");
  }

  try {
    await execFileAsync(gh, args, {
      env: {
        ...process.env,
        PATH: `${GH_PATH_PREFIX}:${process.env.PATH ?? ""}`,
      },
    });
  } catch (error) {
    throw new Error(formatGhError(error));
  }
}

export async function closePullRequest(
  url: string,
  options: { deleteBranch?: boolean } = {},
): Promise<void> {
  const gh = resolveGhPath();
  const args = ["pr", "close", url];
  if (options.deleteBranch) {
    args.push("--delete-branch");
  }

  try {
    await execFileAsync(gh, args, {
      env: {
        ...process.env,
        PATH: `${GH_PATH_PREFIX}:${process.env.PATH ?? ""}`,
      },
    });
  } catch (error) {
    throw new Error(formatGhError(error));
  }
}

function formatGhError(error: unknown): string {
  if (error && typeof error === "object") {
    const stderr = (error as { stderr?: string }).stderr;
    if (stderr && stderr.trim()) {
      return stderr.trim();
    }
    const message = (error as { message?: string }).message;
    if (message) {
      return message;
    }
  }
  return "GitHub merge failed.";
}
