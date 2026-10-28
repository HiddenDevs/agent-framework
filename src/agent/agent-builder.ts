import z from "zod";
import type { ModelClient } from "../model/model-client.js";
import type { ToolFactory } from "../tools/tool-registry.js";
import { ToolSet } from "../tools/tool-set.js";
import { Agent } from "./agent.js";

type BuilderState<O> = {
    systemPrompt: string | null;
    toolNames: readonly string[];
    toolSet: ToolSet | null;
    outputSchema: z.ZodType<O> | null;
    outputDescription: string;
    maxTurns: number;
    maxTokens: number;
    maxOutputRetries: number;
    groundingInstruction: boolean;
};

const defaults = (): BuilderState<string> => ({
    systemPrompt: null,
    toolNames: [],
    toolSet: null,
    outputSchema: null,
    outputDescription: "Submit your final answer",
    maxTurns: 10,
    maxTokens: 4096,
    maxOutputRetries: 2,
    groundingInstruction: true,
});

export class AgentBuilder<O = string> {
    private constructor(
        private readonly client: ModelClient,
        private readonly toolFactory: ToolFactory | undefined,
        private readonly state: BuilderState<O>,
    ) {}

    public static create(client: ModelClient, toolFactory?: ToolFactory): AgentBuilder<string> {
        return new AgentBuilder(client, toolFactory, defaults());
    }

    public systemPrompt(prompt: string): AgentBuilder<O> {
        return this.with({ systemPrompt: prompt });
    }

    /** Selects registered tools by name, or uses a prebuilt set. */
    public tools(...selection: [ToolSet] | readonly string[]): AgentBuilder<O> {
        const [first] = selection;
        return first instanceof ToolSet
            ? this.with({ toolSet: first, toolNames: [] })
            : this.with({ toolSet: null, toolNames: selection as readonly string[] });
    }

    public maxTurns(value: number): AgentBuilder<O> {
        return this.with({ maxTurns: value });
    }

    public maxTokens(value: number): AgentBuilder<O> {
        return this.with({ maxTokens: value });
    }

    public maxOutputRetries(value: number): AgentBuilder<O> {
        return this.with({ maxOutputRetries: value });
    }

    public groundingInstruction(enabled: boolean): AgentBuilder<O> {
        return this.with({ groundingInstruction: enabled });
    }

    /** Requires a structured result; returns a new builder typed to the schema. */
    public output<R>(schema: z.ZodType<R>, description?: string): AgentBuilder<R> {
        return new AgentBuilder<R>(this.client, this.toolFactory, {
            ...this.state,
            outputSchema: schema,
            outputDescription: description ?? this.state.outputDescription,
        });
    }

    public build(): Agent<O> {
        const { state } = this;
        if (state.maxTurns < 1 || state.maxTokens < 1) {
            throw new Error("maxTurns and maxTokens must be at least 1.");
        }
        if (state.maxOutputRetries < 0) {
            throw new Error("maxOutputRetries must not be negative.");
        }
        if (state.outputSchema && z.toJSONSchema(state.outputSchema, { io: "input" })["type"] !== "object") {
            throw new Error("The output schema must be an object schema.");
        }

        const tools =
            state.toolSet ??
            (state.toolNames.length > 0
                ? ToolSet.from(state.toolNames, this.toolFactory ? { factory: this.toolFactory } : {})
                : ToolSet.EMPTY);

        return new Agent<O>({
            client: this.client,
            tools,
            systemPrompt: state.systemPrompt
                ? state.systemPrompt.replaceAll("${tools}", JSON.stringify(tools.names()))
                : null,
            outputSchema: state.outputSchema,
            outputDescription: state.outputDescription,
            maxTurns: state.maxTurns,
            maxTokens: state.maxTokens,
            maxOutputRetries: state.maxOutputRetries,
            groundingInstruction: state.groundingInstruction,
        });
    }

    private with(changes: Partial<BuilderState<O>>): AgentBuilder<O> {
        return new AgentBuilder(this.client, this.toolFactory, { ...this.state, ...changes });
    }
}
