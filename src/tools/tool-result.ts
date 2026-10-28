import type { JSONValue } from "../global.js";

/** Outcome of a tool call; failures are data returned to the model, never exceptions. */
export class ToolResult {
    private constructor(
        public readonly content: JSONValue,
        public readonly isError: boolean,
    ) {}

    public static success(content: JSONValue): ToolResult {
        return new ToolResult(content, false);
    }

    public static error(message: string): ToolResult {
        return new ToolResult(message, true);
    }
}
