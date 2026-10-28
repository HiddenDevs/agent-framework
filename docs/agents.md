# Agents

An `Agent` runs a conversation with a model, letting it call tools until it produces a final answer.

## Creating agents

There are two equivalent routes:

- **From configuration** (`framework.agent("name")` or `AgentFactory.fromConfig`). See
  [Configuration](./configuration.md).
- **From code** with `AgentBuilder`, described below.

Agents are cheap, stateless and safe to build per request.

## The builder

```ts
import { AgentBuilder } from "@hiddendevs/agent-framework";

const agent = AgentBuilder.create(client, toolFactory?) // toolFactory is optional
    .systemPrompt("You are a support agent. Tools: ${tools}")
    .tools("order-lookup", "refund")
    .maxTurns(8)
    .maxTokens(2048)
    .maxOutputRetries(2)
    .groundingInstruction(true)
    .output(ResultSchema, "Submit the resolution")
    .build();
```

Each method returns a **new** builder, so a partly configured builder can be reused as a template.

| Method                               | Default          | Notes                                                                                  |
| ------------------------------------ | ---------------- | -------------------------------------------------------------------------------------- |
| `systemPrompt(text)`                 | none             | `${tools}` is replaced with the JSON array of tool names                               |
| `tools(...names)` / `tools(toolSet)` | no tools         | Names must be registered; they are linted at `build()`                                 |
| `maxTurns(n)`                        | `10`             | Maximum model calls per run. Must be at least 1                                        |
| `maxTokens(n)`                       | `4096`           | Per model call. Must be at least 1                                                     |
| `maxOutputRetries(n)`                | `2`              | Failed structured-output attempts tolerated. Must be 0 or more                         |
| `groundingInstruction(bool)`         | `true`           | See [Grounding](#grounding)                                                            |
| `output(schema, description?)`       | none (free text) | Returns a builder typed to the schema. Description default: `Submit your final answer` |
| `build()`                            |                  | Validates and returns the `Agent`                                                      |

`build()` throws if a limit is out of range, a tool is unknown or fails lint, or the output schema is not an
object schema.

### Typed output

```ts
const Resolution = z.object({
    action: z.enum(["refund", "replace", "none"]).describe("What to do"),
    reason: z.string().describe("Why"),
});

const agent = AgentBuilder.create(client).output(Resolution).build(); // Agent<{ action; reason }>
const result = await agent.run("Order arrived broken");
if (result.isOk) result.value.output.action; // typed
```

Without `output`, the agent is an `Agent<string>` and `output` is the model's final text.

## Running

```ts
const result = await agent.run("question"); // Result<AgentResult<O>, AgentError>
const next = await agent.runConversation(messages); // continue from a transcript
```

`AgentResult<O>`:

| Field        | Meaning                                                                  |
| ------------ | ------------------------------------------------------------------------ |
| `output`     | Final text, or the validated structured object                           |
| `finalText`  | Text the model wrote in its last turn (may be empty for structured runs) |
| `transcript` | Every `Message` exchanged, immutable                                     |
| `turns`      | Number of model calls made                                               |

### Continuing a conversation

The transcript is complete and resumable. To continue, pass it back with a new user message:

```ts
const first = (await agent.run("Find order 42")).value;
const second = await agent.runConversation([...first.transcript, Message.user("Now refund it")]);
```

`turns` and `maxTurns` apply per call. The agent holds no state between calls, so any agent instance (or a
freshly built one) can continue any transcript.

## The loop

Each turn the agent sends the system prompt, the transcript and the tool specs to the model, then branches:

**The model made no tool calls**

- If the stop reason is `MAX_TOKENS`: fail with `Model hit the max token limit (N)`.
- If there is no output schema: finish; the text is the output.
- Otherwise the model answered in prose when a structured result was required. Count a failure; if failures
  exceed `maxOutputRetries`, fail with `Model did not submit a result`. If not, add a user message
  `Call the submit_result tool with your final answer.` and **force** the next request to call `submit_result`
  (honoured by the provider through `tool_choice`).

**The model made tool calls.** Every call receives a result block:

- Arguments that were not valid JSON (`argumentError`): error `Arguments were not valid JSON: ...`.
- A call to `submit_result` (only when an output schema is set): the arguments are validated. Valid: accepted.
  Invalid: error `Invalid result: <issues>`, and a failure is counted.
- Anything else: run through the `ToolSet` ([Running tools](./tools.md#running-tools)).

All result blocks are appended as **one** user message, so the transcript stays valid for every provider and
resumable. If a valid `submit_result` was present the run finishes even if sibling calls failed. If failures
exceed `maxOutputRetries`, fail with `Model submitted invalid results N times`.

If the turns run out the run fails with `No final answer after N turns`.

### Structured output uses a reserved tool

When an output schema is set, the agent adds a synthetic tool named `submit_result` whose input schema is your
output schema and whose description is `outputDescription`. The system prompt is extended with an instruction
to call it exactly once and not to write the answer as plain text. This is why `submit_result` cannot be used
as a tool name.

### Grounding

When the agent has tools or an output schema, and grounding is enabled, this instruction is appended to the
system prompt:

> Only use values the user provided or that tools returned. When a value is not known, use null for fields that
> allow it or leave optional fields out. Never invent IDs, names, dates, amounts or other specifics to fill a field.

Its purpose is to stop models inventing values to satisfy required-looking fields. Disable it with
`groundingInstruction(false)` if it conflicts with your prompt. The exported constant is `GROUNDING_INSTRUCTION`.

### System prompt assembly

The final system prompt is the parts below joined by a blank line, in this order, omitting any that do not apply:

1. Your `systemPrompt` (with `${tools}` substituted)
2. The grounding instruction
3. The `submit_result` instruction

If there are no parts, no system prompt is sent.

## Messages

`Message` has a `role` (`Role.USER` or `Role.ASSISTANT`) and `content`, an array of blocks:

| Block             | Fields                                  | Meaning                     |
| ----------------- | --------------------------------------- | --------------------------- |
| `TextBlock`       | `text`                                  | Plain text                  |
| `ToolCallBlock`   | `id`, `name`, `args`, `argumentError`   | The model asking for a tool |
| `ToolResultBlock` | `toolCallId`, `result` (a `ToolResult`) | Your answer to a tool call  |

Helpers: `Message.user(text | blocks)`, `Message.assistant(blocks)`, `message.text()`, `message.toolCalls()`.
Messages are immutable.
