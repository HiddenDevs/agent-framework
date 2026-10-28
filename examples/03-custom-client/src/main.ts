import {
    AgentBuilder,
    Message,
    ModelResponse,
    StopReason,
    TextBlock,
    ToolCallBlock,
    ToolRegistry,
    ToolResultBlock,
    type ModelClient,
    type ModelRequest,
    type Tool,
    type ToolClass,
    type ToolFactory,
} from "@hiddendevs/agent-framework";
import { AccountLookupTool, type Account, type AccountService } from "./tools/account-lookup.js";

class InMemoryAccounts implements AccountService {
    private readonly accounts = new Map<string, Account>([["acct-42", { id: "acct-42", plan: "team", active: true }]]);

    public findById(id: string): Account | null {
        return this.accounts.get(id) ?? null;
    }
}

class LocalDemoClient implements ModelClient {
    private turn = 0;

    public async complete(request: ModelRequest): Promise<ModelResponse> {
        this.turn++;
        if (this.turn === 1) {
            const tool = request.findTool("account-lookup");
            if (!tool) throw new Error("The account-lookup tool was not included in the request.");
            return new ModelResponse(
                Message.assistant([new ToolCallBlock("demo-call-1", tool.name, { accountId: "acct-42" })]),
                StopReason.TOOL_USE,
            );
        }

        const lastMessage = request.messages.at(-1);
        const result = lastMessage?.content.find((block): block is ToolResultBlock => block instanceof ToolResultBlock);
        if (!result || result.result.isError) {
            return new ModelResponse(Message.assistant([new TextBlock("I could not retrieve that account.")]));
        }
        const account = result.result.content as Account;
        return new ModelResponse(
            Message.assistant([new TextBlock(`Account ${account.id} is on the ${account.plan} plan and is active.`)]),
        );
    }
}

const accounts = new InMemoryAccounts();
const toolFactory: ToolFactory = (toolClass: ToolClass): Tool => {
    if (toolClass.name === "account-lookup") return new AccountLookupTool(accounts);
    throw new Error(`No factory is configured for tool ${toolClass.name}.`);
};

const client = new LocalDemoClient();
const agent = AgentBuilder.create(client, toolFactory)
    .systemPrompt(
        "Help {{ user.name }} with account questions using only account-lookup. Available: {{ tools | json }}",
    )
    .context({ user: { name: "Guest" } })
    .tools("account-lookup")
    .build();

const result = await agent.run("What plan and status is account acct-42 on?", { user: { name: "Ada" } });
if (!result.isOk) {
    console.error(result.error.message);
    console.error(JSON.stringify(result.error.transcript, null, 2));
    process.exitCode = 1;
} else {
    console.log(result.value.output);
    console.log(`Completed in ${result.value.turns} model turn(s), without a network call.`);
}

ToolRegistry.clearToolInstances();
