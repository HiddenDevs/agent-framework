import type OpenAI from "openai";
import z from "zod";
import {
    ContentBlock,
    Message,
    Role,
    StopReason,
    TextBlock,
    ToolCallBlock,
    ToolResultBlock,
} from "../../model/message.js";
import { ModelResponse, type ModelClient, type ModelRequest } from "../../model/model-client.js";
import { ModelClientError } from "../model-client-error.js";
import type { ProviderDialect } from "../provider-dialect.js";
import { asText } from "../result-content.js";
import { OpenAiStrictDialect } from "./openai-strict-dialect.js";

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const FINISH_REASONS: Record<string, StopReason> = {
    stop: StopReason.END_TURN,
    tool_calls: StopReason.TOOL_USE,
    length: StopReason.MAX_TOKENS,
};

const toMessages = (message: Message): ChatMessage[] => {
    if (message.role === Role.ASSISTANT) {
        const calls = message.toolCalls();
        const text = message.text();
        if (calls.length === 0 && text.length === 0) return [];
        return [
            {
                role: "assistant",
                content: text.length > 0 ? text : null,
                ...(calls.length > 0 && {
                    tool_calls: calls.map((call) => ({
                        id: call.id,
                        type: "function" as const,
                        function: { name: call.name, arguments: JSON.stringify(call.args) },
                    })),
                }),
            },
        ];
    }

    // Chat Completions has no error flag on tool messages; the error text tells the model.
    const out: ChatMessage[] = message.content
        .filter((block): block is ToolResultBlock => block instanceof ToolResultBlock)
        .map((block) => ({ role: "tool", tool_call_id: block.toolCallId, content: asText(block.result.content) }));
    const text = message.text();
    if (text.length > 0) out.push({ role: "user", content: text });
    return out;
};

export class OpenAiClient implements ModelClient {
    public constructor(
        private readonly sdk: OpenAI,
        private readonly model: string,
        private readonly dialect: ProviderDialect = new OpenAiStrictDialect(),
    ) {}

    public async complete(request: ModelRequest) {
        const messages: ChatMessage[] = [];
        if (request.systemPrompt) messages.push({ role: "system", content: request.systemPrompt });
        messages.push(...request.messages.flatMap(toMessages));

        const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
            model: this.model,
            max_completion_tokens: request.maxTokens,
            messages,
        };
        if (request.tools.length > 0) {
            params.tools = request.tools.map((spec) => ({
                type: "function" as const,
                function: {
                    name: spec.name,
                    description: spec.description,
                    strict: true,
                    parameters: this.dialect.adaptSchema(z.toJSONSchema(spec.inputSchema, { io: "input" })),
                },
            }));
        }
        if (request.forcedToolName) {
            params.tool_choice = { type: "function", function: { name: request.forcedToolName } };
        }

        let choice: OpenAI.Chat.Completions.ChatCompletion.Choice | undefined;
        try {
            choice = (await this.sdk.chat.completions.create(params)).choices[0];
        } catch (error) {
            throw ModelClientError.wrap(error);
        }
        if (!choice) throw new ModelClientError("Model returned no choices", -1);

        const blocks: ContentBlock[] = [];
        if (choice.message.content) blocks.push(new TextBlock(choice.message.content));
        for (const call of choice.message.tool_calls ?? []) {
            if (call.type === "function") blocks.push(this.toolCall(call, request));
        }
        return new ModelResponse(Message.assistant(blocks), FINISH_REASONS[choice.finish_reason] ?? StopReason.OTHER);
    }

    private toolCall(
        call: OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall,
        request: ModelRequest,
    ): ToolCallBlock {
        const { name, arguments: raw } = call.function;
        let parsed: unknown;
        try {
            parsed = raw.trim().length === 0 ? {} : JSON.parse(raw);
        } catch (error) {
            return new ToolCallBlock(call.id, name, {}, error instanceof Error ? error.message : String(error));
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return new ToolCallBlock(call.id, name, {}, "Tool arguments were not a JSON object");
        }
        const spec = request.findTool(name);
        const args = spec
            ? this.dialect.normalizeArguments(parsed as Record<string, unknown>, spec.inputSchema)
            : (parsed as Record<string, unknown>);
        return new ToolCallBlock(call.id, name, args);
    }
}
