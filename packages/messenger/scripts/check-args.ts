import { buildArgs } from "../src/backends/cli/args.js";
import { buildEnv } from "../src/backends/cli/env.js";
import type { MessengerRequest } from "../src/types.js";
import { validateRequest } from "../src/validate.js";

const defaults = { timeoutMs: 300_000, model: undefined };

function show(label: string, req: MessengerRequest) {
  const v = validateRequest(req, defaults);
  console.log(`\n── ${label}`);
  if (!v.ok) return console.log("  INVALID:", v.error);
  console.log(
    "  maxTurns:",
    v.value.maxTurns,
    " timeoutMs:",
    v.value.timeoutMs,
  );
  console.log("  args:", buildArgs(v.value).join(" "));
}

show("talk-only", { prompt: "say hi" });
show("talk + system + model", {
  prompt: "classify this",
  system: "Reply in JSON.",
  model: "sonnet",
});
show("resume a conversation", { prompt: "what's my name?", resume: "abc-123" });
show("tools in a folder", {
  prompt: "read package.json",
  tools: ["Read", "Grep"],
  cwd: process.cwd(),
});
show("tools without cwd", { prompt: "edit a file", tools: ["Edit"] });
show("cwd that doesn't exist", { prompt: "hi", cwd: "/nope/not/here" });
show("empty prompt", { prompt: "   " });
show("bad maxTurns", { prompt: "hi", maxTurns: 0 });

const env = buildEnv(
  {},
  { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-secret", HOME: "/Users/ryan" },
);
console.log(
  "\n── buildEnv (default): API key stripped?",
  !("ANTHROPIC_API_KEY" in env),
  env,
);
const keep = buildEnv({ useApiKey: true }, { ANTHROPIC_API_KEY: "sk-secret" });
console.log(
  "── buildEnv (useApiKey: true): kept?",
  keep["ANTHROPIC_API_KEY"] === "sk-secret",
);
