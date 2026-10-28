import type { ModelClient } from "../model/model-client.js";
import { AnthropicClient } from "./anthropic/anthropic-client.js";
import { OpenAiClient } from "./openai/openai-client.js";
import { Provider, type ProviderConfig } from "./provider-config.js";

/** Builds a client for the configured provider; the SDK is imported lazily so only the one in use is required. */
export class ModelClientFactory {
    private constructor() {}

    public static async create(config: ProviderConfig): Promise<ModelClient> {
        const options = {
            apiKey: config.apiKey,
            maxRetries: config.maxRetries,
            ...(config.baseUrl !== undefined && { baseURL: config.baseUrl }),
            ...(config.timeoutSeconds !== undefined && { timeout: config.timeoutSeconds * 1000 }),
        };

        switch (config.provider) {
            case Provider.ANTHROPIC: {
                const { default: Anthropic } = await import("@anthropic-ai/sdk");
                return new AnthropicClient(new Anthropic(options), config.model);
            }
            case Provider.OPENAI: {
                const { default: OpenAI } = await import("openai");
                return new OpenAiClient(new OpenAI(options), config.model);
            }
        }
    }
}
