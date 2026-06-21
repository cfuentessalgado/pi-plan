import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import { isToolCallEventType, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readPrompt } from "./prompt.ts";
import { applyTodoCompletionToMarkdown, extractStepsFromMarkdown, isAllowedPlanPath, isSafeCommand, markCompletedSteps, type TodoItem } from "./utils.ts";

const PLAN_TOOLS = ["read", "bash", "edit", "write", "question", "web_fetch"];
const PROGRESS_TOOL = "plan_done";
type AutocompleteItem = { value: string; label: string };
const STATE_TYPE = "plan-mode-state";

function assistantText(message: AssistantMessage): string {
  return message.content.filter((block): block is TextContent => block.type === "text").map((block) => block.text).join("\n");
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === "assistant" && Array.isArray(message.content);
}

export function registerPlanMode(pi: ExtensionAPI): void {
  let planMode = false;
  let executionMode = false;
  let planFile: string | undefined;
  let todos: TodoItem[] = [];
  let normalTools: string[] | undefined;
  let currentCwd = process.cwd();

  function getPlanPathCompletions(prefix: string): AutocompleteItem[] | null {
    const candidates: string[] = [];
    if (fs.existsSync(path.join(currentCwd, "PLAN.md"))) candidates.push("PLAN.md");
    for (const dir of ["plans", path.join("docs", "plans")]) {
      const fullDir = path.join(currentCwd, dir);
      if (!fs.existsSync(fullDir)) continue;
      for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) candidates.push(path.join(dir, entry.name).replaceAll("\\\\", "/"));
      }
    }
    const filtered = candidates.sort().filter((value) => value.startsWith(prefix.trim()));
    return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
  }

  function persist(): void {
    pi.appendEntry(STATE_TYPE, { planMode, executionMode, planFile, todos });
  }

  function updatePlanFile(ctx: ExtensionContext): void {
    if (!planFile) return;
    const fullPath = path.resolve(ctx.cwd, planFile);
    if (!isAllowedPlanPath(planFile, ctx.cwd) || !fs.existsSync(fullPath)) return;
    const markdown = fs.readFileSync(fullPath, "utf8");
    const updated = applyTodoCompletionToMarkdown(markdown, todos);
    if (updated !== markdown) fs.writeFileSync(fullPath, updated);
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (executionMode && todos.length > 0) {
      const done = todos.filter((todo) => todo.completed).length;
      ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${done}/${todos.length}`));
      ctx.ui.setWidget(
        "plan-todos",
        todos.map((todo) => todo.completed ? `\u001b[2;32m☑ ${todo.text}\u001b[0m` : `\u001b[1m☐ ${todo.text}\u001b[0m`),
      );
    } else if (planMode) {
      ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
      ctx.ui.setWidget("plan-todos", undefined);
    } else {
      ctx.ui.setStatus("plan-mode", undefined);
      ctx.ui.setWidget("plan-todos", undefined);
    }
  }

  function getExecutionTools(): string[] {
    const tools = normalTools ?? pi.getAllTools().map((tool) => tool.name);
    return [...new Set([...tools, PROGRESS_TOOL])];
  }

  function enablePlan(ctx: ExtensionContext): void {
    normalTools ??= pi.getAllTools().map((tool) => tool.name).filter((name) => name !== PROGRESS_TOOL);
    planMode = true;
    executionMode = false;
    todos = [];
    pi.setActiveTools(PLAN_TOOLS);
    ctx.ui.notify("Plan mode enabled. Code/config edits are blocked; only plan markdown may be updated.", "info");
    updateStatus(ctx);
    persist();
  }

  function disablePlan(ctx: ExtensionContext): void {
    planMode = false;
    executionMode = false;
    if (normalTools) pi.setActiveTools(normalTools);
    ctx.ui.notify("Plan mode disabled.", "info");
    updateStatus(ctx);
    persist();
  }

  pi.registerTool<{ step: number; note?: string }>({
    name: PROGRESS_TOOL,
    label: "Plan Done",
    description: "Mark an approved plan checklist step complete and update the plan todo widget immediately.",
    promptSnippet: "Mark an approved plan checklist step complete after finishing it",
    promptGuidelines: [
      "Use plan_done immediately after completing each approved-plan checklist step; pass the completed step number.",
    ],
    parameters: {
      type: "object",
      properties: {
        step: { type: "number", description: "The approved plan step number that was completed." },
        note: { type: "string", description: "Optional brief note about what was completed." },
      },
      required: ["step"],
      additionalProperties: false,
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!executionMode) {
        return { content: [{ type: "text", text: "plan_done is only available while executing an approved plan." }] };
      }
      const step = Number(params.step);
      if (!Number.isInteger(step) || step < 1 || step > todos.length) {
        return { content: [{ type: "text", text: `Invalid plan step ${params.step}. Valid steps are 1-${todos.length}.` }] };
      }
      const todo = todos.find((item) => item.step === step);
      if (!todo) {
        return { content: [{ type: "text", text: `Plan step ${step} was not found.` }] };
      }
      if (!todo.completed) todo.completed = true;
      updatePlanFile(ctx);
      updateStatus(ctx);
      persist();
      const done = todos.filter((item) => item.completed).length;
      const note = params.note ? ` Note: ${params.note}` : "";
      return {
        content: [{ type: "text", text: `Marked plan step ${step} complete (${done}/${todos.length}).${note}` }],
        details: { step, completed: true, done, total: todos.length, todos },
      };
    },
  });

  pi.registerCommand("plan", {
    description: "Toggle persistent plan mode; optional text seeds the planning prompt",
    handler: async (args, ctx) => {
      if (planMode) disablePlan(ctx); else enablePlan(ctx);
      const seed = args.trim();
      if (planMode && seed) pi.sendUserMessage(seed);
    },
  });

  async function startExecution(args: string, ctx: ExtensionContext, mode: "approve" | "resume"): Promise<void> {
    const requested = args.trim() || planFile;
    const command = mode === "resume" ? "plan-resume" : "plan-approve";
    if (!requested) { ctx.ui.notify(`No plan file known. Pass one: /${command} plans/example.md`, "error"); return; }
    if (!isAllowedPlanPath(requested, ctx.cwd)) { ctx.ui.notify(`Not an allowed plan path: ${requested}`, "error"); return; }
    const fullPath = path.resolve(ctx.cwd, requested);
    if (!fs.existsSync(fullPath)) { ctx.ui.notify(`Plan file does not exist: ${requested}`, "error"); return; }
    planFile = path.relative(ctx.cwd, fullPath);
    todos = extractStepsFromMarkdown(fs.readFileSync(fullPath, "utf8"));
    planMode = false;
    executionMode = true;
    pi.setActiveTools(getExecutionTools());
    updateStatus(ctx);
    persist();
    const done = todos.filter((todo) => todo.completed).length;
    const action = mode === "resume" ? "Resuming" : "The plan in";
    const prefix = mode === "resume" ? `${action} the plan in ${planFile}` : `${action} ${planFile} is approved`;
    pi.sendUserMessage(`${prefix} (${done}/${todos.length} complete). Execute it step by step. After completing each step, call ${PROGRESS_TOOL} immediately with that step number so the todo widget updates live. If ${PROGRESS_TOOL} is unavailable, mark completion with [DONE:n].`);
  }

  pi.registerCommand("plan-approve", {
    description: "Approve the current plan file and enter execution mode",
    getArgumentCompletions: getPlanPathCompletions,
    handler: async (args, ctx) => startExecution(args, ctx, "approve"),
  });

  pi.registerCommand("plan-complete", {
    description: "Complete the active approved plan and clear its todo UI once all steps are checked",
    handler: async (_args, ctx) => {
      if (!executionMode) {
        ctx.ui.notify("No active approved plan to complete.", "info");
        return;
      }
      const remaining = todos.filter((todo) => !todo.completed).length;
      if (remaining > 0) {
        ctx.ui.notify(`Cannot complete plan yet: ${remaining} todo${remaining === 1 ? "" : "s"} still incomplete.`, "warning");
        return;
      }
      executionMode = false;
      if (normalTools) pi.setActiveTools(normalTools);
      updateStatus(ctx);
      persist();
      ctx.ui.notify("Plan completed. Cleared active plan todos.", "success");
    },
  });

  pi.registerCommand("plan-resume", {
    description: "Resume an approved plan from its checked checklist state",
    getArgumentCompletions: getPlanPathCompletions,
    handler: async (args, ctx) => startExecution(args, ctx, "resume"),
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!planMode) return;
    if (event.toolName === "bash" && !isSafeCommand(String(event.input.command ?? ""))) {
      return { block: true, reason: "Plan mode blocks destructive or non-allowlisted bash commands." };
    }
    if (isToolCallEventType("edit", event) || isToolCallEventType("write", event)) {
      const target = String(event.input.path ?? "");
      if (!isAllowedPlanPath(target, ctx.cwd)) return { block: true, reason: "Plan mode only allows edits/writes to PLAN.md, plans/*.md, or docs/plans/*.md." };
      planFile = path.normalize(target);
      persist();
    }
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (planMode) {
      return { message: { customType: "plan-mode-context", display: false, content: `[PLAN MODE ACTIVE]\n\n${readPrompt(ctx.cwd)}\n\nExtension enforcement: edit/write may only target PLAN.md, plans/*.md, or docs/plans/*.md. The plan is not approved until the user runs /plan-approve [path].` } };
    }
    if (executionMode && todos.length > 0) {
      const remaining = todos.filter((todo) => !todo.completed).map((todo) => `${todo.step}. ${todo.text}`).join("\n");
      return { message: { customType: "plan-execution-context", display: false, content: `[EXECUTING APPROVED PLAN]\nPlan file: ${planFile}\nRemaining steps:\n${remaining}\n\nExecute steps in order. After finishing each checklist item, call the ${PROGRESS_TOOL} tool immediately with that step number so the todo widget updates live. If the tool is unavailable, include [DONE:n] after completing step n as a fallback. After all steps are complete and the user is satisfied, they can run /plan-complete to clear the active plan UI.` } };
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    if (!executionMode || !isAssistantMessage(event.message as AgentMessage)) return;
    if (markCompletedSteps(assistantText(event.message as AssistantMessage), todos) > 0) { updatePlanFile(ctx); updateStatus(ctx); persist(); }
  });

  pi.on("session_start", async (_event, ctx) => {
    currentCwd = ctx.cwd;
    const entry = ctx.sessionManager.getEntries().filter((e: any) => e.type === "custom" && e.customType === STATE_TYPE).pop() as any;
    if (entry?.data) ({ planMode = false, executionMode = false, planFile, todos = [] } = entry.data);
    normalTools = pi.getAllTools().map((tool) => tool.name).filter((name) => name !== PROGRESS_TOOL);
    if (planMode) pi.setActiveTools(PLAN_TOOLS);
    else if (executionMode) pi.setActiveTools(getExecutionTools());
    updateStatus(ctx);
  });
}
