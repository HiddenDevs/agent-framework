# Agent Framework Documentation

`@hiddendevs/agent-framework` is a configuration-driven AI agent framework for TypeScript. It has
three goals, and every feature in the library serves at least one of them:

| Goal                 | What it means                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Easy tool creation   | One decorated class and one Zod schema make a working tool. No manual registration.                    |
| Easy tool discovery  | Point the framework at a directory; tools are found and addressable by name.                           |
| Configuration-driven | Agents (provider, prompt, tools, output shape, limits) are plain data and can change without a deploy. |

Two further properties support those goals: model mistakes are returned to the model as data so it can
correct itself, and the agent loop is independent of any one model provider.

## Contents

| Document                                          | Read it to learn about                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| [Getting started](./getting-started.md)           | Installing, writing a first tool, and running a first agent                    |
| [Architecture](./architecture.md)                 | How the pieces fit together and the design rules behind them                   |
| [Tools](./tools.md)                               | Creating, discovering, injecting dependencies into, linting and running tools  |
| [Agents](./agents.md)                             | The agent loop, builder, structured output, transcripts and limits             |
| [Configuration](./configuration.md)               | Framework, provider and agent config, including JSON Schema output validation  |
| [Runtime registration](./runtime-registration.md) | Adding and removing agents on a running process (for example from an endpoint) |
| [Providers](./providers.md)                       | Anthropic and OpenAI adapters, dialects, and writing your own `ModelClient`    |
| [Error handling](./error-handling.md)             | What is returned as data, what throws, and how to handle each                  |
| [Testing](./testing.md)                           | Testing tools and agents without a network                                     |

## A 30-second tour

```ts
import { AgentFramework, AgentTool, ToolBase } from "@hiddendevs/agent-framework";
import z from "zod";

// 1. A tool is a decorated class.
const schema = z.object({ city: z.string().describe("City name") });

@AgentTool({ name: "weather", description: "Current weather for a city", inputValidationSchema: schema })
class WeatherTool extends ToolBase<typeof schema> {
    public execute({ city }: z.infer<typeof schema>) {
        return { city, tempC: 21 };
    }
}

// 2. Agents are configuration.
const framework = await AgentFramework.create({
    providers: { main: { provider: "anthropic", model: "<model>", apiKey: process.env.API_KEY! } },
    agents: { assistant: { provider: "main", tools: ["weather"] } },
});

// 3. Run one.
const result = await (await framework.agent("assistant")).run("Is it warm in Lisbon?");
if (result.isOk) console.log(result.value.output);
```

## Conventions used in these docs

- Examples use ESM and Zod 4. The package is ESM (`"type": "module"`), requires Node.js 22.12 or newer,
  and uses legacy (`experimentalDecorators`) TypeScript decorators.
- "The model" means the LLM behind a provider. "A tool call" is the model asking the framework to run a tool.
- Everything exported is imported from `@hiddendevs/agent-framework`.
