declare module "@earendil-works/pi-ai" {
  export type TextContent = { type: "text"; text: string };
  export type AssistantMessage = { role: "assistant"; content: Array<TextContent | { type: string; [key: string]: unknown }> };
}

declare module "@earendil-works/pi-agent-core" {
  export type AgentMessage = { role: string; content?: unknown };
}

declare module "@earendil-works/pi-coding-agent" {
  export type ExtensionContext = {
    cwd: string;
    ui: {
      theme: { fg(color: string, value: string): string };
      notify(message: string, level: "info" | "success" | "warning" | "error"): void;
      setStatus(name: string, value: string | undefined): void;
      setWidget(name: string, value: string[] | undefined): void;
    };
    sessionManager: { getEntries(): unknown[] };
  };

  export type ToolContent = { type: "text"; text: string };

  export type ToolResult = {
    content: ToolContent[];
    details?: unknown;
  };

  export type ToolDefinition<TParams = any> = {
    name: string;
    label?: string;
    description: string;
    promptSnippet?: string;
    promptGuidelines?: string[];
    parameters: unknown;
    execute(
      toolCallId: string,
      params: TParams,
      signal: AbortSignal | undefined,
      onUpdate: ((result: Partial<ToolResult>) => void) | undefined,
      ctx: ExtensionContext,
    ): ToolResult | Promise<ToolResult>;
  };

  export type ExtensionAPI = {
    appendEntry(type: string, data: unknown): void;
    getAllTools(): Array<{ name: string }>;
    setActiveTools(names: string[]): void;
    sendUserMessage(message: string): void;
    registerTool<TParams = any>(tool: ToolDefinition<TParams>): void;
    registerCommand(name: string, command: {
      description: string;
      getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string }> | null;
      handler(args: string, ctx: ExtensionContext): void | Promise<void>;
    }): void;
    on(event: string, handler: (event: any, ctx: ExtensionContext) => unknown): void;
  };

  export function isToolCallEventType(name: string, event: any): boolean;
}
