import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPlanMode } from "./src/extension.ts";

export default function (pi: ExtensionAPI): void {
  registerPlanMode(pi);
}
