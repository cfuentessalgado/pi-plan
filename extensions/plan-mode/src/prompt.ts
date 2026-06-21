import * as fs from "node:fs";
import * as path from "node:path";

const FALLBACK_PLAN_PROMPT = `# Plan Mode

You are in plan mode. You MUST NOT make any changes to the codebase except maintaining the markdown plan file. Do not commit, install, or run destructive commands.

Explore first, write findings into a markdown plan file as you go, ask the user when requirements or tradeoffs cannot be resolved from code, and keep refining the same plan until it is ready for explicit approval.

Plan file convention: PLAN.md, plans/<short-name>.md, or docs/plans/<short-name>.md.

Plan file sections: Context, Approach, Files to modify, Reuse, Steps, Verification.

Your turn should end by asking the user a question or presenting the completed plan for review.`;

export function readPrompt(cwd: string): string {
  for (const candidate of ["prompts/plan.md", "plans/plan.md"]) {
    const fullPath = path.join(cwd, candidate);
    if (fs.existsSync(fullPath)) return fs.readFileSync(fullPath, "utf8");
  }
  return FALLBACK_PLAN_PROMPT;
}
