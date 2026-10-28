# Providers

A **provider** connects the agent loop to a model API. The loop depends only on the `ModelClient` interface:

```ts
interface ModelClient {
    complete(request: ModelRequest): Promise<ModelResponse>;
}
```

Two adapters are included: `AnthropicClient` and `OpenAiClient`.

## Selecting a provider

Set `provider` to `"anthropic"` or `"openai"` in the provider config (see
[Configuration](./configuration.md#provider-config)). `ModelClientFactory.create(config)` builds the right client:

```ts
const client = await ModelClientFactory.create(
    ProviderConfig.parse({ provider: "anthropic", model: "<model>", apiKey }),
);
```

The SDK is imported lazily, so only the SDK for the provider you use needs to be installed.
`baseUrl`, `maxRetries` (default 2) and `timeoutSeconds` are passed to the SDK.

`AgentFramework` calls the factory each time you call `framework.agent(name)`. If you build many agents per
second, pass a `clientFactory` option that caches clients per provider config.

## `ModelRequest` and `ModelResponse`

`ModelRequest` carries `systemPrompt` (or `null`), `messages`, `tools` (specs), `maxTokens` and `forcedToolName`
(or `null`), plus `findTool(name)`. `ModelResponse` carries an assistant `message` and a `stopReason`:
`END_TURN`, `TOOL_USE`, `MAX_TOKENS` or `OTHER`.

## Dialects

Providers accept slightly different JSON Schema. A `ProviderDialect` adapts to them:

```ts
interface ProviderDialect {
    adaptSchema(schemaJson: Record<string, unknown>): Record<string, unknown>;
    normalizeArguments(args: Record<string, unknown>, schema: z.ZodType): Record<string, unknown>;
}
```

- `adaptSchema` rewrites the schema emitted from Zod before it is sent.
- `normalizeArguments` reshapes the model's arguments before they are validated.

### Anthropic

`AnthropicDialect` changes nothing. Messages map to `text`, `tool_use` and `tool_result` blocks (with `is_error`
for error results). Messages with no content are dropped. A forced `submit_result` uses `tool_choice`.
Stop reasons: `end_turn` and `stop_sequence` become `END_TURN`, `tool_use` becomes `TOOL_USE`, `max_tokens` becomes
`MAX_TOKENS`.

### OpenAI

OpenAI strict function calling demands that every property is required and objects are closed. `OpenAiStrictDialect`
therefore:

- **On the way out:** removes unsupported keywords (`$schema`, `default` by default; configurable through the
  constructor), makes every property required, makes previously optional properties nullable, and sets
  `additionalProperties: false` on every object.
- **On the way in:** because the model must send `null` for fields it wants to omit, `null` values for fields
  that are optional (or have a default) in your Zod schema are removed before validation. Required fields keep
  their `null`, so validation still rejects it. It recurses through nested objects and arrays.

This keeps three things in agreement: the schema sent to OpenAI, the arguments that come back, and your
validator. Tools tell OpenAI `strict: true`. Each tool result becomes its own `tool` message (the Chat
Completions API has no error flag, so the error text itself tells the model), and tool-call arguments are
JSON strings. Finish reasons: `stop` becomes `END_TURN`, `tool_calls` becomes `TOOL_USE`, `length` becomes
`MAX_TOKENS`. `max_completion_tokens` is used.

## Malformed model output

If the model returns tool arguments that are not valid JSON, or not a JSON object, the adapter produces a
`ToolCallBlock` with `argumentError` set and `{}` as its arguments. The agent turns that into an error result for
the model to correct; the adapter itself does not throw.

## Provider failures

SDK exceptions are wrapped in `ModelClientError`:

| Member                      | Meaning                                    |
| --------------------------- | ------------------------------------------ |
| `statusCode`                | HTTP status, or `-1` for non-HTTP failures |
| `isRateLimited()`           | status 429                                 |
| `isAuthenticationFailure()` | status 401 or 403                          |
| `cause`                     | the original SDK error                     |

`ModelClientError` is **not** converted into an `AgentError`: `agent.run()` rejects with it, because it is an
infrastructure failure rather than something the model can fix. Catch it where you call `run`:

```ts
try {
    const result = await agent.run(input);
} catch (error) {
    if (error instanceof ModelClientError && error.isRateLimited()) {
        // back off and retry
    } else {
        throw error;
    }
}
```

## Writing your own `ModelClient`

Implement `complete`. Convert `request.messages` to your API's format, send `request.tools` (use
`z.toJSONSchema(spec.inputSchema, { io: "input" })`), honour `request.forcedToolName` if your API supports forcing
a tool, and return a `ModelResponse` built from `Message.assistant([...blocks])`.

```ts
import { Message, ModelResponse, StopReason, TextBlock, type ModelClient } from "@hiddendevs/agent-framework";

const client: ModelClient = {
    async complete(request) {
        const reply = await myApi.chat(request.messages.map(toWireFormat));
        return new ModelResponse(Message.assistant([new TextBlock(reply.text)]), StopReason.END_TURN);
    },
};
```

Use it directly with `AgentBuilder.create(client)`, or through the framework with the `clientFactory` option. When
parsing tool arguments yourself, set `argumentError` on the `ToolCallBlock` instead of throwing, and apply a
dialect's `normalizeArguments` if your API needs one.
