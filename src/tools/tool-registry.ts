import { ToolCollector, type ToolCollectorOptions } from "./tool-collector.js";
import type { Tool, ToolClass } from "./tool-decorator.js";

/** Builds a tool instance, e.g. to inject services into its constructor. */
export type ToolFactory = (toolClass: ToolClass) => Tool;

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

    /** Creates the tool on first use and caches it; `factory` supplies constructor dependencies. */
    public static getToolInstance(name: string, factory?: ToolFactory): Tool {
        const cached = this.TOOL_INSTANCES.get(name);
        if (cached) {
            return cached;
        }

        const toolClass = this.TOOL_CLASSES.get(name);
        if (!toolClass) {
            throw new Error(`Tool "${name}" is not registered.`);
        }

        const instance = factory ? factory(toolClass) : new (toolClass as unknown as new () => Tool)();
        this.TOOL_INSTANCES.set(name, instance);
        return instance;
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
