# Agent Framework

## Discovering tools

Decorate tool classes with `@AgentTool`. The decorator registers the class and its
metadata without constructing an instance.

```ts
import { AgentTool, ToolBase } from "@hiddendevs/agent-framework";
import z from "zod";

const inputSchema = z.object({ query: z.string() });

@AgentTool({
    name: "search",
    description: "Search for information",
    inputValidationSchema: inputSchema,
})
class SearchTool extends ToolBase<typeof inputSchema> {
    public execute(input: z.infer<typeof inputSchema>) {
        return { query: input.query };
    }
}
```

At application startup, scan the compiled tool directory:

```ts
import { ToolCollector } from "@hiddendevs/agent-framework";
import { fileURLToPath } from "node:url";

const tools = await ToolCollector.collect(fileURLToPath(new URL("./tools", import.meta.url)));

for (const Tool of tools) {
    console.log(Tool.name, Tool.description, Tool.inputValidationSchema);
}
```

`collect` accepts a file, a directory, or an array of paths. Relative paths are
resolved from the current working directory. It recursively imports `.js`,
`.mjs`, and `.cjs` files in sorted order, skipping nested `node_modules` and `.git`
directories and symbolic links encountered during traversal. Overlapping paths
are deduplicated. Tool classes do not have to be exported.

For source discovery, pass `{ extensions: [".ts", ".mts", ".cts"] }` as the second
argument. This requires a runtime loader that supports TypeScript and the
project's legacy decorators; plain Node.js type stripping is not sufficient.
Declaration files are always skipped.

Only scan trusted tool directories: **every matching module is executed**,
including non-tool files and their imports. Discovery does not instantiate tools
or validate/execute their input. Missing paths, duplicate tool names, and module
import failures reject the collection promise; import failures retain their
original error as `cause`. Registrations made before a failure are not rolled back.

The returned array is a snapshot of **all classes in the shared `ToolRegistry`**,
including tools registered before the scan or through imported dependencies.
`ToolRegistry.getToolClasses()` also exposes this snapshot without scanning.
Repeated scans use the runtime's module cache and do not rerun decorators.
Consequently, clearing the registry does not make already imported modules
register again; registry clearing is intended for test isolation, not hot reload.
