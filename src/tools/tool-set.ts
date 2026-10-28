import type z from "zod";
import type { Tool, ToolClass } from "./tool-decorator.js";
import { lintToolClass } from "./tool-lint.js";
import { ToolRegistry, type ToolFactory } from "./tool-registry.js";
import { ToolResult } from "./tool-result.js";
import { runTool } from "./tool-runner.js";
import type { ToolSpec } from "./tool-spec.js";

type Entry = { readonly toolClass: ToolClass; readonly tool: Tool };

/** Immutable, name-keyed selection of runnable tools. */
export class ToolSet {
    public static readonly EMPTY = new ToolSet(new Map());

    private constructor(private readonly entries: ReadonlyMap<string, Entry>) {}

    /** Selects registered tools by name, linting each one. Throws on unknown names or lint failures. */
    public static from(names: readonly string[], options: { readonly factory?: ToolFactory } = {}): ToolSet {
        const entries = new Map<string, Entry>();
        const problems: string[] = [];

        for (const name of names) {
            const toolClass = ToolRegistry.getToolClass(name);
            if (!toolClass) {
                throw new Error(`Tool "${name}" is not registered.`);
            }
            problems.push(...lintToolClass(toolClass));
            entries.set(name, { toolClass, tool: ToolRegistry.getToolInstance(name, options.factory) });
        }

        if (problems.length > 0) {
            throw new Error(`Invalid tools:\n${problems.join("\n")}`);
        }
        return new ToolSet(entries);
    }

    public contains(name: string): boolean {
        return this.entries.has(name);
    }

    public names(): string[] {
        return [...this.entries.keys()];
    }

    public specs(): ToolSpec[] {
        return [...this.entries.values()].map(({ toolClass }) => ({
            name: toolClass.name,
            description: toolClass.description,
            inputSchema: toolClass.inputValidationSchema as z.ZodType,
        }));
    }

    public async call(name: string, args: unknown): Promise<ToolResult> {
        const entry = this.entries.get(name);
        if (!entry) {
            return ToolResult.error(`Unknown tool: ${name}. Available tools: ${this.names().join(", ")}`);
        }
        return runTool(name, entry.tool, entry.toolClass.inputValidationSchema, args);
    }

    public plus(other: ToolSet): ToolSet {
        return new ToolSet(new Map([...this.entries, ...other.entries]));
    }
}
