import { ToolCollector, type ToolCollectorOptions } from "./tool-collector.js";
import type { Tool, ToolClass } from "./tool-decorator.js";

export class ToolRegistry {
    protected static readonly TOOL_CLASSES: Map<string, ToolClass> = new Map();
    protected static readonly TOOL_INSTANCES: Map<string, Tool> = new Map();

    public static registerToolClass(name: string, toolClass: ToolClass): void {
        if (this.TOOL_CLASSES.has(name)) {
            throw new Error(`Tool class with name "${name}" is already registered.`);
        }

        this.TOOL_CLASSES.set(name, toolClass);
    }

    public static getToolClass(name: string): ToolClass | undefined {
        return this.TOOL_CLASSES.get(name);
    }

    public static getToolClasses(): ToolClass[] {
        return [...this.TOOL_CLASSES.values()];
    }

    /** Clears all registered tool classes. */
    public static clearToolClasses(): void {
        this.TOOL_CLASSES.clear();
    }

    /** Clears all registered tool instances. */
    public static clearToolInstances(): void {
        this.TOOL_INSTANCES.clear();
    }

    public static async load(directory: string | readonly string[], options?: ToolCollectorOptions): Promise<void> {
        await ToolCollector.collect(directory, options);
    }
}
