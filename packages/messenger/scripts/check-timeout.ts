import { fileURLToPath } from "node:url";
import { createMessenger } from "../src/index.js";
import { spawnClaude } from "../src/backends/cli/spawn.js";

const fake = (name: string) => fileURLToPath(new URL(`../test/${name}`, import.meta.url));
const start = Date.now();
const t = () => `${String(Date.now() - start).padStart(5)}ms`;

// 1. timeout: hangs forever, we stop it after 1s
{
  const m = createMessenger({ backend: "cli", claudePath: fake("fake-claude-hang.mjs") });
  const done = await m.send({ prompt: "hi", timeoutMs: 1000 }).done;
  console.log(t(), "1 timeout →", done.ok, done.error);
}

// 2. abort: cancel after 500ms with an AbortController
{
  const m = createMessenger({ backend: "cli", claudePath: fake("fake-claude-hang.mjs") });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 500);
  const done = await m.send({ prompt: "hi", timeoutMs: 60_000, signal: controller.signal }).done;
  console.log(t(), "2 abort   →", done.ok, done.error);
}

// 3. already aborted before sending: stops immediately
{
  const m = createMessenger({ backend: "cli", claudePath: fake("fake-claude-hang.mjs") });
  const controller = new AbortController();
  controller.abort();
  const done = await m.send({ prompt: "hi", signal: controller.signal }).done;
  console.log(t(), "3 pre-abort →", done.ok, done.error?.kind);
}

// 4. stubborn process ignores SIGTERM: SIGKILL after the grace period
{
  const proc = spawnClaude(fake("fake-claude-hang.mjs"), ["--stubborn"], { timeoutMs: 300, killGraceMs: 700 });
  for await (const _ of proc.lines) {} // drain stdout
  const exit = await proc.exit;
  console.log(t(), "4 stubborn →", { signal: exit.signal, timedOut: exit.timedOut, stderr: exit.stderr.trim() });
}

// 5. crash with lots of stderr and no result: no_result + only the tail kept
{
  const m = createMessenger({ backend: "cli", claudePath: fake("fake-claude-crash.mjs") });
  const done = await m.send({ prompt: "hi" }).done;
  const msg = done.error?.message ?? "";
  console.log(t(), "5 crash   →", done.error?.kind, `| ${msg.length} chars kept | ends with: "${msg.split("\n").at(-1)}"`);
}
