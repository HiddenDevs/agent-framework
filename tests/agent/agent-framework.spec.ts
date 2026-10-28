import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import z from "zod";

import {
    AgentFramework,
    AgentTool,
    Message,
    ModelResponse,
    StopReason,
    TextBlock,
    ToolBase,
    ToolCallBlock,
    ToolRegistry,
    type ModelClient,
    type ModelRequest,
} from "@hiddendevs/agent-framework";

const provider = { provider: "openai", model: "m", apiKey: "k" } as const;

describe("AgentFramework", () => {
    let dir: string;

    beforeEach(async () => {
        ToolRegistry.clearToolClasses();
        ToolRegistry.clearToolInstances();
        dir = await mkdtemp(join(tmpdir(), "af-"));
    });
    afterEach(() => rm(dir, { recursive: true, force: true }));

    it("discovers tools and builds a working agent from config alone", async () => {
        await writeFile(
            join(dir, "echo.mjs"),
            `import { AgentTool, ToolBase } from "@hiddendevs/agent-framework";
import z from "zod";
const schema = z.object({ msg: z.string().describe("message") });
export const Echo = AgentTool({ name: "echo", description: "Echo", inputValidationSchema: schema })(
    class extends ToolBase { execute(input) { return input.msg; } });
`,
        );

        const requests: ModelRequest[] = [];
        const script = [
            new ModelResponse(Message.assistant([new ToolCallBlock("1", "echo", { msg: "hi" })]), StopReason.TOOL_USE),
            new ModelResponse(
                Message.assistant([new ToolCallBlock("2", "submit_result", { reply: "hi" })]),
                StopReason.TOOL_USE,
            ),
        ];
        const client: ModelClient = {
            complete: async (request) => {
                requests.push(request);
                return script.shift() ?? new ModelResponse(Message.assistant([new TextBlock("end")]));
            },
        };

        const framework = await AgentFramework.create(
            {
                toolPaths: [dir],
                providers: { main: provider },
                agents: {
                    echoer: {
                        provider: "main",
                        systemPrompt: "{{ organization }}: {{ user.name }}. Tools: {{ tools | json }}",
                        context: { organization: "Acme", user: { name: "default" } },
                        tools: ["echo"],
                        outputSchema: {
                            type: "object",
                            required: ["reply"],
                            properties: { reply: { type: "string", description: "the reply" } },
                        },
                    },
                },
            },
            { clientFactory: async () => client },
        );

        const result = await (await framework.agent("echoer")).run("say hi", { user: { name: "Ada" } });
        expect(result.value.output).toEqual({ reply: "hi" });
        expect(requests[0]?.systemPrompt).toContain('Acme: Ada. Tools: ["echo"]');
        expect(requests[0]?.tools.map((t) => t.name)).toEqual(["echo", "submit_result"]);
    });

    it("rejects bad config", async () => {
        await expect(
            AgentFramework.create({ providers: { main: provider }, agents: { a: { provider: "other" } } }),
        ).rejects.toThrow(/unknown provider "other"/);
        await expect(AgentFramework.create({ providers: {}, agents: { a: {} } } as never)).rejects.toThrow();

        const framework = await AgentFramework.create({
            providers: { main: provider },
            agents: { a: { provider: "main", tools: ["missing"] } },
        });
        await expect(framework.agent("nope")).rejects.toThrow(/Unknown agent/);
        await expect(framework.agent("a")).rejects.toThrow();
    });

    describe("JSON Schema output", () => {
        const run = async (outputSchema: Record<string, unknown>, submission: Record<string, unknown>) => {
            const requests: ModelRequest[] = [];
            const framework = await AgentFramework.create(
                {
                    providers: { main: provider },
                    agents: { a: { provider: "main", outputSchema, maxOutputRetries: 0 } },
                },
                {
                    clientFactory: async () => ({
                        complete: async (request) => {
                            requests.push(request);
                            return new ModelResponse(
                                Message.assistant([new ToolCallBlock("1", "submit_result", submission)]),
                                StopReason.TOOL_USE,
                            );
                        },
                    }),
                },
            );
            const result = await (await framework.agent("a")).run("q");
            return { result, requests };
        };

        const schema = {
            type: "object",
            required: ["name"],
            additionalProperties: false,
            properties: {
                name: { type: "string", minLength: 1, maxLength: 5, description: "Name" },
                age: { type: "integer", minimum: 0 },
                kind: { type: "string", enum: ["a", "b"], default: "a" },
                tags: { type: "array", items: { type: "string" }, maxItems: 2 },
                note: { type: ["string", "null"] },
            },
        };

        it("converts config schemas for both validation and the advertised submit tool", async () => {
            const { result, requests } = await run(schema, { name: "Ada", age: 3, tags: ["x"], note: null });
            expect(result.value.output).toEqual({ name: "Ada", age: 3, kind: "a", tags: ["x"], note: null });
            const advertised = z.toJSONSchema(requests[0]!.tools[0]!.inputSchema, { io: "input" });
            expect(advertised).toMatchObject({
                type: "object",
                additionalProperties: false,
                properties: {
                    name: { type: "string", minLength: 1, maxLength: 5, description: "Name" },
                    age: { type: "integer", minimum: 0 },
                },
            });
        });

        it.each([
            { name: "" },
            { name: "Ada", age: "3" },
            { name: "Ada", age: 1.5 },
            { name: "Ada", age: -1 },
            { name: "Ada", age: null },
            { name: "Ada", extra: 1 },
            { name: "Ada", tags: ["a", "b", "c"] },
            { name: "Ada", kind: "other" },
        ])("rejects invalid submissions without custom coercion or implicit nullability: %j", async (input) => {
            const { result } = await run(schema, input);
            expect(result.isOk).toBe(false);
            expect(result.error.message).toBe("Model submitted invalid results 1 times");
        });

        it("preserves additional properties by default, following JSON Schema semantics", async () => {
            const { result } = await run(
                { type: "object", properties: { name: { type: "string" } } },
                { name: "Ada", extra: 1 },
            );
            expect(result.value.output).toEqual({ name: "Ada", extra: 1 });
        });

        it("supports local references and unions in config", async () => {
            const { result } = await run(
                {
                    type: "object",
                    required: ["value"],
                    $defs: { answer: { anyOf: [{ type: "string" }, { type: "integer" }] } },
                    properties: { value: { $ref: "#/$defs/answer" } },
                },
                { value: 42 },
            );
            expect(result.value.output).toEqual({ value: 42 });
        });

        it("does not enforce extension keywords or legacy x-coerceStrings", async () => {
            const outputSchema = {
                type: "object",
                required: ["value"],
                properties: { value: { type: "number", "x-coerceStrings": true, customAnnotation: "metadata" } },
            };
            const valid = await run(outputSchema, { value: 3 });
            expect(valid.result.value.output).toEqual({ value: 3 });
            const invalid = await run(outputSchema, { value: "3" });
            expect(invalid.result.isOk).toBe(false);
        });

        it("uses Zod defaults without custom build-time validation", async () => {
            const { result } = await run(
                { type: "object", properties: { kind: { type: "string", enum: ["a"], default: "z" } } },
                {},
            );
            expect(result.value.output).toEqual({ kind: "z" });
        });

        it.each([
            ["2026-10-28", true],
            ["2026-10-28T12:00:00Z", false],
            ["not-a-date", false],
        ])("uses the built-in date format for %s", async (value, valid) => {
            const { result } = await run(
                {
                    type: "object",
                    required: ["date"],
                    properties: { date: { type: "string", format: "date" } },
                },
                { date: value },
            );
            expect(result.isOk).toBe(valid);
        });
    });

    describe("runtime registration", () => {
        const make = async () => {
            const echo = z.object({ msg: z.string().describe("message") });
            @AgentTool({ name: "echo", description: "Echo", inputValidationSchema: echo })
            class Echo extends ToolBase<typeof echo> {
                public execute(input: z.infer<typeof echo>) {
                    return input.msg;
                }
            }
            void Echo;
            const client: ModelClient = {
                complete: async () => new ModelResponse(Message.assistant([new TextBlock("done")])),
            };
            return AgentFramework.create(
                { providers: { main: provider }, agents: {} },
                { clientFactory: async () => client },
            );
        };

        it("registers an agent after startup and runs it", async () => {
            const framework = await make();
            const registered = framework.registerAgent("late", { provider: "main", tools: ["echo"] });
            expect(registered.isOk).toBe(true);
            expect(framework.agentNames()).toEqual(["late"]);
            expect((await (await framework.agent("late")).run("hi")).value.output).toBe("done");
        });

        it("preserves context in runtime config and renders per-request overrides", async () => {
            const requests: ModelRequest[] = [];
            const framework = await AgentFramework.create(
                { providers: { main: provider }, agents: {} },
                {
                    clientFactory: async () => ({
                        complete: async (request) => {
                            requests.push(request);
                            return new ModelResponse(Message.assistant([new TextBlock("done")]));
                        },
                    }),
                },
            );
            const registered = framework.registerAgent("contextual", {
                provider: "main",
                systemPrompt: "{{ organization }} {{ name }}",
                context: { organization: "Acme", name: "guest" },
            });
            expect(registered.isOk).toBe(true);
            expect(framework.getAgentConfig("contextual")?.context).toEqual({ organization: "Acme", name: "guest" });
            const agent = await framework.agent("contextual");
            await agent.run("q", { name: "Ada" });
            await agent.run("q");
            expect(requests.map((request) => request.systemPrompt)).toEqual(["Acme Ada", "Acme guest"]);
        });

        it("returns validation problems as data and registers nothing", async () => {
            const framework = await make();
            const cases: [unknown, RegExp][] = [
                [{ provider: "nope" }, /Unknown provider/],
                [{ provider: "main", tools: ["ghost"] }, /not registered/],
                [{ provider: "main", maxTurns: 0 }, /Invalid agent config/],
                [{ provider: "main", context: [] }, /Invalid agent config/],
                [{ provider: "main", systemPrompt: "{% if broken %}" }, /not closed/],
                [{ provider: "main", systemPrompt: "{{ tools | not_a_filter }}" }, /undefined filter/],
                [{ provider: "main", outputSchema: { type: "string" } }, /object schema/],
                [{ provider: "main", outputSchema: { type: "banana" } }, /Unsupported type/],
                [{ provider: "main", outputSchema: { type: "object", if: {}, then: {} } }, /Conditional schemas/],
            ];
            for (const [config, message] of cases) {
                const result = framework.registerAgent("bad", config);
                expect(result.isOk).toBe(false);
                expect(result.error.message).toMatch(message);
            }
            expect(framework.hasAgent("bad")).toBe(false);
        });

        it("rejects duplicates unless replacing, and supports unregistering", async () => {
            const framework = await make();
            framework.registerAgent("a", { provider: "main" });
            expect(framework.registerAgent("a", { provider: "main" }).isOk).toBe(false);
            expect(framework.registerAgent("a", { provider: "main", maxTurns: 3 }, { replace: true }).isOk).toBe(true);
            expect(framework.getAgentConfig("a")?.maxTurns).toBe(3);
            expect(framework.unregisterAgent("a")).toBe(true);
            expect(framework.unregisterAgent("a")).toBe(false);
        });

        it("registers providers at runtime", async () => {
            const framework = await make();
            expect(framework.registerAgent("a", { provider: "second" }).isOk).toBe(false);
            framework.registerProvider("second", provider);
            expect(framework.registerAgent("a", { provider: "second" }).isOk).toBe(true);
            expect(() => framework.registerProvider("x", { provider: "nope" } as never)).toThrow();
        });
    });
});
