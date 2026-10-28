import z from "zod";

import {
    AgentBuilder,
    AgentTool,
    Message,
    ModelResponse,
    StopReason,
    TextBlock,
    ToolBase,
    ToolCallBlock,
    ToolRegistry,
    ToolResultBlock,
    type ModelClient,
    type ModelRequest,
} from "@hiddendevs/agent-framework";

class FakeClient implements ModelClient {
    public readonly requests: ModelRequest[] = [];
    public constructor(private readonly script: ModelResponse[]) {}
    public async complete(request: ModelRequest) {
        this.requests.push(request);
        const next = this.script.shift();
        if (!next) throw new Error("script exhausted");
        return next;
    }
}

const text = (value: string, stop = StopReason.END_TURN) =>
    new ModelResponse(Message.assistant([new TextBlock(value)]), stop);
const calls = (...blocks: ToolCallBlock[]) => new ModelResponse(Message.assistant(blocks), StopReason.TOOL_USE);
const submit = (id: string, args: Record<string, unknown>) => new ToolCallBlock(id, "submit_result", args);

const outputSchema = z.object({ answer: z.string().describe("the answer") });

describe("Agent", () => {
    beforeEach(() => {
        ToolRegistry.clearToolClasses();
        ToolRegistry.clearToolInstances();
    });

    const build = (script: ModelResponse[], structured = true) => {
        const client = new FakeClient(script);
        const builder = AgentBuilder.create(client);
        return { client, agent: structured ? builder.output(outputSchema).build() : builder.build() };
    };

    it("returns final text for a text agent", async () => {
        const { agent } = build([text("hello")], false);
        const result = (await agent.run("hi")).value;
        expect(result).toMatchObject({ output: "hello", finalText: "hello", turns: 1 });
    });

    it("accepts a valid submit on the first try", async () => {
        const { agent } = build([calls(submit("1", { answer: "42" }))]);
        expect((await agent.run("q")).value.output).toEqual({ answer: "42" });
    });

    it("forces submit_result after a prose answer", async () => {
        const { agent, client } = build([text("prose"), calls(submit("1", { answer: "ok" }))]);
        const result = await agent.run("q");
        expect(result.value.output).toEqual({ answer: "ok" });
        expect(client.requests[1]?.forcedToolName).toBe("submit_result");
    });

    it("feeds invalid submissions back and accepts a correction", async () => {
        const { agent, client } = build([calls(submit("1", {})), calls(submit("2", { answer: "fixed" }))]);
        const result = await agent.run("q");
        expect(result.value.output).toEqual({ answer: "fixed" });
        const feedback = client.requests[1]?.messages.at(-1)?.content[0] as ToolResultBlock;
        expect(feedback.result.isError).toBe(true);
        expect(String(feedback.result.content)).toMatch(/^Invalid result: answer:/);
    });

    it("fails once invalid submissions exceed the retry budget", async () => {
        const { agent } = build([calls(submit("1", {})), calls(submit("2", {})), calls(submit("3", {}))]);
        const result = await agent.run("q");
        expect(result.isOk).toBe(false);
        expect(result.error.message).toBe("Model submitted invalid results 3 times");
        expect(result.error.transcript.length).toBeGreaterThan(0);
    });

    it("fails on max tokens and on turn exhaustion", async () => {
        const maxed = build([text("cut", StopReason.MAX_TOKENS)], false).agent;
        expect((await maxed.run("q")).error.message).toBe("Model hit the max token limit (4096)");

        const client = new FakeClient([calls(new ToolCallBlock("1", "x", {})), calls(new ToolCallBlock("2", "x", {}))]);
        const looping = AgentBuilder.create(client).maxTurns(2).build();
        expect((await looping.run("q")).error.message).toBe("No final answer after 2 turns");
    });

    it("answers argument errors and unknown tools as data, in one message", async () => {
        const { agent, client } = build([
            calls(new ToolCallBlock("1", "x", {}, "bad json"), new ToolCallBlock("2", "ghost", {})),
            calls(submit("3", { answer: "done" })),
        ]);
        await agent.run("q");
        const results = client.requests[1]?.messages.at(-1)?.content as ToolResultBlock[];
        expect(results).toHaveLength(2);
        expect(String(results[0]?.result.content)).toMatch(/not valid JSON|were not valid JSON/);
        expect(String(results[1]?.result.content)).toMatch(/^Unknown tool: ghost/);
    });

    it("lets a valid submit win over failing sibling calls", async () => {
        const { agent } = build([calls(submit("1", { answer: "a" }), new ToolCallBlock("2", "ghost", {}))]);
        expect((await agent.run("q")).value.output).toEqual({ answer: "a" });
    });

    it("runs registered tools and supports resuming a transcript", async () => {
        const schema = z.object({ n: z.number().describe("n") });
        @AgentTool({ name: "inc", description: "Increment", inputValidationSchema: schema })
        class Inc extends ToolBase<typeof schema> {
            public execute(input: z.infer<typeof schema>) {
                return input.n + 1;
            }
        }
        void Inc;

        const client = new FakeClient([calls(new ToolCallBlock("1", "inc", { n: 1 })), text("two"), text("again")]);
        const agent = AgentBuilder.create(client).tools("inc").systemPrompt("Tools: {{ tools | json }}").build();
        const first = (await agent.run("go")).value;
        expect(first.output).toBe("two");
        expect(client.requests[0]?.systemPrompt).toContain('Tools: ["inc"]');
        expect(client.requests[0]?.systemPrompt).toContain("Only use values");
        const toolResult = client.requests[1]?.messages.at(-1)?.content[0] as ToolResultBlock;
        expect(toolResult.result.content).toBe(2);

        const resumed = (await agent.runConversation([...first.transcript, Message.user("more")])).value;
        expect(resumed.output).toBe("again");
        expect(resumed.turns).toBe(1);
    });

    it("validates builder limits and output schema shape", () => {
        const client = new FakeClient([]);
        expect(() => AgentBuilder.create(client).maxTurns(0).build()).toThrow();
        expect(() => AgentBuilder.create(client).output(z.string()).build()).toThrow(/object schema/);
    });

    describe("Liquid context", () => {
        it("renders nested context, loops, conditions and filters", async () => {
            const client = new FakeClient([text("done")]);
            const agent = AgentBuilder.create(client)
                .systemPrompt(
                    "{{ user.name | upcase }}: {% if enabled %}{% for item in items %}{{ item }} {% endfor %}{% endif %}{{ data | json }}",
                )
                .context({
                    user: { name: "Ada" },
                    enabled: true,
                    items: ["one", "two"],
                    data: { count: 2, active: false, value: null },
                })
                .build();

            await agent.run("q");
            expect(client.requests[0]?.systemPrompt).toBe('ADA: one two {"count":2,"active":false,"value":null}');
        });

        it("merges builder defaults immutably and replaces nested values rather than deep-merging", async () => {
            const client = new FakeClient([text("one"), text("two"), text("three")]);
            const values = { name: "original" };
            const base = AgentBuilder.create(client)
                .systemPrompt("{{ name }} {{ language }} {{ user | json }}")
                .context({ language: "en", user: { name: "Ada", role: "admin" } })
                .context(values);
            const derived = base.context({ language: "fr", user: { name: "Grace" } }).build();
            values.name = "changed";
            const agent = base.build();

            await agent.run("q");
            await derived.run("q");
            await agent.run("q", { user: { name: "Lin" } });
            expect(client.requests.map((request) => request.systemPrompt)).toEqual([
                'original en {"name":"Ada","role":"admin"}',
                'original fr {"name":"Grace"}',
                'original en {"name":"Lin"}',
            ]);
        });

        it("keeps context and Liquid assignments isolated across concurrent runs and resumptions", async () => {
            const client = new FakeClient([text("one"), text("two"), text("three"), text("four")]);
            const agent = AgentBuilder.create(client)
                .systemPrompt("{{ name }} {{ previous | default: 'unset' }}{% assign previous = name %}")
                .context({ name: "default" })
                .build();

            const [first, second] = await Promise.all([
                agent.run("q", { name: "Ada" }),
                agent.run("q", { name: "Grace" }),
            ]);
            expect(first.isOk && second.isOk).toBe(true);
            await agent.runConversation([...first.value.transcript, Message.user("more")], { name: "Lin" });
            await agent.run("q");
            expect(client.requests.map((request) => request.systemPrompt)).toEqual([
                "Ada unset",
                "Grace unset",
                "Lin unset",
                "default unset",
            ]);
        });

        it("renders once per run and reuses the prompt on every turn", async () => {
            const context = { name: "Ada" };
            const requests: ModelRequest[] = [];
            const client: ModelClient = {
                complete: async (request) => {
                    requests.push(request);
                    context.name = "changed";
                    return requests.length === 1 ? calls(submit("1", {})) : calls(submit("2", { answer: "ok" }));
                },
            };
            const agent = AgentBuilder.create(client).systemPrompt("Hello {{ name }}").output(outputSchema).build();

            await agent.run("q", context);
            expect(requests).toHaveLength(2);
            expect(requests[0]?.systemPrompt).toContain("Hello Ada");
            expect(requests[1]?.systemPrompt).toBe(requests[0]?.systemPrompt);
        });

        it("reserves tools and no longer substitutes the legacy placeholder", async () => {
            const client = new FakeClient([text("done")]);
            const agent = AgentBuilder.create(client)
                .systemPrompt("${tools} {{ tools | json }}")
                .context({ tools: ["fake-default"] })
                .build();

            await agent.run("q", { tools: ["fake-override"] });
            expect(client.requests[0]?.systemPrompt).toBe("${tools} []");
        });

        it("treats injected strings as data, not executable templates", async () => {
            const client = new FakeClient([text("done")]);
            const agent = AgentBuilder.create(client).systemPrompt("{{ value }}").build();
            await agent.run("q", { value: "{{ missing }} {% include 'secret' %} <tag>" });
            expect(client.requests[0]?.systemPrompt).toBe("{{ missing }} {% include 'secret' %} <tag>");
        });

        it("supports optional values with default and conditionals", async () => {
            const client = new FakeClient([text("done")]);
            const agent = AgentBuilder.create(client)
                .systemPrompt("{{ name | default: 'guest' }}{% if details %}: {{ details }}{% endif %}")
                .build();
            await agent.run("q");
            expect(client.requests[0]?.systemPrompt).toBe("guest");
        });

        it("rejects malformed templates and unknown filters at build time", () => {
            const client = new FakeClient([]);
            expect(() => AgentBuilder.create(client).systemPrompt("{% if enabled %}").build()).toThrow();
            expect(() => AgentBuilder.create(client).systemPrompt("{{ tools | not_a_filter }}").build()).toThrow(
                /undefined filter/,
            );
        });

        it("enforces the prompt parsing limit at its exact boundary", () => {
            const builder = AgentBuilder.create(new FakeClient([]));
            expect(() => builder.systemPrompt("x".repeat(1_000_000)).build()).not.toThrow();
            expect(() => builder.systemPrompt("x".repeat(1_000_001)).build()).toThrow(/parse length limit/);
        });

        it("enforces rendering memory limits without poisoning later runs", async () => {
            const client = new FakeClient([text("done")]);
            const agent = AgentBuilder.create(client).systemPrompt("{{ value | json }}").build();
            await expect(agent.run("q", { value: "x".repeat(1_000_001) })).rejects.toThrow(/memory alloc limit/);
            expect(client.requests).toHaveLength(0);
            await agent.run("q", { value: "small" });
            expect(client.requests[0]?.systemPrompt).toBe('"small"');
        });

        it("rejects missing context before calling the model", async () => {
            const client = new FakeClient([]);
            const agent = AgentBuilder.create(client).systemPrompt("Hello {{ user.name }}").build();
            await expect(agent.run("q")).rejects.toThrow(/undefined variable/);
            await expect(agent.runConversation([Message.user("q")])).rejects.toThrow(/undefined variable/);
            expect(client.requests).toHaveLength(0);
        });

        it.each(["include", "render", "layout"])("does not load files through the %s tag", async (tag) => {
            const client = new FakeClient([]);
            const agent = AgentBuilder.create(client).systemPrompt(`{% ${tag} 'package.json' %}`).build();
            await expect(agent.run("q")).rejects.toThrow();
            expect(client.requests).toHaveLength(0);
        });

        it("does not expose inherited object properties", async () => {
            const client = new FakeClient([]);
            const agent = AgentBuilder.create(client).systemPrompt("{{ user.constructor }}").build();
            await expect(agent.run("q", { user: { name: "Ada" } })).rejects.toThrow(/undefined variable/);
            expect(client.requests).toHaveLength(0);
        });

        it("omits empty rendered prompts and keeps framework instructions", async () => {
            const client = new FakeClient([text("done"), calls(submit("1", { answer: "ok" }))]);
            const builder = AgentBuilder.create(client).systemPrompt("{% if optional %}present{% endif %}");
            await builder.build().run("q");
            await builder.output(outputSchema).build().run("q");
            expect(client.requests[0]?.systemPrompt).toBeNull();
            expect(client.requests[1]?.systemPrompt).toContain("Only use values");
            expect(client.requests[1]?.systemPrompt).toContain("call the submit_result tool exactly once");
        });
    });
});
