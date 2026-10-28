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
        const agent = AgentBuilder.create(client).tools("inc").systemPrompt("Tools: ${tools}").build();
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
});
