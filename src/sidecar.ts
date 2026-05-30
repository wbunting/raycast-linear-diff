import {
  environment,
  getPreferenceValues,
  showToast,
  Toast,
} from "@raycast/api";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { CONFIG_PATH, LOG_PATH, PID_PATH, SIDECAR_DIR } from "./paths";
import { Preferences } from "./linear";

type SidecarConfig = {
  linearApiKey: string;
  pageSize: number;
  includeRead: boolean;
  pollIntervalMs: number;
};

export function isSidecarRunning() {
  if (!existsSync(PID_PATH)) {
    return false;
  }

  const pid = Number.parseInt(readFileSync(PID_PATH, "utf8"), 10);
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function startSidecar() {
  const preferences = getPreferenceValues<Preferences>();
  mkdirSync(SIDECAR_DIR, { recursive: true });

  const config: SidecarConfig = {
    linearApiKey: preferences.linearApiKey,
    pageSize: getPageSize(preferences.pageSize),
    includeRead: preferences.includeRead !== false,
    pollIntervalMs: 60_000,
  };

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  chmodSync(CONFIG_PATH, 0o600);

  if (isSidecarRunning()) {
    await showToast({
      style: Toast.Style.Success,
      title: "Linear Diffs sidecar already running",
    });
    return;
  }

  const scriptPath = join(environment.assetsPath, "sidecar.cjs");
  const out = openLogFile();
  const child = spawn(process.execPath, ["--no-warnings", scriptPath], {
    detached: true,
    stdio: ["ignore", out, out],
    env: {
      ...process.env,
      LINEAR_DIFFS_CONFIG: CONFIG_PATH,
    },
  });

  child.unref();
  writeFileSync(PID_PATH, String(child.pid));
  await showToast({
    style: Toast.Style.Success,
    title: "Started Linear Diffs sidecar",
  });
}

function getPageSize(value?: string) {
  const pageSize = Number.parseInt(value ?? "1000", 10);
  if (Number.isNaN(pageSize)) {
    return 1000;
  }
  return Math.min(Math.max(pageSize, 25), 1000);
}

function openLogFile() {
  return openSync(LOG_PATH, "a");
}
