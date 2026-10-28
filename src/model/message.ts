import type { ToolResult } from "../tools/tool-result.js";

export enum Role {
    USER = "user",
    ASSISTANT = "assistant",
}

export enum StopReason {
    END_TURN = "end_turn",
    TOOL_USE = "tool_use",
    MAX_TOKENS = "max_tokens",
    OTHER = "other",
}

export abstract class ContentBlock {}

export class TextBlock extends ContentBlock {
    public constructor(public readonly text: string) {
        super();
    }
}

export class ToolCallBlock extends ContentBlock {
    /** `argumentError` is set when the model's argument JSON was unparseable; `args` is then `{}`. */
    public constructor(
        public readonly id: string,
        public readonly name: string,
        public readonly args: Readonly<Record<string, unknown>>,
        public readonly argumentError: string | null = null,
    ) {
        super();
    }
}

export class ToolResultBlock extends ContentBlock {
    public constructor(
        public readonly toolCallId: string,
        public readonly result: ToolResult,
    ) {
        super();
    }
}

export class Message {
    public readonly content: readonly ContentBlock[];

    private constructor(
        public readonly role: Role,
        content: readonly ContentBlock[],
    ) {
        this.content = Object.freeze([...content]);
    }

    public static user(content: string | readonly ContentBlock[]): Message {
        return new Message(Role.USER, typeof content === "string" ? [new TextBlock(content)] : content);
    }

    public static assistant(content: readonly ContentBlock[]): Message {
        return new Message(Role.ASSISTANT, content);
    }

    public toolCalls(): ToolCallBlock[] {
        return this.content.filter((block): block is ToolCallBlock => block instanceof ToolCallBlock);
    }

    public text(): string {
        return this.content
            .filter((block): block is TextBlock => block instanceof TextBlock)
            .map((block) => block.text)
            .join("\n");
    }
}
