import type { AnyRecipe } from "@orchestra/engine";
import { addComponent } from "./add-component/index.js";
import { fixCi } from "./fix-ci/index.js";
import { fixLint } from "./fix-lint/index.js";
import { reproBug } from "./repro-bug/index.js";
import { updateTests } from "./update-tests/index.js";

export { addComponent, fixCi, fixLint, reproBug, updateTests };

/** The recipes shipped with Orca, keyed by name for the engine registry. */
export const builtInRecipes = {
  "fix-ci": fixCi,
  "fix-lint": fixLint,
  "update-tests": updateTests,
  "repro-bug": reproBug,
  "add-component": addComponent,
} satisfies Record<string, AnyRecipe>;
