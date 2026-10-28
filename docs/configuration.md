# Configuration

Everything the framework needs to run an agent is JSON-serializable and validated by Zod when it is loaded.

## Framework config

```ts
const framework = await AgentFramework.create(
    {
        toolPaths: ["./dist/tools"],
        toolExtensions: [".js"],
        providers: { main: { provider: "openai", model: "<model>", apiKey: "..." } },
        agents: { helper: { provider: "main", tools: ["search"] } },
    },
    { toolFactory, clientFactory },
);
```

| Field            | Required | Meaning                                                                   |
| ---------------- | -------- | ------------------------------------------------------------------------- |
| `toolPaths`      | no       | Files/directories to scan for tools (default none). Trusted paths only    |
| `toolExtensions` | no       | Module extensions to scan, for example `[".ts"]`. Default JavaScript only |
| `providers`      | yes      | Map of provider name to [provider config](#provider-config)               |
| `agents`         | yes      | Map of agent name to [agent config](#agent-config). May be `{}`           |

`create` validates the whole config, checks that every agent references a defined provider, and loads the tools.
It rejects with a `ZodError` or an `Error` if anything is wrong. Tool selections and output schemas of the
initial agents are validated when `framework.agent(name)` builds them.

### Options (second argument)

| Option          | Meaning                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `toolFactory`   | `(toolClass) => Tool`. Supplies constructor dependencies. See [Tools](./tools.md#tools-that-need-dependencies) |
| `clientFactory` | `(providerConfig) => Promise<ModelClient>`. Replaces SDK client creation, mainly for tests                     |

Options are code, not data, so they are not part of the JSON config.

## Provider config

| Field            | Type                      | Default     | Notes                                |
| ---------------- | ------------------------- | ----------- | ------------------------------------ |
| `provider`       | `"anthropic" \| "openai"` | -           | Required                             |
| `model`          | `string`                  | -           | Required, non-empty                  |
| `apiKey`         | `string`                  | -           | Required, non-empty                  |
| `baseUrl`        | `string`                  | SDK default | For proxies and compatible endpoints |
| `maxRetries`     | integer, 0 or more        | `2`         | Retries performed by the SDK         |
| `timeoutSeconds` | positive number           | SDK default | Request timeout                      |

`ProviderConfig.parse(input)` validates and returns an object whose `toString()` never prints the key.

## Agent config

| Field                  | Type               | Default                    | Notes                                                     |
| ---------------------- | ------------------ | -------------------------- | --------------------------------------------------------- |
| `provider`             | `string`           | -                          | Required. A key in `providers`                            |
| `systemPrompt`         | `string`           | none                       | LiquidJS template; `{{ tools \| json }}` lists tool names |
| `context`              | object             | `{}`                       | Default template variables, shallowly overridden per run  |
| `tools`                | `string[]`         | `[]`                       | Registered tool names                                     |
| `outputSchema`         | object             | none                       | Structured output, see below                              |
| `outputDescription`    | `string`           | `Submit your final answer` | Description of `submit_result`                            |
| `maxTurns`             | integer, 1 or more | `10`                       |                                                           |
| `maxTokens`            | integer, 1 or more | `4096`                     |                                                           |
| `maxOutputRetries`     | integer, 0 or more | `2`                        |                                                           |
| `groundingInstruction` | `boolean`          | `true`                     |                                                           |

Unknown fields are ignored (stripped), not rejected.

An agent built from config behaves identically to one built with `AgentBuilder` using the same values.

```ts
const config = {
    provider: "main",
    systemPrompt: "Help {{ user.name }} at {{ organization }}. Tools: {{ tools | json }}",
    context: { organization: "Acme" },
    tools: ["search"],
};
```

Supply request-specific values with `agent.run(input, { user: { name: "Ada" } })` or the second argument to
`runConversation`. Context uses top-level merge semantics; `tools` cannot be overridden. Missing variables
reject the run unless handled with a conditional or `default` filter. See
[Prompt context](./agents.md#prompt-context) for rendering behavior and limits.

**Migration:** replace `${tools}` with `{{ tools | json }}` in stored prompts as well as code.

## Output schemas

`outputSchema` is a JSON Schema object converted directly with Zod's
[`z.fromJSONSchema()`](https://zod.dev/json-schema). There is no framework-specific schema dialect or keyword
allowlist. The resulting Zod schema validates `submit_result` arguments and is converted back to JSON Schema
for the model provider. The converted schema must have an object root.

Zod determines supported keywords, formats and conversion errors. It supports features such as `anyOf`, `oneOf`
and local `$ref`/`$defs`, but not every JSON Schema construct (for example, conditional `if`/`then`/`else`
schemas and external references are unsupported). Provider capabilities may impose further restrictions.
Zod currently labels `fromJSONSchema` semi-experimental; behavior can change with Zod versions.

Important semantics:

- **Numbers:** `integer` and `number` require numeric values; strings are not coerced.
- **Optional versus nullable:** omitting a property from `required` permits absence, not `null`.
  Allow null explicitly with, for example, `"type": ["string", "null"]`.
- **Formats:** use `"format": "date"` for date-only strings and `"format": "date-time"` for timestamps.
  Email validation uses Zod's built-in format rules.
- **Additional properties:** omitted or `true` preserves unknown keys; `false` rejects them.
- **Defaults:** Zod applies defaults without validating them against the field schema. Authors must provide
  valid defaults.
- **Extension keywords:** unknown keywords can be retained as metadata without enforcing a validation rule.
  Conversion is not a full JSON Schema meta-schema validation step; validate schema authors' input separately
  if you need to detect typos or invalid schemas.

Example:

```json
{
    "type": "object",
    "required": ["name", "email"],
    "additionalProperties": false,
    "properties": {
        "name": { "type": "string", "minLength": 1, "description": "Full name" },
        "email": { "type": "string", "format": "email", "description": "Contact email" },
        "age": { "type": "integer", "minimum": 0, "description": "Age in years" },
        "plan": { "type": "string", "enum": ["free", "pro"], "default": "free", "description": "Billing plan" },
        "tags": { "type": "array", "items": { "type": "string" }, "maxItems": 5, "description": "Labels" }
    }
}
```

For code-first validation, including coercions, build with `AgentBuilder.output(zodSchema)` instead. The Zod
schema must still be representable as an object-root JSON Schema for provider requests.

### Migration from the custom loader

This is a breaking change. The exported `JsonSchemaLoader` has been removed; use `z.fromJSONSchema()` directly
when converting schemas outside the framework.

- Replace integer strings with numbers; `x-coerceStrings` no longer enables coercion.
- Explicitly declare nullable fields where callers previously passed `null` for optional properties.
- Set `additionalProperties: false` to reject unexpected keys; omission no longer strips them.
- Use `date-time` instead of `date` for timestamps and review email values against Zod's format rules.
- Check defaults yourself; conversion no longer rejects invalid defaults.
- Do not rely on the former keyword allowlist or JSON-pointer-style error messages.

## Where configuration comes from

The framework does not read files or databases itself; hand it an object. Typical sources are a JSON file
(`JSON.parse(await readFile(...))`), environment-specific modules, a database table, or an HTTP request body
(see [Runtime registration](./runtime-registration.md)). Keep API keys out of agent configs: agents only name a
provider, and the provider holds the key.
