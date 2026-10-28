# Plan: `@hiddendevs/agent-framework`

A configuration-driven AI agent framework for TypeScript with easy tool creation and discovery.

Architecture reference: the Groovy `com.burris.portal.base.generic.ai` package (agent loop, provider adapters, dialects, error-as-data contract). It is a **design reference, not a port target** — where it conflicts with the goals below, the goals win.

---

## 1. Goals

Every section and milestone must serve one of these. If a piece of work serves none, cut it.

| #   | Goal                          | Meaning                                                                                                                                                                   |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | **Easy tool creation**        | One decorated class + one Zod schema = a working tool. No manual registration, no boilerplate, no schema/validator drift.                                                 |
| G2  | **Easy tool discovery**       | Point the framework at a directory; tools are found, registered, and addressable by name. No hand-maintained import lists.                                                |
| G3  | **Configuration-driven**      | Agents (provider, prompt, tool names, output shape, limits) are described by plain JSON-serializable config and built from it — no code change to add or retune an agent. |
| G4  | **Self-correcting, reliable** | Model mistakes (bad args, unknown tools, invalid output) are returned to the model as data and retried; the loop never throws on model misbehavior.                       |
| G5  | **Provider-agnostic**         | The agent loop talks to one `ModelClient` interface; Anthropic and OpenAI are adapters selected by config.                                                                |

Non-goals: Grails/Spring machinery, classpath scanning, a Groovy-style schema DSL/facade (raw Zod only), multi-agent orchestration (future), streaming (future).

**Design tests** (use when making decisions):

- Adding a tool should touch exactly one new file (G1, G2).
- Adding or changing an agent should touch only config (G3).
- A tool's advertised JSON Schema and its runtime validator must come from the same Zod definition (G1, G4).

---

## 2. Current state (what exists)

| Area      | File                                                       | Status                                                                                                                                                |
| --------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creation  | [src/tools/tool-decorator.ts](src/tools/tool-decorator.ts) | `@AgentTool({ name, description, inputValidationSchema })` stamps statics on the class and registers it. `ToolBase.execute(input)` is abstract.       |
| Discovery | [src/tools/tool-collector.ts](src/tools/tool-collector.ts) | `ToolCollector.collect(paths, { extensions })` recursively imports modules; returns all registered classes.                                           |
| Registry  | [src/tools/tool-registry.ts](src/tools/tool-registry.ts)   | Static `TOOL_CLASSES` map, `registerToolClass` (rejects duplicates), `getToolClass(es)`, `load`, clear helpers. `TOOL_INSTANCES` declared but unused. |
| Types     | [src/global.ts](src/global.ts)                             | `JSONValue`, `MaybeAsync`.                                                                                                                            |
| Tests     | [tests/tools](tests/tools)                                 | Decorator and collector specs.                                                                                                                        |

Conventions to keep: ESM (`.js` import suffixes), Zod 4, legacy decorators, Vitest, tools discovered by importing modules (decorator side effect), tool classes are **not instantiated** at discovery.

**Gaps against the goals:**

- Tools cannot yet be _run_ safely: no validate-then-execute path with error-as-data (G1, G4).
- No tool instantiation/dependency story; `TOOL_INSTANCES` is unused (G1).
- No registration lint (name format, reserved `submit_result`, described properties) (G4).
- Nothing consumes tools: no model types, agent loop, providers, or config (G3, G4, G5).

---

## 3. Target layout

Extends the existing `src/` tree; no `src/ai/` nesting.

```
src/
  global.ts  index.ts
  result.ts                          Result<T,E>
  tools/                             (exists)
    tool-decorator.ts  tool-collector.ts  tool-registry.ts
    tool-result.ts                   ToolResult (success/error as data)
    tool-runner.ts                   validate + execute + error-as-data
    tool-set.ts                      immutable name-keyed selection of runnable tools
    tool-lint.ts                     startup registration checks
  model/                             provider-agnostic conversation types
    role.ts  stop-reason.ts
    content-block.ts                 TextBlock / ToolCallBlock / ToolResultBlock
    message.ts  model-client.ts  model-request.ts  model-response.ts
  agent/
    agent.ts  agent-builder.ts  agent-result.ts  agent-error.ts
    agent-config.ts                  zod schema for persisted agent config
    agent-factory.ts                 config -> Agent
  providers/
    provider-config.ts  model-client-factory.ts  model-client-error.ts
    result-content.ts
    anthropic/anthropic-client.ts  anthropic/anthropic-dialect.ts
    openai/openai-client.ts        openai/openai-strict-dialect.ts
    provider-dialect.ts  json-schema-util.ts
tests/                               mirrors src/
```

---

## 4. Tools (G1, G2) — build on what exists

### 4.1 Creation: keep the decorator model

```ts
const inputSchema = z.object({ query: z.string().describe("What to search for") });

@AgentTool({ name: "search", description: "Search for information", inputValidationSchema: inputSchema })
class SearchTool extends ToolBase<typeof inputSchema> {
    public execute(input: z.infer<typeof inputSchema>) {
        return { query: input.query };
    }
}
```

The decorator stays the single source of tool metadata. The Zod schema is both the validator and (via `z.toJSONSchema`) the advertised schema (G1 design test 3). Zod idioms: `z.coerce.number().int()` for tolerant integers, `.nullable().optional()` for "absent or null", `.default(v)`, `.describe()` on **every** property (enforced by lint, §4.4).

**Dependencies:** tools may need services. Constructor injection through a resolver supplied at runtime, not decorator-time:

```ts
type ToolFactory = (toolClass: ToolClass) => Tool; // default: `new toolClass()`
```

Tools with no dependencies need no setup (default factory). Tools with dependencies are provided via `ToolSet.from(registry, names, { factory })` or a per-class map. Instances are cached in `ToolRegistry.TOOL_INSTANCES` (this finally uses the existing field) and cleared by `clearToolInstances()`.

### 4.2 `ToolResult` and `ToolRunner` — error-as-data (G4)

```ts
class ToolResult { content: JSONValue; error: boolean; static success(c); static error(msg) }

ToolRunner.run(tool: Tool, toolClass: ToolClass, args: unknown): Promise<ToolResult>
```

`run` = `safeParse(args)` → on failure `ToolResult.error("Invalid arguments: path: message; …")` (all issues) → `await tool.execute(data)` inside try/catch → `ToolResult.error("Tool <name> failed: …")`. **Nothing escapes as an exception.** `execute` may be sync or async (`MaybeAsync`) and the runner is therefore async.

### 4.3 `ToolSet` — what an agent can use

Immutable name→(class, instance) map built from the registry by name (`ToolSet.from(names)`; throws on unregistered names, at build time). Provides `names()`, `specs()` (`{ name, description, inputSchema }`), `call(name, args)` (unknown name → `ToolResult.error("Unknown tool: x. Available tools: …")`), `plus(other)`. Agent config references tools **only by name** (G3).

### 4.4 Lint (`tool-lint.ts`) — fail at boot, not at model time

Run when building a `ToolSet` (and optionally via `ToolRegistry.validateAll()`):

- name matches `^[a-zA-Z0-9_-]{1,64}$`; `submit_result` is reserved
- description non-empty
- `z.toJSONSchema(schema)` is `type: "object"`
- every property, recursively (including array items), has a `description`

Duplicate-name rejection already exists in `registerToolClass`.

### 4.5 Discovery — keep, tighten

Keep `ToolCollector` behavior as documented in [README.md](README.md). Additions:

- `ToolRegistry.load` is the config-facing entry point; agent/app config may list tool directories (§6.2).
- Document (already in README) that collect returns the **whole** registry snapshot — agent configs, not directory scans, decide which tools an agent may use.

---

## 5. Agent runtime (G4, G5)

### 5.1 Model layer (`src/model/`)

Provider-agnostic types; `ModelClient.complete(request): Promise<ModelResponse>` is the only thing `Agent` talks to.

- `ContentBlock` abstract + `TextBlock`, `ToolCallBlock { id, name, arguments, argumentError | null }`, `ToolResultBlock { toolCallId, result: ToolResult }`; `instanceof` dispatch.
- `Message { role, content }` (`Message.user(text | blocks)`, `Message.assistant(blocks)`, `toolCalls()`, `text()`); immutable copies.
- `ModelRequest { systemPrompt, messages, tools: ToolSpec[], maxTokens, forcedToolName }`; `ModelResponse { message, stopReason }`.
- `enum Role { USER, ASSISTANT }`, `enum StopReason { END_TURN, TOOL_USE, MAX_TOKENS, OTHER }`.
- `ToolCallBlock.argumentError` is set when the model's argument JSON failed to parse or was not an object (arguments become `{}`); the loop turns it into a corrective tool result.

### 5.2 `Agent` loop

Async, error-as-data. Per turn: call the model → if no tool calls: return text (no output schema), or after `maxOutputRetries` throw, else add a corrective user message and force `submit_result` → otherwise answer **every** tool call with a result block (argument error, submit validation, or `ToolSet.call`), append all blocks as **one** user message, return on a valid submit.

Constants: `SUBMIT_TOOL = "submit_result"`; grounding instruction: _"Only use values the user provided or that tools returned. When a value is not known, use null for fields that allow it or leave optional fields out. Never invent IDs, names, dates, amounts or other specifics to fill a field."_

Defaults: `maxTurns 10`, `maxTokens 4096`, `maxOutputRetries 2`, grounding on, outputDescription `"Submit your final answer"`.

`agent.run(input): Promise<Result<AgentResult<O>, AgentError>>`; `runConversation(messages)` resumes from a prior transcript. Failures throw only for budget exhaustion / max tokens / unsubmitted output, always carrying the transcript.

### 5.3 `AgentBuilder` (code path to the same thing config builds)

Fluent: `systemPrompt`, `tools(...names | ToolSet)`, `maxTurns`, `maxTokens`, `maxOutputRetries`, `groundingInstruction`, `output<R>(schema, description?)` (returns a **new** `AgentBuilder<R>` with copied state), `build()` (validates output schema is `type: "object"`, `maxTurns/maxTokens ≥ 1`, `maxOutputRetries ≥ 0`). System prompt `${tools}` is replaced with the JSON tool-name list.

### 5.4 Providers (`src/providers/`)

- `enum Provider { ANTHROPIC, OPENAI }`; `ProviderConfig { provider, model, apiKey, baseUrl, maxRetries (2), timeoutSeconds }` — `toString()` never prints the key.
- `ModelClientFactory.create(config)` switches on provider; SDK clients (`@anthropic-ai/sdk`, `openai`) are wrapped and long-lived. SDK errors are wrapped in `ModelClientError { statusCode (-1 non-HTTP), isRateLimited(), isAuthenticationFailure() }`.
- `ProviderDialect` (`adaptSchema`, `normalizeArguments`): `AnthropicDialect` = identity; `OpenAiStrictDialect` rewrites emitted JSON schema for strict function calling (drop unsupported keywords, optional → nullable, all properties required, `additionalProperties: false`) and drops `null` for optional fields on incoming args so schema, args, and validator agree.
- Anthropic: `tool_use`/`tool_result` blocks with `is_error`, `tool_choice` for forced submit, empty messages dropped. OpenAI: `strict: true` function tools, JSON-string call args, each tool result is its own `tool` message, `max_completion_tokens`. Stop-reason mapping per provider as in the Groovy reference.
- `ResultContent.asText(content)`: `null → ""`, string passthrough, else `JSON.stringify`.

---

## 6. Configuration (G3)

Everything an agent needs is a JSON-serializable object, validated by Zod at load time with errors reported as data/clear messages.

### 6.1 Agent config

```ts
const AgentConfigSchema = z.object({
    provider: z.string(), // key into provider configs
    systemPrompt: z.string().optional(),
    tools: z.array(z.string()).default([]), // registered tool names
    outputSchema: z.record(z.string(), z.unknown()).optional(), // limited JSON Schema, §6.3
    outputDescription: z.string().optional(),
    maxTurns: z.number().int().min(1).optional(),
    maxTokens: z.number().int().min(1).optional(),
    maxOutputRetries: z.number().int().min(0).optional(),
    groundingInstruction: z.boolean().optional(),
});
```

### 6.2 Framework config

```ts
type FrameworkConfig = {
    toolPaths?: string[]; // fed to ToolRegistry.load
    toolExtensions?: ToolModuleExtension[];
    providers: Record<string, ProviderConfigInput>;
    agents: Record<string, AgentConfigInput>;
};
```

Entry point: `AgentFramework.create(config, { toolFactory })` → loads tools (G2), validates/lints them, builds model clients, and exposes `framework.agent("name")` which returns a ready `Agent` (fresh and stateless per call). Adding an agent = adding an entry to `agents`.

`AgentFactory.fromConfig(agentConfig, providerConfig, toolSet)` is the unit underneath; `AgentFactory.agent()` returns an `AgentBuilder` for code-first use.

### 6.3 `outputSchema` loader (`JsonSchemaLoader`)

Compiles the **limited** persisted JSON Schema dialect into Zod so output shapes are configurable: `type` (incl. `["t","null"]` → nullable), `description`, `default`, strings (`minLength/maxLength/pattern/format ∈ {email,date}/enum`), numbers (`minimum/maximum`, optional string coercion), arrays (`items/minItems/maxItems`), objects (`properties/required/additionalProperties`). Unknown keywords throw with a JSON-pointer-style path. Optional wraps outside default (`.default(v).optional()`). Defer until the core loop works; code-first `output(zodSchema)` covers the interim.

---

## 7. Behavioral invariants (each needs a test)

1. **Error-as-data:** invalid tool args, unknown tools, unparseable model JSON, and invalid submissions become transcript results; the loop throws only on budget exhaustion / max tokens / no submission.
2. **Single failure counter:** prose-instead-of-submit and invalid submissions share `outputFailures`; abort when it exceeds `maxOutputRetries`. A valid submit wins even if sibling calls failed.
3. **Every tool call gets a result block**; all blocks go in **one** user message so transcripts stay resumable.
4. **Forced submission:** prose answer from a structured agent → one corrective message + `forcedToolName`, honored via `tool_choice`.
5. **Dual-purpose schema:** advertised JSON Schema and validator derive from the same Zod object.
6. **Startup lint:** name regex, reserved name, duplicates, description, object schema, described properties — fail at build, not model time.
7. **Discovery is side-effect-only registration:** collecting never instantiates tools; instances are created on demand and cached.
8. **Config-only agents:** an agent built from config behaves identically to the same agent built with `AgentBuilder`.
9. **OpenAI three-way agreement:** strict emission, null→absent normalization, and validator agree.
10. **Per-provider transcript shape** (Claude drops empty messages; OpenAI separate `tool` messages with string args).
11. **Immutability:** value classes copy inputs into readonly structures.

---

## 8. Decisions

| #   | Decision                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Tools are decorated classes with static metadata (existing design) — not manual `new Tool()` registration or a name/description getter pattern.                                     |
| D2  | Tools are referenced by **name** in config; instances are created lazily by a factory (default `new`), cached in the registry.                                                      |
| D3  | Raw Zod everywhere; no schema facade. `"null"`-string leniency is out unless a real need appears (the error loop self-corrects).                                                    |
| D4  | `.nullable().optional()` means "absent or null"; `.nullable()` alone means null allowed, absence rejected. Zod-native `undefined` for absent values.                                |
| D5  | `ToolRegistry` stays static/global (existing). Test isolation via `clearToolClasses()` / `clearToolInstances()`; a per-instance registry is a later option if hot reload is needed. |
| D6  | Dead Groovy surface (`formatTool`/`formatResult`, duplicate `ResultContent`, `EmitContext`, `SchemaException`, wrapper schema classes, `Schemas` facade) is not recreated.          |
| D7  | Zod 4 (`z.toJSONSchema`). Recursive `$defs`/`$ref` schemas are a future extension.                                                                                                  |

---

## 9. Milestones

Each milestone ends with passing `npm run typecheck`, `npm run lint`, `npm test`.

1. **Runnable tools (G1, G4)** — `ToolResult`, `ToolRunner`, instance creation + cache via `ToolRegistry`, `ToolSet`, lint. Tests: valid/invalid/throwing tools, unknown name, every lint rule.
2. **Model types (G5)** — `Result`, enums, content blocks, `Message`, `ModelRequest/Response`, `ModelClient`.
3. **Agent loop (G4)** — `Agent`, `AgentBuilder`, `AgentResult`, `AgentError`, grounding/`${tools}` prompt. Tests with a scripted `FakeModelClient` (no network) covering invariants 1–5, 11.
4. **Providers (G5)** — `ProviderConfig`, dialects + `JsonSchemaUtil`, `ModelClientFactory`, Anthropic then OpenAI clients (add SDK deps). Tests against recorded fixtures: message shaping, stop reasons, `argumentError`, error wrapping.
5. **Configuration (G3)** — `AgentConfigSchema`, `AgentFactory.fromConfig`, `AgentFramework.create` with `toolPaths` discovery. Tests: config agent ≡ builder agent (invariant 8), bad config errors, tools resolved by name.
6. **Config-driven output schemas (G3)** — `JsonSchemaLoader` and tests for every keyword and rejection path.
7. **Docs and verification** — extend [README.md](README.md) with creation → discovery → config → run; one live smoke run (real provider, a discovered tool, a structured output).

Order: 1 → 2 → 3 → (4 ∥ 5) → 6 → 7. Milestone 1 is the next unit of work: it makes the existing tool surface actually usable.

Done when every invariant in §7 has a green test and the live smoke run passes from a config file alone.
