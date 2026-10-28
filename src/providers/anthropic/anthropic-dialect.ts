import type { ProviderDialect } from "../provider-dialect.js";

export class AnthropicDialect implements ProviderDialect {
    public adaptSchema(schemaJson: Record<string, unknown>): Record<string, unknown> {
        return schemaJson;
    }

    public normalizeArguments(args: Record<string, unknown>): Record<string, unknown> {
        return args;
    }
}
