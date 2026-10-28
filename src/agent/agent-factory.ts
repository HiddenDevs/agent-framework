import z from "zod";
import type { ModelClient } from "../model/model-client.js";
import type { ToolFactory } from "../tools/tool-registry.js";
import { AgentBuilder } from "./agent-builder.js";
import type { Agent } from "./agent.js";

export const AgentConfigSchema = z.object({
    provider: z.string().min(1),
    systemPrompt: z.string().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
    tools: z.array(z.string()).default([]),
    outputSchema: z.record(z.string(), z.unknown()).optional(),
    outputDescription: z.string().optional(),
    maxTurns: z.number().int().min(1).optional(),
    maxTokens: z.number().int().min(1).optional(),
    maxOutputRetries: z.number().int().min(0).optional(),
    groundingInstruction: z.boolean().optional(),
});

export type AgentConfigInput = z.input<typeof AgentConfigSchema>;
export type AgentConfig = z.output<typeof AgentConfigSchema>;

export class AgentFactory {
    private constructor() {}

    /** Code-first entry point; `fromConfig` builds the same thing from data. */
    public static builder(client: ModelClient, toolFactory?: ToolFactory): AgentBuilder<string> {
        return AgentBuilder.create(client, toolFactory);
    }

    /** Throws on invalid config, unknown tools, or an unsupported output schema. */
    public static fromConfig(config: AgentConfig, client: ModelClient, toolFactory?: ToolFactory): Agent<unknown> {
        let builder: AgentBuilder<unknown> = AgentBuilder.create(client, toolFactory).tools(...config.tools);
        if (config.systemPrompt !== undefined) builder = builder.systemPrompt(config.systemPrompt);
        if (config.context !== undefined) builder = builder.context(config.context);
        if (config.maxTurns !== undefined) builder = builder.maxTurns(config.maxTurns);
        if (config.maxTokens !== undefined) builder = builder.maxTokens(config.maxTokens);
        if (config.maxOutputRetries !== undefined) builder = builder.maxOutputRetries(config.maxOutputRetries);
        if (config.groundingInstruction !== undefined)
            builder = builder.groundingInstruction(config.groundingInstruction);
        if (config.outputSchema !== undefined) {
            builder = builder.output(z.fromJSONSchema(config.outputSchema), config.outputDescription);
        }
        return builder.build();
    }
}
