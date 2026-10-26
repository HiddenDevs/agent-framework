import { readdir, realpath, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolClass } from "./tool-decorator.js";
import { ToolRegistry } from "./tool-registry.js";

export type ToolModuleExtension = ".js" | ".mjs" | ".cjs" | ".ts" | ".mts" | ".cts";

export type ToolCollectorOptions = {
    /** Defaults to JavaScript modules. TypeScript modules require a compatible runtime loader. */
    readonly extensions?: readonly ToolModuleExtension[];
};

export class ToolCollector {
    /**
     * Imports modules recursively, then returns all classes in the shared tool registry,
     * including previously registered tools. Does not instantiate tools.
     */
    public static async collect(
        paths: string | readonly string[],
        options: ToolCollectorOptions = {},
    ): Promise<ToolClass[]> {
        const roots = typeof paths === "string" ? [paths] : paths;
        const extensions = new Set<string>(options.extensions ?? [".js", ".mjs", ".cjs"]);
        if (roots.length === 0 || roots.some((path) => path.trim().length === 0)) {
            throw new Error("Tool collection requires at least one non-empty file or directory path.");
        }
        if (extensions.size === 0) {
            throw new Error("Tool collection requires at least one module extension.");
        }

        const visited = new Set<string>();
        const modules = new Set<string>();
        const isModule = (path: string): boolean => extensions.has(extname(path)) && !/\.d\.(?:ts|mts|cts)$/.test(path);

        const scan = async (path: string): Promise<void> => {
            const canonicalPath = await realpath(path);
            if (visited.has(canonicalPath)) {
                return;
            }
            visited.add(canonicalPath);

            const info = await stat(canonicalPath);
            if (info.isDirectory()) {
                const entries = await readdir(canonicalPath, { withFileTypes: true });
                entries.sort((a, b) => a.name.localeCompare(b.name));
                for (const entry of entries) {
                    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
                        await scan(join(canonicalPath, entry.name));
                    } else if (entry.isFile() && isModule(entry.name)) {
                        modules.add(join(canonicalPath, entry.name));
                    }
                }
            } else if (info.isFile() && isModule(canonicalPath)) {
                modules.add(canonicalPath);
            } else {
                throw new Error(`Tool collection path "${path}" is not a directory or a supported module file.`);
            }
        };

        for (const root of roots) {
            await scan(resolve(root));
        }

        for (const modulePath of [...modules].sort()) {
            try {
                await import(pathToFileURL(modulePath).href);
            } catch (cause) {
                throw new Error(`Failed to import tool module "${modulePath}".`, { cause });
            }
        }

        return ToolRegistry.getToolClasses();
    }
}
