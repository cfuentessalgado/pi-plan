# pi-plan

Plan-mode extension for the Pi coding agent.

This Pi package adds a persistent planning workflow with enforced plan-only edits before approval and todo tracking during approved execution.

## Install

```sh
pi install git:github.com/cfuentessalgado/pi-plan
```

For local development, you can run Pi with the extension directly:

```sh
pi -e ./extensions/plan-mode
```

## Commands

- `/plan [seed]` — toggles persistent plan mode. Optional seed text is sent as the first planning prompt.
- `/plan-approve [path]` — approves a plan file and starts execution mode. If `path` is omitted, the last plan file edited/written during plan mode is used.
- `/plan-resume [path]` — resumes a plan from its checked checklist state. This uses the same execution flow as `/plan-approve`, but is clearer for partially completed plans. Path autocomplete suggests `PLAN.md`, `plans/*.md`, and `docs/plans/*.md`.
- `/plan-complete` — completes the active approved-plan UI after all todos are checked, clears the todo widget/status, and exits execution mode.

## Planning enforcement

- Safe exploration tools stay available: `read`, safe `bash`, `question`, `web_fetch`.
- `edit` and `write` are allowed only for `PLAN.md`, `plans/*.md`, or `docs/plans/*.md`.
- Unsafe bash commands are blocked while plan mode is active.
- Each planning turn injects instructions from `plans/plan.md` when present, falling back to `prompts/plan.md` or embedded defaults.

## Execution mode

- Starts only after `/plan-approve`.
- Restores normal tools and enables the `plan_done` progress tool.
- Tracks tasks from the approved plan file's `## Steps` checklist.
- Completed checklist items are written back to the plan file as `- [x]`, so interrupted work can be resumed later with `/plan-resume`.
- The agent should call `plan_done` immediately after completing each checklist step so the todo widget/status updates live.
- `[DONE:n]` markers in assistant text remain supported as a fallback completion signal.
- Completed todos remain visible until the user runs `/plan-complete`. The command requires all todos to be checked, then clears the active plan UI and stops execution-context injection.
- Approving or resuming another plan overwrites the previous active/hidden plan UI state without prompting; the markdown plan file remains the durable record.

## Development

```sh
npm run typecheck
pi -e ./extensions/plan-mode
```

Local dogfood plans and generated plan artifacts should live under `plans/`, which is ignored by git.

The package metadata exposes the extension through:

```json
{
  "pi": {
    "extensions": ["extensions/plan-mode"]
  }
}
```
