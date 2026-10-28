# Config-driven agent

This standalone project shows a complete provider-backed agent. It discovers a decorated TypeScript tool from
compiled output, builds an agent from plain configuration, and asks the model for validated structured output.
The weather tool is intentionally deterministic sample data; replace its implementation with a real service.

## Setup

From the repository root, build and publish the framework to your local yalc store:

```bash
npm run build
yalc publish
```

Then from this directory:

```bash
yalc add @hiddendevs/agent-framework
npm install
```

Set an Anthropic key and optionally a model name:

```bash
export ANTHROPIC_API_KEY="..."
export ANTHROPIC_MODEL="claude-sonnet-4-5"
npm start -- "What is the weather in Lisbon?"
```

`npm start` compiles this project first. Tool discovery scans `dist/tools`, where the compiled decorator module
registers `current-weather` on import.

## Project map

- `src/tools/weather-tool.ts`: a typed `ToolBase`, Zod input schema and `@AgentTool` metadata.
- `src/main.ts`: tool discovery, provider and agent config, structured output, and a single run.
- `tsconfig.json`: strict ESM TypeScript with legacy decorator support.

Run `npm run typecheck` to check the source without starting the provider call. The API key is required at runtime.
