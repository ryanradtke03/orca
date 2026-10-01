import type { AnyRecipe } from "@orchestra/engine";
import { addComponent } from "./add-component/index.js";
import { fixCi } from "./fix-ci/index.js";
import { fixLint } from "./fix-lint/index.js";

export { addComponent, fixCi, fixLint };

/** The recipes shipped with Orca, keyed by name for the engine registry. */
export const builtInRecipes = {
  "fix-ci": fixCi,
  "fix-lint": fixLint,
  "add-component": addComponent,
} satisfies Record<string, AnyRecipe>;
