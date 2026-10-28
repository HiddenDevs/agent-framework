import z from "zod";

export enum Provider {
    ANTHROPIC = "anthropic",
    OPENAI = "openai",
}

export const ProviderConfigSchema = z.object({
    provider: z.enum(["anthropic", "openai"]),
    model: z.string().min(1),
    apiKey: z.string().min(1),
    baseUrl: z.string().optional(),
    maxRetries: z.number().int().min(0).default(2),
    timeoutSeconds: z.number().positive().optional(),
});

export type ProviderConfigInput = z.input<typeof ProviderConfigSchema>;

export class ProviderConfig {
    private constructor(private readonly values: z.output<typeof ProviderConfigSchema>) {}

    /** Throws a ZodError on invalid input. */
    public static parse(input: unknown): ProviderConfig {
        return new ProviderConfig(ProviderConfigSchema.parse(input));
    }

    public get provider(): Provider {
        return this.values.provider as Provider;
    }
    public get model(): string {
        return this.values.model;
    }
    public get apiKey(): string {
        return this.values.apiKey;
    }
    public get baseUrl(): string | undefined {
        return this.values.baseUrl;
    }
    public get maxRetries(): number {
        return this.values.maxRetries;
    }
    public get timeoutSeconds(): number | undefined {
        return this.values.timeoutSeconds;
    }

    public toString(): string {
        return `ProviderConfig(provider=${this.provider}, model=${this.model})`;
    }
}
