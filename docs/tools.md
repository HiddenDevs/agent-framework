# Tools

A tool is something the model can ask your code to do. In this framework a tool is a **class**, described by a
**Zod schema**, registered with a **decorator**, and found by **directory scanning**.

## Creating a tool

```ts
import { AgentTool, ToolBase } from "@hiddendevs/agent-framework";
import z from "zod";

const inputSchema = z.object({ id: z.coerce.number().int().describe("The order id") });

@AgentTool({
    name: "order-lookup",
    description: "Look up an order by its numeric id",
    inputValidationSchema: inputSchema,
})
class OrderLookupTool extends ToolBase<typeof inputSchema> {
    public async execute(input: z.infer<typeof inputSchema>) {
        return { id: input.id, status: "shipped" };
    }
}
```

### `@AgentTool` configuration

| Field                   | Type          | Notes                                                        |
| ----------------------- | ------------- | ------------------------------------------------------------ |
| `name`                  | `string`      | Unique across the process. Duplicate registration throws.    |
| `description`           | `string`      | What the tool does and when to use it. The model reads this. |
| `inputValidationSchema` | `z.ZodObject` | Must be an object schema.                                    |

The decorator defines `name`, `description` and `inputValidationSchema` as static properties on the class and
registers the class with `ToolRegistry`. It does not construct an instance.

### `execute`

`execute(input)` receives the **validated and parsed** input (after coercions, defaults and transforms) and may
be synchronous or asynchronous. It must return a `JSONValue`: `string | number | boolean | null`, an array, or a
plain object of those. `undefined` is converted to `null`. The value is serialized for the model: strings pass
through, everything else becomes JSON.

You never need to catch exceptions to report a failure to the model: anything you throw is reported as
`Tool <name> failed: <message>` (see [Running tools](#running-tools)).

### Writing good schemas

- Describe every property with `.describe(...)`. This is enforced by lint.
- Prefer `z.coerce.number().int()` for integers; models frequently send numbers as strings.
- `.nullable().optional()` means "absent or null". `.optional()` alone rejects an explicit `null`.
- `.default(value)` fills in missing fields.
- Use `.transform(...)` freely. The advertised schema is generated from the _input_ side of the schema
  (`io: "input"`), so a transform does not change what the model sees.
- Recursive schemas (`z.lazy`) are not supported.

## Discovery

`ToolCollector.collect(paths, options?)` imports modules; their decorators register the tools. The framework
calls it for you through `toolPaths` / `framework.loadTools()`, but you can use it directly:

```ts
import { ToolCollector } from "@hiddendevs/agent-framework";

const classes = await ToolCollector.collect("./dist/tools");
```

Behaviour:

- Accepts a file, a directory, or an array of paths. Relative paths resolve from the current working directory.
- Recurses into directories, importing `.js`, `.mjs` and `.cjs` files in sorted order.
- Skips nested `node_modules` and `.git` directories and symbolic links encountered during traversal.
- Overlapping paths are de-duplicated. Tool classes need not be exported.
- Pass `{ extensions: [".ts", ".mts", ".cts"] }` to scan TypeScript sources. This needs a runtime loader that
  supports TypeScript and legacy decorators (plain Node type stripping is not enough). Declaration files
  (`.d.ts`) are always skipped.
- Missing paths, duplicate tool names and import failures reject the promise. Import failures keep the original
  error as `cause`. Registrations made before a failure are **not** rolled back.
- The returned array is a snapshot of **every** class in the registry, including tools registered earlier or by
  imported dependencies, not only those found by this scan.
- Repeated scans use the module cache, so decorators do not rerun.

> **Security.** Every matching module is executed, along with everything it imports. Only scan directories you
> trust. Never build scan paths from request data.

Through the framework:

```ts
const framework = await AgentFramework.create({
    toolPaths: ["./dist/tools"],
    toolExtensions: [".js"], // optional
    providers: {/* ... */},
    agents: {},
});

await framework.loadTools("./dist/plugins"); // later, for newly added tool modules
```

## The registry

`ToolRegistry` is a static class.

| Method                                        | Purpose                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `registerToolClass(name, toolClass)`          | Called by the decorator. Throws on duplicate names.                      |
| `getToolClass(name)`                          | The class, or `undefined`.                                               |
| `getToolClasses()`                            | Snapshot array of all registered classes.                                |
| `getToolInstance(name, factory?)`             | The cached instance, creating it on first use. Throws if not registered. |
| `load(paths, options?)`                       | Alias for `ToolCollector.collect`.                                       |
| `clearToolClasses()` / `clearToolInstances()` | Remove everything. Intended for tests, not hot reload.                   |

Because decorators run when a module is first imported, clearing the registry does not make an already-imported
module register again.

## Tools that need dependencies

By default a tool is created with `new ToolClass()`. If it needs services, supply a **tool factory** when you
create the framework (or the builder). The factory is called once per tool name; the instance is then cached.

```ts
@AgentTool({ name: "customer-lookup", description: "Find a customer", inputValidationSchema: schema })
class CustomerLookupTool extends ToolBase<typeof schema> {
    public constructor(private readonly customers: CustomerService) {
        super();
    }
    public execute(input: z.infer<typeof schema>) {
        return this.customers.find(input.email);
    }
}

const framework = await AgentFramework.create(config, {
    toolFactory: (toolClass) =>
        toolClass === CustomerLookupTool ? new CustomerLookupTool(customerService) : new (toolClass as never)(),
});
```

Because instances are cached by name, the factory is only consulted the first time a tool is selected. To
change dependencies later, call `ToolRegistry.clearToolInstances()`.

## `ToolSet`

A `ToolSet` is the immutable set of tools one agent may use.

```ts
const tools = ToolSet.from(["search", "order-lookup"], { factory });

tools.names(); // ["search", "order-lookup"]
tools.contains("search"); // true
tools.specs(); // [{ name, description, inputSchema }, ...] for the model
await tools.call("search", { query: "refunds" }); // ToolResult
tools.plus(otherSet); // new set containing both
ToolSet.EMPTY; // no tools
```

`ToolSet.from` throws if a name is not registered, or if any selected tool fails the lint, listing every
problem. In normal use you do not call it yourself: `AgentBuilder.tools("a", "b")` and agent configs do.

## Linting

Selecting a tool lints it so mistakes surface at startup rather than in the middle of a model conversation.
`lintToolClass(toolClass)` returns the list of problems (empty means valid):

| Rule                                                                        | Why                            |
| --------------------------------------------------------------------------- | ------------------------------ |
| Name matches `^[a-zA-Z0-9_-]{1,64}$`                                        | Provider name limits           |
| Name is not `submit_result`                                                 | Reserved for structured output |
| Description is not blank                                                    | The model needs it             |
| Input schema is an object                                                   | Providers require an object    |
| Every property, including nested objects and array items, has a description | The model needs it             |

A description on a wrapper counts: `z.string().nullable().describe("...")` and `z.string().describe("...").nullable()`
both pass.

## Running tools

When the agent receives a tool call it runs it through this pipeline. **No step throws.**

1. The name is looked up. Unknown name: error result `Unknown tool: <name>. Available tools: <list>`.
2. Arguments are validated with the schema. Failure: error result
   `Invalid arguments: <path>: <message>; ...` listing **every** issue.
3. `execute` is awaited. If it throws or rejects: error result `Tool <name> failed: <message>`.
4. Otherwise a success result with the returned value.

`ToolResult` has `content` (a `JSONValue`) and `isError`; create one with `ToolResult.success(value)` or
`ToolResult.error(message)`. Error results are sent back to the model, which usually corrects the call.

If a failure should not be retried by the model, say so in the message you throw, for example
`throw new Error("Order 42 does not exist; do not retry")`.
