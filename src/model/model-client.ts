import type { ToolSpec } from "../tools/tool-spec.js";
import { StopReason, type Message, type ToolCallBlock } from "./message.js";

export class ModelRequest {
    public readonly messages: readonly Message[];
    public readonly tools: readonly ToolSpec[];

    public constructor(
        public readonly systemPrompt: string | null,
        messages: readonly Message[],
        tools: readonly ToolSpec[],
        public readonly maxTokens: number,
        public readonly forcedToolName: string | null = null,
    ) {
        this.messages = Object.freeze([...messages]);
        this.tools = Object.freeze([...tools]);
    }

    public findTool(name: string): ToolSpec | null {
        return this.tools.find((tool) => tool.name === name) ?? null;
    }
}

export class ModelResponse {
    public constructor(
        public readonly message: Message,
        public readonly stopReason: StopReason = StopReason.END_TURN,
    ) {}

    public toolCalls(): ToolCallBlock[] {
        return this.message.toolCalls();
    }

    public text(): string {
        return this.message.text();
    }
}

/** The only abstraction the agent loop talks to. */
export interface ModelClient {
    complete(request: ModelRequest): Promise<ModelResponse>;
}
