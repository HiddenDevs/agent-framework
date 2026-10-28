# Examples

These are independent TypeScript projects demonstrating common ways to use `@hiddendevs/agent-framework`.
They install the framework from this checkout with `yalc`, so you can edit the library and try it locally.

## Prerequisites

- Node.js 22.12 or newer
- npm
- [yalc](https://github.com/wclr/yalc) (`npm install --global yalc`)

## Publish this checkout and add it to an example

From the repository root, build and publish the current checkout to yalc's local store:

```bash
npm run build
yalc publish
```

Then select a project and add the local package. Run these commands from that example's directory:

```bash
cd examples/01-config-driven-agent
yalc add @hiddendevs/agent-framework
npm install
```

Repeat `yalc add @hiddendevs/agent-framework` and `npm install` inside each example project. `yalc add` updates
the example's `package.json` to refer to the local package; it does not fetch the published npm release.

After changing the framework source, rebuild and push the update:

```bash
# repository root
npm run build
yalc publish --push
```

The `--push` option updates projects that already added the package. Alternatively run `yalc update` inside
each example.

## Projects

| Project                                             | Demonstrates                                                                      | Run         |
| --------------------------------------------------- | --------------------------------------------------------------------------------- | ----------- |
| [01-config-driven-agent](./01-config-driven-agent/) | Decorated tool discovery, config-driven agent, structured output, Anthropic       | `npm start` |
| [02-runtime-agent-api](./02-runtime-agent-api/)     | A typed HTTP API that builds and runs a temporary agent per request               | `npm start` |
| [03-custom-client](./03-custom-client/)             | Offline `ModelClient`, tool constructor dependencies, and a code-first builder    | `npm start` |

Each project has its own README and environment-variable guidance. Run `npm run typecheck` to typecheck its
complete source project.
