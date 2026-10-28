# Temporary runtime agents

Build an agent from a config for the current request without registering a name or storing it in
`AgentFramework`. Tools and providers are still configured by the host application.

## API

```ts
await framework.createAgent(config): Agent<unknown>     // build a temporary agent
await framework.agent(name): Agent<unknown>             // build a startup-configured agent
framework.hasAgent(name): boolean                       // startup-configured names only
framework.agentNames(): string[]                        // startup-configured names only
framework.getAgentConfig(name): AgentConfig | undefined // startup-configured configs only
framework.registerProvider(name, providerConfig): void   // throws on invalid config
framework.loadTools(paths, extensions?): Promise<void>   // trusted paths only
```

### `createAgent`

`config` is `unknown` on purpose: callers can pass a request body. The method:

1. Validates the [agent config schema](./configuration.md#agent-config), applying defaults.
2. Resolves an existing provider and creates a model client using the framework's `clientFactory`, if supplied.
3. Builds the agent, validating tool selections and lint, the output schema, and Liquid prompt syntax and filters.

It returns `Promise<Agent<unknown>>` directly, not a `Result`. Invalid configs, unknown providers or tools,
invalid prompts or output schemas, and client creation failures reject the promise. Building does not call
the model; `agent.run` or `agent.runConversation` does that.

The framework retains neither the temporary config nor the agent or model client. Each call builds a fresh
agent and client, leaving named agents unchanged. Keep the returned agent local to the request; there is
nothing to unregister after the run. Tool classes and cached tool instances remain in the shared
`ToolRegistry`; temporary agents do not change that lifecycle.

Output schemas use Zod's `fromJSONSchema`; conversion is not full JSON Schema meta-schema validation.
See [Output schemas](./configuration.md#output-schemas).

## Example: a single-request endpoint

Using any HTTP framework (shown here with Express-style handlers):

```ts
const runRequestSchema = z.object({
    config: AgentConfigSchema,
    input: z.string(),
    context: z.record(z.string(), z.unknown()).optional(),
});

app.post("/agents/run", async (req, res, next) => {
    const parsed = runRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    try {
        const agent = await framework.createAgent(parsed.data.config);
        const result = await agent.run(parsed.data.input, parsed.data.context);
        if (!result.isOk) return res.status(502).json({ error: result.error.message });
        res.json({ output: result.value.output, turns: result.value.turns });
    } catch (error) {
        next(error); // map build errors to 400 and provider failures to 429/502 in your error handler
    }
});
```

Send config and input together:

```json
{
    "config": {
        "provider": "main",
        "systemPrompt": "You triage {{ organization }} support tickets. Tools: {{ tools | json }}",
        "context": { "organization": "Acme" },
        "tools": ["customer-lookup"],
        "maxTurns": 6,
        "outputSchema": {
            "type": "object",
            "required": ["priority"],
            "properties": { "priority": { "type": "string", "enum": ["low", "high"], "description": "Urgency" } }
        }
    },
    "input": "I cannot sign in."
}
```

Optional per-run `context` shallowly overrides the config defaults for that call. Provide only context the
caller is authorized to expose to the model. Missing template values reject the run before contacting the provider.

## Providers and tools at runtime

```ts
framework.registerProvider("backup", { provider: "openai", model: "<model>", apiKey });
const agent = await framework.createAgent({ provider: "backup" });
```

`registerProvider` validates the config and overwrites an existing provider of the same name. Provider configs
contain secrets, so keep this method behind trusted code.

New tools arrive as code, not request data:

```ts
await framework.loadTools("./dist/plugins");
const agent = await framework.createAgent({ provider: "main", tools: ["new-tool"] });
```

`loadTools` **executes** imported modules. Use fixed, trusted paths, never request data. Node's module cache
means already imported modules are not re-executed; changing a loaded tool still requires a restart.

## Authorization and limits

Caller-supplied configs select installed tools and providers, prompts, context, limits, and output shapes.
They cannot load new code, but they can invoke any selected tool. Before accepting a config:

- Authorize tool and provider selections, for example with per-user allowlists.
- Cap `maxTurns`, `maxTokens`, and `maxOutputRetries` to control cost.
- Treat prompts as caller-controlled content sent through your provider account.
- Never inject secrets or unauthorized context into the agent.
- Enforce request size, concurrency, and rate limits even though Liquid rendering has resource limits.

## Migration from runtime registration

`registerAgent` and `unregisterAgent` have been removed. Replace registration followed by a named lookup with:

```ts
const agent = await framework.createAgent(config);
const result = await agent.run(input, context);
```

There is no runtime agent map, replacement flag, name collision, or persistence/synchronization requirement.
Temporary agents do not appear in `agentNames`, `hasAgent`, or `getAgentConfig`. Those methods describe only
agents supplied to `AgentFramework.create({ providers, agents })` at startup.
