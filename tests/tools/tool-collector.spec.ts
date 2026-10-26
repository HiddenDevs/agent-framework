import { AgentTool, ToolBase, ToolCollector, ToolRegistry } from "@hiddendevs/agent-framework";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import z from "zod";

const frameworkUrl = import.meta.resolve("@hiddendevs/agent-framework");
const zodUrl = import.meta.resolve("zod");

describe("ToolCollector", () => {
    let directory: string;

    beforeEach(async () => {
        ToolRegistry.clearToolClasses();
        directory = await mkdtemp(join(tmpdir(), "agent-tools-"));
    });

    afterEach(async () => {
        ToolRegistry.clearToolClasses();
        await rm(directory, { recursive: true, force: true });
    });

    const toolModule = (name: string): string => `
        import { AgentTool, ToolBase } from ${JSON.stringify(frameworkUrl)};
        import z from ${JSON.stringify(zodUrl)};
        AgentTool({
            name: ${JSON.stringify(name)},
            description: "Discovered tool",
            inputValidationSchema: z.object({ query: z.string() }),
        })(class extends ToolBase {
            constructor() {
                super();
                throw new Error("Discovery must not construct tools");
            }
            execute(input) { return input; }
        });
    `;

    it("discovers unexported decorated classes recursively through the public API", async () => {
        await mkdir(join(directory, "nested"));
        await writeFile(join(directory, "one.mjs"), toolModule("one"));
        await writeFile(join(directory, "nested", "two.mjs"), toolModule("two"));

        const tools = await ToolCollector.collect(directory);

        expect(tools.map((tool) => tool.name).sort()).toEqual(["one", "two"]);
        expect(tools[0]?.description).toBe("Discovered tool");
        expect(tools[0]?.inputValidationSchema.parse({ query: "hello" })).toEqual({ query: "hello" });
    });

    it("deduplicates overlapping paths and supports repeated scans", async () => {
        const file = join(directory, "tool.mjs");
        await writeFile(file, toolModule("repeated"));

        const first = await ToolCollector.collect([directory, file, directory]);
        const second = await ToolCollector.collect(directory);

        expect(first).toHaveLength(1);
        expect(second).toEqual(first);
    });

    it("resolves relative paths from the working directory", async () => {
        await writeFile(join(directory, "tool.mjs"), toolModule("relative"));

        const tools = await ToolCollector.collect(relative(process.cwd(), directory));
        expect(tools.map((tool) => tool.name)).toEqual(["relative"]);
    });

    it("skips symbolic links during directory traversal, including cycles", async () => {
        await symlink(directory, join(directory, "cycle"), "dir");
        await writeFile(join(directory, "ignored.txt"), 'throw new Error("Must not import link");');
        await symlink(join(directory, "ignored.txt"), join(directory, "linked.mjs"));

        expect(await ToolCollector.collect(directory)).toEqual([]);
    });

    it("imports modules in sorted order regardless of input order", async () => {
        const first = join(directory, "a.mjs");
        const second = join(directory, "b.mjs");
        await writeFile(second, toolModule("second"));
        await writeFile(first, toolModule("first"));

        const tools = await ToolCollector.collect([second, first]);
        expect(tools.map((tool) => tool.name)).toEqual(["first", "second"]);
    });

    it("returns snapshots including previously registered tools", async () => {
        @AgentTool({
            name: "existing",
            description: "Already registered",
            inputValidationSchema: z.object({}),
        })
        class ExistingTool extends ToolBase {
            public execute() {
                return {};
            }
        }

        const tools = await ToolCollector.collect(directory);
        expect(tools).toEqual([ExistingTool]);
        tools.pop();
        expect(ToolRegistry.getToolClasses()).toEqual([ExistingTool]);
    });

    it("skips dependencies, git metadata, declaration files, and non-module files", async () => {
        const invalidModule = 'throw new Error("This file must not be imported");';
        for (const name of ["node_modules", ".git"]) {
            await mkdir(join(directory, name));
            await writeFile(join(directory, name, "ignored.mjs"), invalidModule);
        }
        for (const name of ["ignored.txt", "ignored.ts", "ignored.d.ts", "ignored.d.mts", "ignored.d.cts"]) {
            await writeFile(join(directory, name), invalidModule);
        }

        expect(await ToolCollector.collect(directory)).toEqual([]);
        expect(await ToolCollector.collect(directory, { extensions: [".mts", ".cts"] })).toEqual([]);
    });

    it("respects custom extensions", async () => {
        await writeFile(join(directory, "ignored.js"), 'throw new Error("Excluded extension");');
        await writeFile(join(directory, "tool.mjs"), toolModule("included"));

        const tools = await ToolCollector.collect(directory, { extensions: [".mjs"] });
        expect(tools.map((tool) => tool.name)).toEqual(["included"]);
    });

    it("loads JavaScript and CommonJS modules with Node's native importer", async () => {
        await writeFile(join(directory, "package.json"), '{"type":"module"}');
        await writeFile(join(directory, "tool.js"), toolModule("javascript"));
        await writeFile(join(directory, "helper.cjs"), "module.exports = {};");

        expect((await ToolCollector.collect(directory)).map((tool) => tool.name)).toEqual(["javascript"]);
    });

    it("reports the failing module and preserves its original error", async () => {
        const file = join(directory, "broken.mjs");
        await writeFile(file, 'throw new Error("Broken dependency");');

        await expect(ToolCollector.collect(file)).rejects.toMatchObject({
            message: `Failed to import tool module "${file}".`,
            cause: { message: "Broken dependency" },
        });
    });

    it("preserves duplicate-name errors from decorators", async () => {
        await writeFile(join(directory, "first.mjs"), toolModule("duplicate"));
        await writeFile(join(directory, "second.mjs"), toolModule("duplicate"));

        await expect(ToolCollector.collect(directory)).rejects.toMatchObject({
            cause: { message: 'Tool class with name "duplicate" is already registered.' },
        });
    });

    it("rejects missing paths and unsupported explicit files", async () => {
        await expect(ToolCollector.collect(join(directory, "missing"))).rejects.toMatchObject({
            code: "ENOENT",
        });
        const file = join(directory, "unsupported.txt");
        await writeFile(file, "");
        await expect(ToolCollector.collect(file)).rejects.toThrow("not a directory or a supported module file");
    });

    it("rejects empty paths and extension lists", async () => {
        await expect(ToolCollector.collect([])).rejects.toThrow("at least one non-empty");
        await expect(ToolCollector.collect(" ")).rejects.toThrow("at least one non-empty");
        await expect(ToolCollector.collect(directory, { extensions: [] })).rejects.toThrow(
            "at least one module extension",
        );
    });
});
