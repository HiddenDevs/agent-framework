# Runtime registration

Agents (and providers) can be added to a running `AgentFramework` without a redeploy. The typical use is a generic
endpoint that lets developers or administrators define new agents as data.

## API

```ts
framework.registerAgent(name, config, { replace?: boolean }): Result<AgentConfig>
framework.unregisterAgent(name): boolean
framework.hasAgent(name): boolean
framework.agentNames(): string[]
framework.getAgentConfig(name): AgentConfig | undefined
framework.registerProvider(name, providerConfig): void   // throws on invalid config
framework.loadTools(paths, extensions?): Promise<void>   // trusted paths only
await framework.agent(name): Agent                       // build and use
```

### `registerAgent`

`config` is `unknown` on purpose: pass a request body straight in. Before anything is stored it checks:

1. The name is not blank.
2. The name is not already taken (unless `replace: true`).
3. The config passes the [agent config schema](./configuration.md#agent-config).
4. The named provider exists in this framework.
5. The agent can actually be built: every tool name is registered and passes lint, limits are in range, and the
   `outputSchema` compiles.

It returns a `Result`. On failure `result.error.message` describes the first problem and **nothing is stored**.
On success `result.value` is the parsed config, with defaults applied. Registration never contacts a model
provider or creates an SDK client.

Registration is in effect immediately for later `framework.agent(name)` calls. Agents already built keep
the configuration they were built with.

## Example: a generic endpoint

Using any HTTP framework (shown here with Express-style handlers):

```ts
app.put("/agents/:name", async (req, res) => {
    const result = framework.registerAgent(req.params.name, req.body, { replace: true });
    if (!result.isOk) return res.status(400).json({ error: result.error.message });
    res.status(204).end();
});

app.delete("/agents/:name", (req, res) => {
    res.status(framework.unregisterAgent(req.params.name) ? 204 : 404).end();
});

app.get("/agents", (_req, res) => res.json(framework.agentNames()));

app.post("/agents/:name/run", async (req, res) => {
    if (!framework.hasAgent(req.params.name)) return res.status(404).end();

    const agent = await framework.agent(req.params.name);
    const result = await agent.run(String(req.body.input ?? ""));

    if (!result.isOk) return res.status(502).json({ error: result.error.message });
    res.json({ output: result.value.output, turns: result.value.turns });
});
```

A request body such as this defines a complete agent:

```json
{
    "provider": "main",
    "systemPrompt": "You triage support tickets. Tools: ${tools}",
    "tools": ["customer-lookup"],
    "maxTurns": 6,
    "outputSchema": {
        "type": "object",
        "required": ["priority"],
        "properties": { "priority": { "type": "string", "enum": ["low", "high"], "description": "Urgency" } }
    }
}
```

## Providers at runtime

```ts
framework.registerProvider("backup", { provider: "openai", model: "<model>", apiKey });
framework.registerAgent("triage", { provider: "backup" });
```

`registerProvider` validates the config and overwrites an existing provider of the same name. Provider configs
contain secrets, so keep this method behind trusted code and do not expose it unauthenticated.

## Adding tools at runtime

Agents can only use tools that are already registered. New tools arrive as code, so they come from
`loadTools`:

```ts
await framework.loadTools("./dist/plugins"); // after deploying new tool modules to disk
framework.registerAgent("new-agent", { provider: "main", tools: ["new-tool"] });
```

Be aware that `loadTools` **executes** the modules it imports. Use fixed, trusted paths. Do not accept paths from
request data. Because of Node's module cache, a module imported once is not re-executed, so changing an already
loaded tool still requires a restart.

## Security model

Config submitted by a caller can only:

- choose among tools and providers you have already installed,
- set prompts, limits and an output shape.

It cannot run new code or read secrets. That makes `registerAgent` reasonable to expose to semi-trusted users,
but you still need to consider:

- **Authorization.** Decide who may register or replace agents. A caller can give an agent any registered tool.
  If a tool is dangerous (for example it deletes data), restrict who can attach it, for example by wrapping
  `registerAgent` and rejecting configs whose `tools` are not on a per-user allowlist.
- **Cost.** `maxTurns`, `maxTokens` and `maxOutputRetries` come from the config. Enforce upper bounds in your
  endpoint before registering.
- **Prompt content.** A system prompt is user-controlled text sent to your provider account.
- **Name collisions.** Use `replace: false` (the default) unless overwriting is intended.

## Persistence and multiple instances

Registrations live in the memory of one `AgentFramework` object. They are lost on restart and are not shared
between processes. To persist them:

1. On every successful `registerAgent`/`unregisterAgent`, write the config to your database.
2. On startup, read them back and pass them as `agents` to `AgentFramework.create`, or call
   `registerAgent(name, config)` for each.

For several instances, publish changes (queue, pub/sub, polling) and have each instance apply them with the same
calls. Last write wins; there is no versioning built in.

## Concurrency

Registration methods are synchronous and complete atomically within a single event-loop tick, so concurrent
requests cannot observe a half-registered agent. `framework.agent()` reads the stored config once when it is
called.
