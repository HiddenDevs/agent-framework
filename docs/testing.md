# Testing

Agents depend only on the `ModelClient` interface, so a scripted fake lets you test everything except the model
itself, with no network or API key. The project uses [Vitest](https://vitest.dev).

## A scripted fake client

```ts
import { Message, ModelResponse, StopReason, TextBlock, ToolCallBlock } from "@hiddendevs/agent-framework";
import type { ModelClient, ModelRequest } from "@hiddendevs/agent-framework";

class FakeClient implements ModelClient {
    public readonly requests: ModelRequest[] = [];
    public constructor(private readonly script: ModelResponse[]) {}

    public async complete(request: ModelRequest) {
        this.requests.push(request); // inspect prompts, tools and forced tool names later
        const next = this.script.shift();
        if (!next) throw new Error("script exhausted");
        return next;
    }
}

const text = (value: string) => new ModelResponse(Message.assistant([new TextBlock(value)]));
const toolCalls = (...calls: ToolCallBlock[]) => new ModelResponse(Message.assistant(calls), StopReason.TOOL_USE);
```

## Testing a tool end to end

```ts
beforeEach(() => {
    ToolRegistry.clearToolClasses();
    ToolRegistry.clearToolInstances();
});

it("runs the tool", async () => {
    // register by declaring the decorated class in the test, or import the module under test
    const client = new FakeClient([toolCalls(new ToolCallBlock("1", "search", { query: "x" })), text("done")]);
    const agent = AgentBuilder.create(client).tools("search").build();

    const result = await agent.run("go");

    expect(result.value.output).toBe("done");
    const toolResult = client.requests[1]?.messages.at(-1)?.content[0] as ToolResultBlock;
    expect(toolResult.result.isError).toBe(false);
});
```

Or test the tool without an agent:

```ts
const result = await ToolSet.from(["search"]).call("search", { query: "x" });
expect(result.isError).toBe(false);
```

Always clear the registry in `beforeEach`. Registration is global and duplicate names throw. Importing a module
once registers its tools for the rest of the test file (and clearing does not make it register again), so declare
tools inside the test or keep one registration per file.

## Testing structured output

Script a `submit_result` call:

```ts
const submit = (args: Record<string, unknown>) => new ToolCallBlock("1", "submit_result", args);

const agent = AgentBuilder.create(new FakeClient([toolCalls(submit({ answer: "42" }))]))
    .output(z.object({ answer: z.string().describe("answer") }))
    .build();

expect((await agent.run("q")).value.output).toEqual({ answer: "42" });
```

To test self-correction, script an invalid submit followed by a valid one and assert on
`client.requests[1]` that the last message holds the `Invalid result: ...` error.

## Testing config-driven agents and runtime registration

Use the `clientFactory` option to avoid real SDK clients:

```ts
const framework = await AgentFramework.create(
    { providers: { main: { provider: "openai", model: "m", apiKey: "k" } }, agents: {} },
    { clientFactory: async () => fakeClient },
);

const registered = framework.registerAgent("a", { provider: "main", tools: ["search"] });
expect(registered.isOk).toBe(true);
```

Registration never calls a model, so invalid configs can be tested without any client at all.

## Testing discovery

Write real module files into a temporary directory and scan it:

```ts
const dir = await mkdtemp(join(tmpdir(), "tools-"));
await writeFile(
    join(dir, "echo.mjs"),
    `...import { AgentTool, ToolBase } ... export const Echo = AgentTool(...)(class ...)`,
);
await ToolCollector.collect(dir);
```

Plain `.mjs` files cannot use decorator syntax, so call the decorator as a function as the project's own tests do
(`AgentTool({...})(class extends ToolBase { ... })`).

## How this repository runs its tests

Tests import from `@hiddendevs/agent-framework`, which resolves to the built `dist`, so `npm test` builds first:

```bash
npm test            # build, then vitest run
npm run typecheck   # tsc --noEmit over src and tests
npm run lint        # eslint
```

Types in tests are checked against `dist`, so run the build (or `npm test`) before `npm run typecheck` after
changing the public API.
