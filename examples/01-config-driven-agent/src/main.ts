import { AgentFramework } from "@hiddendevs/agent-framework";
import { resolve } from "node:path";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
    throw new Error("Set ANTHROPIC_API_KEY before running this example.");
}

const framework = await AgentFramework.create({
    toolPaths: [resolve("dist/tools")],
    providers: {
        anthropic: {
            provider: "anthropic",
            model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
            apiKey,
            maxRetries: 2,
            timeoutSeconds: 30,
        },
    },
    agents: {
        weatherAssistant: {
            provider: "anthropic",
            systemPrompt:
                "Answer weather questions using the current-weather tool. Only report values returned by the tool. Available tools: ${tools}",
            tools: ["current-weather"],
            outputDescription: "Submit the weather report",
            outputSchema: {
                type: "object",
                required: ["city", "temperatureC", "condition"],
                properties: {
                    city: { type: "string", description: "The city from the weather result" },
                    temperatureC: { type: "number", description: "Temperature in Celsius" },
                    condition: { type: "string", description: "Weather condition" },
                },
                additionalProperties: false,
            },
        },
    },
});

const question = process.argv.slice(2).join(" ") || "What is the weather in Lisbon?";
const result = await (await framework.agent("weatherAssistant")).run(question);

if (!result.isOk) {
    console.error(`Agent could not finish: ${result.error.message}`);
    console.error("Transcript:", JSON.stringify(result.error.transcript, null, 2));
    process.exitCode = 1;
} else {
    console.log(JSON.stringify(result.value.output, null, 2));
    console.log(`Completed in ${result.value.turns} model turn(s).`);
}
