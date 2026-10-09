#!/usr/bin/env node
// Global `orca` entry point.
//
// Orca is unbuilt — it runs its TypeScript straight through tsx, no dist step.
// This shim registers the tsx ESM loader, then imports the real entry so that
// `src/index.ts` (and everything it pulls in) is transpiled on the fly.
// process.argv passes through untouched, so there is no pnpm `--` quirk here.
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

register();
await import(fileURLToPath(new URL("../src/index.ts", import.meta.url)));
