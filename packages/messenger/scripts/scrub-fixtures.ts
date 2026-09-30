import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scrub } from "../src/scrub.js";

const dir = fileURLToPath(new URL("../fixtures/", import.meta.url));
for (const name of await readdir(dir)) {
  if (!/\.(jsonl|json)$/.test(name)) continue;
  const path = join(dir, name);
  const before = await readFile(path, "utf8");
  const after = scrub(before);
  if (after !== before) {
    await writeFile(path, after);
    console.log(`scrubbed ${name}`);
  }
}
