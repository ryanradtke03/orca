## Spec template

Every recipe spec uses these 14 parts, so you can open the editor and build without guessing. The worked example is [fix-ci](#fix-ci).

1.  ### Header

    Purpose in one line, status, category, roadmap phase, effort, and engine needs: what it reuses and what is new (a gate, parallel tasks, child runs).

2.  ### When to use it

    Example requests, what triggers it (CLI, CI, webhook, a chain step), and non-goals: what it deliberately won't do and which recipe does instead.

3.  ### Input

    The Zod schema, defaults spelled out, and 2–3 example inputs.

4.  ### Plan

    How tasks are created: fixed or LLM-assisted, one task or one per file, dependsOn, and what plan() checks first with ctx.exec. Code sketch.

5.  ### Worker

    The full prompt template, tools allowlist with why each, maxTurns, model, system prompt, and what context goes into the prompt.

6.  ### Gates

    Table in run order: gate, passes when, which cheat it blocks, exists or new, cost. A code sketch for every new gate.

7.  ### When it fails

    What the retry feedback says, onFailed, what 'impossible' looks like, and how it gives up cleanly.

8.  ### Output

    finish() return type and what the CLI, PR or caller sees.

9.  ### Flow

    A short sequence diagram with this recipe's specifics.

10. ### Scenarios

    Playground patches (easy, trap, impossible at minimum), expected results, and the hard checks for scenarios.ts. Real results once run.

11. ### Files

    Exact paths to create or change: recipe, gates, patches, scenario rows.

12. ### Build checklist

    Ordered steps ending in the definition of done.

13. ### Open questions

    Decisions to make while building, and known weaknesses.

14. ### Chains

    Which chains it's part of, and what it hands to the next recipe.
