import type Anthropic from "@anthropic-ai/sdk";
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
import { AnthropicDialect } from "./anthropic-dialect.js";

const STOP_REASONS: Record<string, StopReason> = {
    end_turn: StopReason.END_TURN,
    stop_sequence: StopReason.END_TURN,
    tool_use: StopReason.TOOL_USE,
    max_tokens: StopReason.MAX_TOKENS,
};

const toParam = (message: Message): Anthropic.MessageParam | null => {
    const content: Anthropic.ContentBlockParam[] = [];
    for (const block of message.content) {
        if (block instanceof TextBlock) {
            if (block.text.length > 0) content.push({ type: "text", text: block.text });
        } else if (block instanceof ToolCallBlock) {
            content.push({ type: "tool_use", id: block.id, name: block.name, input: block.args });
        } else if (block instanceof ToolResultBlock) {
            content.push({
                type: "tool_result",
                tool_use_id: block.toolCallId,
                content: asText(block.result.content),
                is_error: block.result.isError,
            });
        }
    }
    return content.length === 0 ? null : { role: message.role === Role.USER ? "user" : "assistant", content };
};

export class AnthropicClient implements ModelClient {
    public constructor(
        private readonly sdk: Anthropic,
        private readonly model: string,
        private readonly dialect: ProviderDialect = new AnthropicDialect(),
    ) {}

    public async complete(request: ModelRequest) {
        const params: Anthropic.MessageCreateParamsNonStreaming = {
            model: this.model,
            max_tokens: request.maxTokens,
            messages: request.messages.map(toParam).filter((m): m is Anthropic.MessageParam => m !== null),
        };
        if (request.systemPrompt) params.system = request.systemPrompt;
        if (request.tools.length > 0) {
            params.tools = request.tools.map((spec) => ({
                name: spec.name,
                description: spec.description,
                input_schema: this.dialect.adaptSchema(
                    z.toJSONSchema(spec.inputSchema, { io: "input" }),
                ) as Anthropic.Tool.InputSchema,
            }));
        }
        if (request.forcedToolName) params.tool_choice = { type: "tool", name: request.forcedToolName };

        let response: Anthropic.Message;
        try {
            response = await this.sdk.messages.create(params);
        } catch (error) {
            throw ModelClientError.wrap(error);
        }

        const blocks: ContentBlock[] = [];
        for (const block of response.content) {
            if (block.type === "text") {
                if (block.text.length > 0) blocks.push(new TextBlock(block.text));
            } else if (block.type === "tool_use") {
                blocks.push(this.toolCall(block, request));
            }
        }
        return new ModelResponse(
            Message.assistant(blocks),
            STOP_REASONS[response.stop_reason ?? ""] ?? StopReason.OTHER,
        );
    }

    private toolCall(block: Anthropic.ToolUseBlock, request: ModelRequest): ToolCallBlock {
        const input = block.input;
        if (typeof input !== "object" || input === null || Array.isArray(input)) {
            return new ToolCallBlock(block.id, block.name, {}, "Tool input was not a JSON object");
        }
        const spec = request.findTool(block.name);
        const args = spec
            ? this.dialect.normalizeArguments(input as Record<string, unknown>, spec.inputSchema)
            : (input as Record<string, unknown>);
        return new ToolCallBlock(block.id, block.name, args);
    }
}
