import { describe, expect, it } from "vitest";
import { buildArgs } from "../src/backends/cli/args.js";
import { buildEnv } from "../src/backends/cli/env.js";
import type { MessengerRequest } from "../src/types.js";
import { validateRequest } from "../src/validate.js";

const defaults = { timeoutMs: 1000, model: undefined };
const valid = (req: MessengerRequest) => {
  const v = validateRequest(req, defaults);
  if (!v.ok) throw new Error(v.error);
  return v.value;
};

describe("validateRequest", () => {
  it.each([
    ["empty prompt", { prompt: "  " }],
    ["tools without cwd", { prompt: "x", tools: ["Edit"] }],
    ["missing cwd", { prompt: "x", cwd: "/nope/not/here" }],
    ["bad maxTurns", { prompt: "x", maxTurns: 0 }],
  ] as const)("rejects %s", (_label, req) => {
    expect(validateRequest(req, defaults).ok).toBe(false);
  });

  it("defaults maxTurns to 1 for talk-only and 20 with tools", () => {
    expect(valid({ prompt: "x" }).maxTurns).toBe(1);
    expect(
      valid({ prompt: "x", tools: ["Read"], cwd: process.cwd() }).maxTurns,
    ).toBe(20);
  });
});

describe("buildArgs", () => {
  it("blocks tools and uses strict MCP for talk-only", () => {
    const args = buildArgs(valid({ prompt: "hi" }));
    expect(args).toContain("--disallowedTools");
    expect(args).toContain("--strict-mcp-config");
    expect(args).not.toContain("--allowedTools");
  });

  it("allows tools and accepts edits when tools are given", () => {
    const args = buildArgs(
      valid({ prompt: "hi", tools: ["Read", "Grep"], cwd: process.cwd() }),
    );
    expect(args.join(" ")).toContain(
      "--allowedTools Read,Grep --permission-mode acceptEdits",
    );
  });

  it("passes model, system and resume through", () => {
    const args = buildArgs(
      valid({
        prompt: "hi",
        model: "sonnet",
        system: "be terse",
        resume: "abc",
      }),
    ).join(" ");
    expect(args).toContain("--model sonnet");
    expect(args).toContain("--append-system-prompt be terse");
    expect(args).toContain("--resume abc");
  });
});

describe("buildEnv", () => {
  it("strips API keys by default and sets the config dir", () => {
    const env = buildEnv(
      { configDir: "/cfg" },
      { ANTHROPIC_API_KEY: "sk", PATH: "/bin" },
    );
    expect(env["ANTHROPIC_API_KEY"]).toBeUndefined();
    expect(env["CLAUDE_CONFIG_DIR"]).toBe("/cfg");
    expect(env["PATH"]).toBe("/bin");
  });

  it("keeps the API key when useApiKey is true", () => {
    expect(
      buildEnv({ useApiKey: true }, { ANTHROPIC_API_KEY: "sk" })[
        "ANTHROPIC_API_KEY"
      ],
    ).toBe("sk");
  });
});
