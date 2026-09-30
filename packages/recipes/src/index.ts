import type { AnyRecipe } from "@orchestra/engine";
import { addComponent } from "./add-component/index.js";
import { fixCi } from "./fix-ci/index.js";

export { addComponent, fixCi };

/** The recipes shipped with Orca, keyed by name for the engine registry. */
export const builtInRecipes = {
  "fix-ci": fixCi,
  "add-component": addComponent,
} satisfies Record<string, AnyRecipe>;
