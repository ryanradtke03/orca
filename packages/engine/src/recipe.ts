import type { z } from "zod";
import type { Recipe } from "./types.js";

/**
 * Typed recipe authoring. The input type is inferred from the Zod schema, so
 * `plan`, `worker` and `finish` all see a fully-typed input with no manual generics.
 */
export function defineRecipe<S extends z.ZodType, Output = unknown>(
  recipe: Omit<Recipe<z.infer<S>, Output>, "input"> & { input: S },
): Recipe<z.infer<S>, Output> {
  return recipe as Recipe<z.infer<S>, Output>;
}
