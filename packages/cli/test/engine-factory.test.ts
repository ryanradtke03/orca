import { FakeMessenger } from "@orchestra/messenger";
import { describe, expect, it } from "vitest";
import { CliError } from "../src/cli-error.js";
import type { ResolvedOrcaConfig } from "../src/config.js";
import { buildEngine } from "../src/engine-factory.js";

/** A minimal resolved config; override per test. */
function config(overrides: Partial<ResolvedOrcaConfig> = {}): ResolvedOrcaConfig {
  return {
    repo: "/tmp/orca-engine-factory",
    pr: { kind: "local" },
    backend: "cli",
    limits: {},
    ...overrides,
  };
}

// An injected messenger stands in for the fake backend (which has no fixtures in config).
const fake = { messenger: new FakeMessenger({ fixtures: [] }) };

describe("buildEngine", () => {
  it("drives the recipe registry from builtInRecipes (all 7 recipes + the chain)", () => {
    const engine = buildEngine(config(), fake);
    const names = engine.recipes().map((r) => r.name);
    expect(names).toContain("bug-to-pr"); // the chain
    expect(names).toContain("fix-ci"); // a representative recipe
    expect(names).toHaveLength(8); // 7 recipes + 1 chain, no per-recipe wiring
  });

  it("exposes each recipe's name, description, and JSON input schema", () => {
    const [recipe] = buildEngine(config(), fake).recipes();
    expect(recipe).toMatchObject({
      name: expect.any(String),
      description: expect.any(String),
    });
    expect(recipe).toHaveProperty("inputSchema"); // JSON Schema (may be {})
  });

  it("builds a GitHub PR sink without throwing when config.pr is github", () => {
    expect(() =>
      buildEngine(config({ pr: { kind: "github", remote: "upstream" } }), fake),
    ).not.toThrow();
  });

  it("builds a local PR sink (default) without throwing", () => {
    expect(() => buildEngine(config({ pr: { kind: "local" } }), fake)).not.toThrow();
  });

  it("builds the CLI messenger from config.backend when none is injected", () => {
    // backend "cli" needs no fixtures, so construction succeeds with no injected messenger.
    expect(() => buildEngine(config({ backend: "cli" }))).not.toThrow();
  });

  it("refuses the fake backend from config with a CliError (fixtures live in tests only)", () => {
    expect(() => buildEngine(config({ backend: "fake" }))).toThrow(CliError);
  });
});
