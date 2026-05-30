import { startSidecar } from "./sidecar";

export default async function Command() {
  await startSidecar();
}
