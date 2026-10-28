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

## Running agents from configuration

Agents are described by plain config and built by `AgentFramework`. Tools under
`toolPaths` are discovered, linted, and selected by name.

```ts
import { AgentFramework } from "@hiddendevs/agent-framework";

const framework = await AgentFramework.create(
    {
        toolPaths: ["./dist/tools"],
        providers: { main: { provider: "anthropic", model: "<model>", apiKey: process.env.API_KEY! } },
        agents: {
            researcher: {
                provider: "main",
                systemPrompt: "Use tools to answer. Available: ${tools}",
                tools: ["search"],
                outputSchema: {
                    type: "object",
                    required: ["answer"],
                    properties: { answer: { type: "string", description: "The final answer" } },
                },
            },
        },
    },
    // toolFactory: (ToolClass) => new ToolClass(services), // for tools with dependencies
);

const result = await (await framework.agent("researcher")).run("What is ...?");
if (result.isOk) console.log(result.value.output);
```

Tool failures, invalid arguments and invalid structured output are returned to the
model as error results so it can correct itself. `Result` is an error only when the
run exhausts its budget (`AgentError`, which carries the transcript).
`@anthropic-ai/sdk` and `openai` are optional peer dependencies; install the one you use.

### Registering agents at runtime

Agents can be added, replaced and removed on a running framework, e.g. from a generic
"create agent" endpoint. Registration validates the whole config (schema, provider, tool
names, output schema) and returns a `Result` instead of throwing.

```ts
const created = framework.registerAgent("support-bot", requestBody, { replace: false });
if (!created.isOk) return respond(400, created.error.message);

framework.hasAgent("support-bot");
framework.unregisterAgent("support-bot");
framework.registerProvider("backup", { provider: "openai", model: "<model>", apiKey });
```

Registered agents can only reference tools and providers that already exist, so config
from untrusted callers cannot run new code. `framework.loadTools(paths)` imports (and
executes) modules, so call it only with trusted paths. Registrations live in memory;
persist the configs yourself if they must survive a restart.

## Documentation

Full documentation lives in [docs/](docs/README.md): getting started, architecture, tools, agents,
configuration, runtime registration, providers, error handling and testing.
