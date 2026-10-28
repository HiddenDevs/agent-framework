import type z from "zod";

/** What a model is told about a tool. */
export type ToolSpec = {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: z.ZodType;
};
