import type { AnyRecipe } from "@orchestra/engine";
import { fixCi } from "./fix-ci/index.js";

export { fixCi };

/** The recipes shipped with Orca, keyed by name for the engine registry. */
export const builtInRecipes = {
  "fix-ci": fixCi,
} satisfies Record<string, AnyRecipe>;
