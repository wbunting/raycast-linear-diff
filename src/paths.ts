import { homedir } from "node:os";
import { join } from "node:path";

export const SIDECAR_DIR = join(homedir(), ".linear-diffs-raycast");
export const DB_PATH = join(SIDECAR_DIR, "linear-diffs.sqlite");
export const CONFIG_PATH = join(SIDECAR_DIR, "config.json");
export const LOG_PATH = join(SIDECAR_DIR, "sidecar.log");
export const PID_PATH = join(SIDECAR_DIR, "sidecar.pid");
