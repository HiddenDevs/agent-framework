# Runtime agent API

A complete, dependency-light Node HTTP server showing how to build a temporary agent for each request.
Agents may choose only the preinstalled `knowledge-search` tool and configured OpenAI provider. Neither the
agent config nor the agent is stored by the framework.

## Setup

Build and publish the framework from the repository root:

```bash
npm run build
yalc publish
```

Then in this directory:

```bash
yalc add @hiddendevs/agent-framework
npm install
export OPENAI_API_KEY="..."
export AGENT_API_TOKEN="a-long-random-secret"
npm start
```

The server binds to `127.0.0.1:3000` by default. `OPENAI_MODEL`, `HOST` and `PORT` are optional.

## Route

Every request requires an `Authorization` header containing `Bearer` followed by `AGENT_API_TOKEN`.

| Method | Path          | Purpose                                                                                         |
| ------ | ------------- | ----------------------------------------------------------------------------------------------- |
| `POST` | `/agents/run` | Build and run with `{ "config": {...}, "input": "...", "context": {...} }`; context is optional |

Build and run a temporary agent in one request:

```bash
curl -X POST http://127.0.0.1:3000/agents/run \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"config":{"provider":"openai","systemPrompt":"Help {{ user.name }} at {{ organization }} using tools: {{ tools | json }}","context":{"organization":"Acme"},"tools":["knowledge-search"],"maxTurns":5},"input":"When is support available?","context":{"user":{"name":"Ada"}}}'
```

`createAgent` validates the config and returns an agent directly. Build errors produce a 400 response, and no
config or agent is stored even on success. Provider keys are server-side only; request data cannot supply a
key or load code. The tool directory is fixed in source and compiled before startup.

The request validates `input` and optional `context`. Per-run context shallowly overrides agent defaults;
missing Liquid variables fail before a provider call. Only inject context the caller may expose to the model.
Provider errors return 429 for rate limits or 502 for other run failures.

## Security and production notes

This is an instructional server, not a production-ready API gateway. Before exposing it beyond localhost, add
TLS, proper identity and authorization, request rate and concurrency limits, audit logging, and per-user tool
and provider allowlists. The bearer token is a single shared secret; use a secret manager and rotate it.
Do not register destructive or privileged tools for untrusted users. Cap `maxTurns`, `maxTokens`, and
`maxOutputRetries` in a production wrapper to manage cost.

Run `npm run typecheck` or `npm start` to compile the whole TypeScript project.
