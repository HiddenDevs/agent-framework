import type z from "zod";
import { Message, StopReason, ToolResultBlock } from "../model/message.js";
import { ModelRequest, type ModelClient } from "../model/model-client.js";
import { Result } from "../result.js";
import { SUBMIT_TOOL_NAME } from "../tools/tool-lint.js";
import { ToolResult } from "../tools/tool-result.js";
import { formatIssues } from "../tools/tool-runner.js";
import type { ToolSet } from "../tools/tool-set.js";
import type { ToolSpec } from "../tools/tool-spec.js";

export class AgentError extends Error {
    public readonly transcript: readonly Message[];

    public constructor(message: string, transcript: readonly Message[]) {
        super(message);
        this.name = "AgentError";
        this.transcript = Object.freeze([...transcript]);
    }
}

export class AgentResult<O> {
    public readonly transcript: readonly Message[];

    public constructor(
        public readonly output: O,
        public readonly finalText: string,
        transcript: readonly Message[],
        public readonly turns: number,
    ) {
        this.transcript = Object.freeze([...transcript]);
    }
}

export type AgentOptions<O> = {
    readonly client: ModelClient;
    readonly tools: ToolSet;
    readonly systemPrompt: string | null;
    readonly outputSchema: z.ZodType<O> | null;
    readonly outputDescription: string;
    readonly maxTurns: number;
    readonly maxTokens: number;
    readonly maxOutputRetries: number;
    readonly groundingInstruction: boolean;
};

export const GROUNDING_INSTRUCTION =
    "Only use values the user provided or that tools returned. When a value is not known, use null for fields that allow it or leave optional fields out. Never invent IDs, names, dates, amounts or other specifics to fill a field.";

const SUBMIT_INSTRUCTION =
    "When you have the final answer, call the submit_result tool exactly once with it. Do not write the answer as plain text.";

export class Agent<O = string> {
    public constructor(private readonly options: AgentOptions<O>) {}

    public async run(input: string): Promise<Result<AgentResult<O>, AgentError>> {
        return this.runConversation([Message.user(input)]);
    }

    /** Continues from an existing transcript, e.g. `AgentResult.transcript` plus a new user message. */
    public async runConversation(conversation: readonly Message[]): Promise<Result<AgentResult<O>, AgentError>> {
        try {
            return Result.ok(await this.loop(conversation));
        } catch (error) {
            if (error instanceof AgentError) {
                return Result.err(error);
            }
            throw error;
        }
    }

    private async loop(conversation: readonly Message[]): Promise<AgentResult<O>> {
        const { client, tools, outputSchema, maxTurns, maxTokens, maxOutputRetries } = this.options;
        const transcript = [...conversation];
        const specs = this.requestTools();
        let forcedTool: string | null = null;
        let outputFailures = 0;

        for (let turn = 1; turn <= maxTurns; turn++) {
            const response = await client.complete(
                new ModelRequest(this.systemPrompt(), transcript, specs, maxTokens, forcedTool),
            );
            forcedTool = null;
            transcript.push(response.message);

            const calls = response.toolCalls();
            if (calls.length === 0) {
                if (response.stopReason === StopReason.MAX_TOKENS) {
                    throw new AgentError(`Model hit the max token limit (${maxTokens})`, transcript);
                }
                if (!outputSchema) {
                    return new AgentResult(response.text() as O, response.text(), transcript, turn);
                }
                if (++outputFailures > maxOutputRetries) {
                    throw new AgentError("Model did not submit a result", transcript);
                }
                transcript.push(Message.user(`Call the ${SUBMIT_TOOL_NAME} tool with your final answer.`));
                forcedTool = SUBMIT_TOOL_NAME;
                continue;
            }

            const blocks: ToolResultBlock[] = [];
            let submitted: { readonly data: O } | null = null;
            for (const call of calls) {
                if (call.argumentError) {
                    blocks.push(
                        new ToolResultBlock(
                            call.id,
                            ToolResult.error(`Arguments were not valid JSON: ${call.argumentError}`),
                        ),
                    );
                } else if (outputSchema && call.name === SUBMIT_TOOL_NAME) {
                    const candidate = outputSchema.safeParse(call.args);
                    if (candidate.success) {
                        submitted = { data: candidate.data };
                        blocks.push(new ToolResultBlock(call.id, ToolResult.success("Result accepted.")));
                    } else {
                        outputFailures++;
                        blocks.push(
                            new ToolResultBlock(
                                call.id,
                                ToolResult.error(`Invalid result: ${formatIssues(candidate.error.issues)}`),
                            ),
                        );
                    }
                } else {
                    blocks.push(new ToolResultBlock(call.id, await tools.call(call.name, call.args)));
                }
            }

            // One message holding every result keeps the transcript resumable.
            transcript.push(Message.user(blocks));
            if (submitted) {
                return new AgentResult(submitted.data, response.text(), transcript, turn);
            }
            if (outputFailures > maxOutputRetries) {
                throw new AgentError(`Model submitted invalid results ${outputFailures} times`, transcript);
            }
        }

        throw new AgentError(`No final answer after ${maxTurns} turns`, transcript);
    }

    private requestTools(): ToolSpec[] {
        const { tools, outputSchema, outputDescription } = this.options;
        const specs = tools.specs();
        if (outputSchema) {
            specs.push({ name: SUBMIT_TOOL_NAME, description: outputDescription, inputSchema: outputSchema });
        }
        return specs;
    }

    private systemPrompt(): string | null {
        const { systemPrompt, groundingInstruction, outputSchema, tools } = this.options;
        const parts: string[] = [];
        if (systemPrompt) parts.push(systemPrompt);
        if (groundingInstruction && (outputSchema || tools.names().length > 0)) parts.push(GROUNDING_INSTRUCTION);
        if (outputSchema) parts.push(SUBMIT_INSTRUCTION);
        return parts.length > 0 ? parts.join("\n\n") : null;
    }
}
