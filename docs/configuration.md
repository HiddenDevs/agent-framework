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

| Field                  | Type               | Default                    | Notes                                          |
| ---------------------- | ------------------ | -------------------------- | ---------------------------------------------- |
| `provider`             | `string`           | -                          | Required. A key in `providers`                 |
| `systemPrompt`         | `string`           | none                       | `${tools}` becomes the JSON list of tool names |
| `tools`                | `string[]`         | `[]`                       | Registered tool names                          |
| `outputSchema`         | object             | none                       | Structured output, see below                   |
| `outputDescription`    | `string`           | `Submit your final answer` | Description of `submit_result`                 |
| `maxTurns`             | integer, 1 or more | `10`                       |                                                |
| `maxTokens`            | integer, 1 or more | `4096`                     |                                                |
| `maxOutputRetries`     | integer, 0 or more | `2`                        |                                                |
| `groundingInstruction` | `boolean`          | `true`                     |                                                |

Unknown fields are ignored (stripped), not rejected.

An agent built from config behaves identically to one built with `AgentBuilder` using the same values.

## Output schema dialect

`outputSchema` is a deliberately **limited** subset of JSON Schema. `JsonSchemaLoader.fromJson(json)` compiles
it into Zod. Anything outside the subset is rejected with a path such as
`Invalid schema at #/properties/age/format: unsupported keyword "format"`, so mistakes are found when the agent
is built, not at model time.

Allowed on every node: `type`, `description`, `default`.

| `type`    | Extra keywords                                        | Zod result                                                           |
| --------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| `string`  | `minLength`, `maxLength`, `pattern`, `format`, `enum` | `z.string()` with checks, or `z.enum` (all values must be strings)   |
| `number`  | `minimum`, `maximum`, `x-coerceStrings`               | `z.number()`; with `x-coerceStrings: true`, numeric strings accepted |
| `integer` | `minimum`, `maximum`, `x-coerceStrings`               | `z.coerce.number().int()` (numeric strings always accepted)          |
| `boolean` | none                                                  | `z.boolean()`                                                        |
| `array`   | `items` (required), `minItems`, `maxItems`            | `z.array(...)`                                                       |
| `object`  | `properties`, `required`, `additionalProperties`      | `z.object` / `z.strictObject` / `z.looseObject`                      |

Details:

- **Nullable:** `"type": ["string", "null"]` allows `null`. Only one concrete type plus `"null"` is allowed.
- **`format`:** `"email"` (a loose `x@y.z` check) or `"date"` (ISO-8601 date or date-time).
- **`pattern`:** a JavaScript regular expression source.
- **Objects:** every name in `required` must exist in `properties`. Properties not listed in `required` are
  optional: absent or `null` is accepted. A property with a `default` is optional and the default applies when
  the value is absent.
- **`additionalProperties`:** `false` rejects unknown keys, `true` keeps them, omitted strips them.
- **`default`:** validated against the node's own schema at load time; an invalid default is an error.
- **Conflicts:** `minLength` greater than `maxLength` is rejected.

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

Need something outside the subset (unions, `$ref`, `oneOf`)? Build the agent in code with `AgentBuilder.output(zodSchema)`.
Note that the output schema must have a root of `type: "object"`.

## Where configuration comes from

The framework does not read files or databases itself; hand it an object. Typical sources are a JSON file
(`JSON.parse(await readFile(...))`), environment-specific modules, a database table, or an HTTP request body
(see [Runtime registration](./runtime-registration.md)). Keep API keys out of agent configs: agents only name a
provider, and the provider holds the key.
