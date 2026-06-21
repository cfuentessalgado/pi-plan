import * as path from "node:path";

const DESTRUCTIVE_PATTERNS = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bchgrp\b/i,
  /\bln\b/i,
  /\btee\b/i,
  /\btruncate\b/i,
  /\bdd\b/i,
  /\bshred\b/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
  /\byarn\s+(add|remove|install|publish)/i,
  /\bpnpm\s+(add|remove|install|publish)/i,
  /\bpip\s+(install|uninstall)/i,
  /\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
  /\bbrew\s+(install|uninstall|upgrade)/i,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bkill\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\breboot\b/i,
  /\bshutdown\b/i,
  /\bsystemctl\s+(start|stop|restart|enable|disable)/i,
  /\bservice\s+\S+\s+(start|stop|restart)/i,
  /\b(vim?|nano|emacs|code|subl)\b/i,
];

const SAFE_PATTERNS = [
  /^\s*(cat|head|tail|less|more|grep|find|ls|pwd|echo|printf|wc|sort|uniq|diff|file|stat|du|df|tree|which|whereis|type|env|printenv|uname|whoami|id|date|cal|uptime|ps|top|htop|free|jq|awk|rg|fd|bat|eza)\b/i,
  /^\s*sed\s+-n\b/i,
  /^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get|ls-files|grep)\b/i,
  /^\s*npm\s+(list|ls|view|info|search|outdated|audit)\b/i,
  /^\s*(yarn|pnpm)\s+(list|info|why|audit|outdated)\b/i,
  /^\s*(node|python|python3|ruby|go|rustc|cargo)\s+--?version\b/i,
  /^\s*wget\s+(-O\s*-|--output-document=-)\b/i,
];

export interface TodoItem { step: number; text: string; completed: boolean }

export function isSafeCommand(command: string): boolean {
  return !DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command)) &&
    SAFE_PATTERNS.some((pattern) => pattern.test(command));
}

export function isAllowedPlanPath(filePath: string, cwd: string): boolean {
  const normalized = path.normalize(path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath).replaceAll("\\\\", "/");
  if (normalized.startsWith("../") || path.isAbsolute(normalized)) return false;
  return normalized === "PLAN.md" || /^plans\/[^/]+\.md$/i.test(normalized) || /^docs\/plans\/[^/]+\.md$/i.test(normalized);
}

function stepsSection(markdown: string): { start: number; end: number } | undefined {
  const stepsHeader = markdown.match(/^##\s+Steps\s*$/im);
  if (!stepsHeader?.index && stepsHeader?.index !== 0) return undefined;
  const start = stepsHeader.index + stepsHeader[0].length;
  const section = markdown.slice(start);
  const nextHeader = section.search(/^##\s+/m);
  const end = nextHeader >= 0 ? start + nextHeader : markdown.length;
  return { start, end };
}

export function extractStepsFromMarkdown(markdown: string): TodoItem[] {
  const bounds = stepsSection(markdown);
  if (!bounds) return [];
  const body = markdown.slice(bounds.start, bounds.end);
  const items: TodoItem[] = [];
  for (const match of body.matchAll(/^\s*(?:[-*]|\d+[.)])\s+\[([ xX])\]\s+(.+)$/gm)) {
    const text = match[2].replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").trim();
    if (text) items.push({ step: items.length + 1, text, completed: match[1].toLowerCase() === "x" });
  }
  return items;
}

export function applyTodoCompletionToMarkdown(markdown: string, items: TodoItem[]): string {
  const bounds = stepsSection(markdown);
  if (!bounds) return markdown;
  let index = 0;
  const body = markdown.slice(bounds.start, bounds.end).replace(/^(\s*(?:[-*]|\d+[.)])\s+\[)([ xX])(\]\s+.+)$/gm, (line, prefix: string, marker: string, suffix: string) => {
    const item = items[index++];
    if (!item) return line;
    return `${prefix}${item.completed ? "x" : marker}${suffix}`;
  });
  return `${markdown.slice(0, bounds.start)}${body}${markdown.slice(bounds.end)}`;
}

export function markCompletedSteps(text: string, items: TodoItem[]): number {
  let count = 0;
  for (const match of text.matchAll(/\[DONE:(\d+)\]/gi)) {
    const item = items.find((todo) => todo.step === Number(match[1]));
    if (item && !item.completed) { item.completed = true; count++; }
  }
  return count;
}
