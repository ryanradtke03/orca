import type { AnyRecipe } from "@orchestra/engine";
import { addComponent } from "./add-component/index.js";
import { fixCi } from "./fix-ci/index.js";
import { fixLint } from "./fix-lint/index.js";
import { prDescribe } from "./pr-describe/index.js";
import { prReview } from "./pr-review/index.js";
import { reproBug } from "./repro-bug/index.js";
import { updateTests } from "./update-tests/index.js";

export { addComponent, fixCi, fixLint, prDescribe, prReview, reproBug, updateTests };

/** The recipes shipped with Orca, keyed by name for the engine registry. */
export const builtInRecipes = {
  "fix-ci": fixCi,
  "fix-lint": fixLint,
  "update-tests": updateTests,
  "repro-bug": reproBug,
  "pr-review": prReview,
  "pr-describe": prDescribe,
  "add-component": addComponent,
} satisfies Record<string, AnyRecipe>;
