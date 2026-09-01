# Worktree isolation for spawned Sessions

Orca needs to run multiple Sessions against the same Project concurrently without them clobbering each other's working directory or producing tangled Diffs. We decided every Session Orca spawns runs in its own git worktree (and branch) rather than sharing the Project's working directory. This trades the added complexity of creating and cleaning up worktrees for safe, isolated concurrent Sessions and a per-Session Diff that doesn't require the user to serialize their work.
