import type z from "zod";
import type { JSONValue } from "../global.js";
import type { Tool } from "./tool-decorator.js";
import { ToolResult } from "./tool-result.js";

export const formatIssues = (issues: readonly z.core.$ZodIssue[]): string =>
    issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`).join("; ");

/** Validates arguments, then executes. Every failure becomes an error result. */
export const runTool = async (name: string, tool: Tool, schema: z.ZodType, args: unknown): Promise<ToolResult> => {
    const parsed = schema.safeParse(args ?? {});
    if (!parsed.success) {
        return ToolResult.error(`Invalid arguments: ${formatIssues(parsed.error.issues)}`);
    }

    try {
        const content = (await tool.execute(parsed.data as never)) as JSONValue;
        return ToolResult.success(content ?? null);
    } catch (error) {
        return ToolResult.error(`Tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
};
