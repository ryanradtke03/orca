# Sessions are independent of Orca's app lifecycle

Quitting Orca must not stop the Sessions it spawned. We decided Orca treats every Session as an independent, detached process it happens to be watching, not a child that dies with the parent app — closing Orca simply stops observing, and reopening it rediscovers running Sessions via Discovery. This trades the simplicity of an owned-child-process model for letting the user close Orca without losing in-progress agent work, which matters since Sessions can run long.
