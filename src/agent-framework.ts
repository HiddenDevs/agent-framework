import z from "zod";
import { AgentConfigSchema, AgentFactory, type AgentConfig } from "./agent/agent-factory.js";
import type { Agent } from "./agent/agent.js";
import type { ModelClient } from "./model/model-client.js";
import { ModelClientFactory } from "./providers/model-client-factory.js";
import { ProviderConfig, ProviderConfigSchema, type ProviderConfigInput } from "./providers/provider-config.js";
import { Result } from "./result.js";
import type { ToolModuleExtension } from "./tools/tool-collector.js";
import type { ToolFactory } from "./tools/tool-registry.js";
import { ToolRegistry } from "./tools/tool-registry.js";
import { formatIssues } from "./tools/tool-runner.js";

// Registration only builds the agent to validate it; the client is never called.
const VALIDATION_CLIENT: ModelClient = {
    complete: () => Promise.reject(new Error("Validation client cannot complete requests.")),
};

export const FrameworkConfigSchema = z.object({
    toolPaths: z.array(z.string()).default([]),
    toolExtensions: z.array(z.string()).optional(),
    providers: z.record(z.string(), ProviderConfigSchema),
    agents: z.record(z.string(), AgentConfigSchema),
});

export type FrameworkConfigInput = z.input<typeof FrameworkConfigSchema>;

export type AgentFrameworkOptions = {
    /** Supplies constructor dependencies for tools that need them. */
    readonly toolFactory?: ToolFactory;
    /** Overrides model client creation, e.g. for tests. */
    readonly clientFactory?: (config: ProviderConfig) => Promise<ModelClient>;
};

/** Entry point: discovers tools, then builds agents from configuration. Agents can also be registered at runtime. */
export class AgentFramework {
    private readonly providers: Map<string, ProviderConfigInput>;
    private readonly agents: Map<string, AgentConfig>;

    private constructor(
        config: z.output<typeof FrameworkConfigSchema>,
        private readonly options: AgentFrameworkOptions,
    ) {
        this.providers = new Map(Object.entries(config.providers));
        this.agents = new Map(Object.entries(config.agents));
    }

    /** Validates config and loads tools; throws on invalid config or tool discovery failure. */
    public static async create(
        input: FrameworkConfigInput,
        options: AgentFrameworkOptions = {},
    ): Promise<AgentFramework> {
        const config = FrameworkConfigSchema.parse(input);
        for (const [name, agent] of Object.entries(config.agents)) {
            if (!(agent.provider in config.providers)) {
                throw new Error(`Agent "${name}" references unknown provider "${agent.provider}".`);
            }
        }

        const framework = new AgentFramework(config, options);
        await framework.loadTools(config.toolPaths, config.toolExtensions as ToolModuleExtension[] | undefined);
        return framework;
    }

    /**
     * Imports tool modules, which executes them: only pass trusted paths, never request data.
     * Newly discovered tools become selectable by agents registered afterwards.
     */
    public async loadTools(
        paths: string | readonly string[],
        extensions?: readonly ToolModuleExtension[],
    ): Promise<void> {
        if (paths.length > 0) {
            await ToolRegistry.load(paths, extensions ? { extensions } : {});
        }
    }

    /**
     * Registers (or with `replace`, overwrites) an agent without a redeploy. The config is fully
     * validated first: schema, provider, tool names and lint, and the output schema. Safe for untrusted
     * config because agents can only reference already-registered tools and providers.
     */
    public registerAgent(
        name: string,
        input: unknown,
        options: { readonly replace?: boolean } = {},
    ): Result<AgentConfig> {
        if (name.trim().length === 0) {
            return Result.err(new Error("Agent name must not be empty."));
        }
        if (this.agents.has(name) && !options.replace) {
            return Result.err(new Error(`Agent "${name}" is already registered.`));
        }

        const parsed = AgentConfigSchema.safeParse(input);
        if (!parsed.success) {
            return Result.err(new Error(`Invalid agent config: ${formatIssues(parsed.error.issues)}`));
        }
        const config = parsed.data;
        if (!this.providers.has(config.provider)) {
            return Result.err(new Error(`Unknown provider "${config.provider}".`));
        }

        try {
            AgentFactory.fromConfig(config, VALIDATION_CLIENT, this.options.toolFactory);
        } catch (error) {
            return Result.err(error instanceof Error ? error : new Error(String(error)));
        }

        this.agents.set(name, config);
        return Result.ok(config);
    }

    /** Returns true when an agent was removed. */
    public unregisterAgent(name: string): boolean {
        return this.agents.delete(name);
    }

    public hasAgent(name: string): boolean {
        return this.agents.has(name);
    }

    public agentNames(): string[] {
        return [...this.agents.keys()];
    }

    public getAgentConfig(name: string): AgentConfig | undefined {
        return this.agents.get(name);
    }

    /** Registers (or replaces) a named provider. Throws on invalid provider config. */
    public registerProvider(name: string, input: ProviderConfigInput): void {
        ProviderConfig.parse(input);
        this.providers.set(name, input);
    }

    /** Builds a fresh, stateless agent. Throws on unknown agent names or invalid tool selections. */
    public async agent(name: string): Promise<Agent<unknown>> {
        const agentConfig = this.agents.get(name);
        if (!agentConfig) {
            throw new Error(`Unknown agent "${name}". Available agents: ${this.agentNames().join(", ")}`);
        }
        const providerInput = this.providers.get(agentConfig.provider);
        if (!providerInput) {
            throw new Error(`Agent "${name}" references unknown provider "${agentConfig.provider}".`);
        }
        const client = await (this.options.clientFactory ?? ModelClientFactory.create)(
            ProviderConfig.parse(providerInput),
        );
        return AgentFactory.fromConfig(agentConfig, client, this.options.toolFactory);
    }
}
