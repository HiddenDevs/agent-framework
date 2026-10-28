# Getting started

## Requirements

- Node.js 22.12 or newer
- TypeScript with `"experimentalDecorators": true` in `tsconfig.json`
- Zod 4 (a peer dependency)
- One provider SDK, installed only if you use it (both are optional peer dependencies):
    - `@anthropic-ai/sdk` for Anthropic
    - `openai` for OpenAI

```bash
npm install @hiddendevs/agent-framework zod
npm install @anthropic-ai/sdk   # or: npm install openai
```

## 1. Write a tool

A tool is a class that extends `ToolBase` and is decorated with `@AgentTool`. The Zod schema is used twice from
a single definition: it validates the model's arguments at runtime, and it is converted to the JSON Schema
the model is shown. The two cannot drift apart.

```ts
// src/tools/search.ts
import { AgentTool, ToolBase } from "@hiddendevs/agent-framework";
import z from "zod";

const inputSchema = z.object({
    query: z.string().min(1).describe("What to search for"),
    limit: z.coerce.number().int().min(1).max(20).optional().describe("Maximum number of results"),
});

@AgentTool({
    name: "search",
    description: "Search the knowledge base and return matching articles",
    inputValidationSchema: inputSchema,
})
export class SearchTool extends ToolBase<typeof inputSchema> {
    public async execute(input: z.infer<typeof inputSchema>) {
        return [{ title: `Result for ${input.query}`, score: 0.9 }];
    }
}
```

Two rules the startup lint enforces (see [Tools](./tools.md#linting)):

- Every property in the schema needs a `.describe(...)`. The model reads those descriptions.
- The schema must be an object (`z.object(...)`).

## 2. Describe an agent

Agents are plain configuration. Tools are referenced by name only.

```ts
import { AgentFramework } from "@hiddendevs/agent-framework";
import { fileURLToPath } from "node:url";

const framework = await AgentFramework.create({
    toolPaths: [fileURLToPath(new URL("./tools", import.meta.url))],
    providers: {
        main: { provider: "anthropic", model: "<model id>", apiKey: process.env.ANTHROPIC_API_KEY! },
    },
    agents: {
        researcher: {
            provider: "main",
            systemPrompt: "You research questions using the tools available: {{ tools | json }}",
            tools: ["search"],
        },
    },
});
```

`toolPaths` is scanned recursively; every `.js`, `.mjs` and `.cjs` module is imported, which runs the
decorators and registers the tools. Point it at your **compiled** output directory. See
[Tools: discovery](./tools.md#discovery) for TypeScript sources and other details.

## 3. Run it

```ts
const agent = await framework.agent("researcher");
const result = await agent.run("What does the handbook say about parental leave?");

if (result.isOk) {
    console.log(result.value.output); // the model's final text
    console.log(result.value.turns); // how many model calls it took
} else {
    console.error(result.error.message); // an AgentError
    console.error(result.error.transcript); // everything that happened up to the failure
}
```

`run` returns a `Result`. It only holds an error when the agent could not finish (see
[Error handling](./error-handling.md)). Mistakes by the model are fed back to it, not reported to you.

## 4. Ask for structured output

Add an `outputSchema` to the agent config and the agent will return an object that matches it, validated, instead
of free text.

```ts
agents: {
    classifier: {
        provider: "main",
        tools: [],
        outputSchema: {
            type: "object",
            required: ["label", "confidence"],
            properties: {
                label: { type: "string", enum: ["bug", "feature", "question"], description: "Ticket category" },
                confidence: { type: "number", minimum: 0, maximum: 1, description: "0 to 1" },
            },
        },
        outputDescription: "Submit the classification",
    },
}
```

```ts
const result = await (await framework.agent("classifier")).run("The app crashes when I tap save");
console.log(result.value.output); // { label: "bug", confidence: 0.93 }
```

The full output-schema dialect is described in [Configuration](./configuration.md#output-schema-dialect).

## Building an agent in code instead

Everything configuration can express is also available through a fluent builder. This is useful for typed
output schemas written directly in Zod. See [Agents: the builder](./agents.md#the-builder).

```ts
import { AgentBuilder, ModelClientFactory, ProviderConfig } from "@hiddendevs/agent-framework";

const client = await ModelClientFactory.create(
    ProviderConfig.parse({ provider: "openai", model: "<model id>", apiKey: process.env.OPENAI_API_KEY }),
);

const agent = AgentBuilder.create(client)
    .tools("search")
    .output(z.object({ answer: z.string().describe("The final answer") }))
    .build();
```

## Where to go next

- Add services to a tool: [Tools: dependencies](./tools.md#tools-that-need-dependencies)
- Create agents without redeploying: [Runtime registration](./runtime-registration.md)
- Test without a network: [Testing](./testing.md)
