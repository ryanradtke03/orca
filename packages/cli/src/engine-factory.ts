// Turn a resolved OrcaConfig into a live engine — the one place the CLI assembles the
// engine's collaborators. This is the seam the config loader stops at: config.ts
// returns plain data (scalars + choices), and this module turns those choices into the
// real messenger / PR sink / recipe registry `createEngine` needs. Extracted from the
// hardcoded wiring in packages/recipes/scripts/bug-to-pr.ts so every command — and,
// later, MCP/desktop — builds its engine the same way.
import path from "node:path";
import {
  createEngine,
  type Engine,
  type EngineConfig,
  type EngineLimits,
  githubSink,
  localSink,
  type PrSink,
} from "@orchestra/engine";
import { createMessenger, type Messenger } from "@orchestra/messenger";
import { builtInRecipes } from "@orchestra/recipes";
import { CliError } from "./cli-error.js";
import type { ResolvedOrcaConfig } from "./config.js";

/** Injectable collaborators. The `fake` backend can't be built from config alone (it
 *  needs fixtures), so tests inject a messenger here instead of going through config. */
export interface BuildEngineDeps {
  messenger?: Messenger | undefined;
}

/**
 * Build an engine from a resolved config. Drives the recipe registry from
 * `builtInRecipes`, so the CLI automatically knows every recipe and chain with no
 * per-recipe wiring; picks the PR sink from `config.pr`; and constructs the messenger
 * from `config.backend` unless one is injected. Pure assembly — no I/O, no run started.
 */
export function buildEngine(config: ResolvedOrcaConfig, deps: BuildEngineDeps = {}): Engine {
  const { repo } = config;

  // config.pr is the validated choice; turn it into the live sink. A local sink writes
  // under .orca/ by default (matching bug-to-pr.ts); github pushes to the named remote.
  const pr: PrSink =
    config.pr.kind === "github"
      ? githubSink({ repo, remote: config.pr.remote })
      : localSink({ dir: config.pr.dir ?? path.join(repo, ".orca") });

  const engineConfig: EngineConfig = {
    repo,
    messenger: resolveMessenger(config, deps),
    recipes: builtInRecipes,
    pr,
    // zod's .partial() types each limit as `number | undefined`, while the engine's
    // Partial<EngineLimits> means `number` on present keys. At runtime zod omits absent
    // keys entirely (never sets them to undefined), so the values already match — the
    // cast only reconciles the two packages' exactOptionalPropertyTypes views.
    limits: config.limits as Partial<EngineLimits>,
    worktreeDir: config.worktreeDir,
    traceDir: config.traceDir,
    keepWorktrees: config.keepWorktrees,
  };
  return createEngine(engineConfig);
}

/** Pick the messenger: an injected one wins; otherwise build from the backend. The
 *  `fake` backend has no fixtures in config, so it's only reachable via injection —
 *  reaching it through a config file is a user mistake, surfaced as a CliError. */
function resolveMessenger(config: ResolvedOrcaConfig, deps: BuildEngineDeps): Messenger {
  if (deps.messenger) return deps.messenger;
  if (config.backend === "cli") return createMessenger({ backend: "cli" });
  throw new CliError(
    `backend "${config.backend}" has no fixtures in config — it's only usable from tests`,
  );
}
