# Custom client and dependency injection

This fully offline project demonstrates two extension points: implement `ModelClient` for a custom inference
backend, and provide a `ToolFactory` to inject app services into a tool. A deterministic local client simulates a
tool call followed by a final answer, so running it needs no provider SDK, API key, or network.
The agent also shows a Liquid system prompt with builder context defaults and a per-run user override.

## Setup

From the repository root:

```bash
npm run build
yalc publish
```

Then from this directory:

```bash
yalc add @hiddendevs/agent-framework
npm install
npm start
```

The output is deterministic and should say that `acct-42` is on the team plan and is active.

## Project map

- `src/tools/account-lookup.ts`: a tool with a constructor-injected `AccountService`.
- `src/main.ts`: an in-memory service, a `ToolFactory`, an offline `ModelClient`, and a code-first agent.
- `tsconfig.json`: strict TypeScript with ESM and legacy decorators.

The factory is called lazily and each tool instance is cached by the framework registry. For a real application,
replace `InMemoryAccounts` and `LocalDemoClient` with your database-backed service and a `ModelClient` adapter.
The rest of the agent and tool interface remains unchanged.

Run `npm run typecheck` to typecheck the entire project.
