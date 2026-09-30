import { CliMessenger } from "./backends/cli/index.js";
import { FakeMessenger } from "./backends/fake.js";
import type { Messenger, MessengerConfig } from "./types.js";

/** The only place that looks at config.backend. Everything else just uses Messenger. */
export function createMessenger(config: MessengerConfig): Messenger {
  switch (config.backend) {
    case "cli": {
      const { backend: _backend, ...opts } = config;
      return new CliMessenger(opts);
    }
    case "fake": {
      const { backend: _backend, ...opts } = config;
      return new FakeMessenger(opts);
    }
    default: {
      const unknown: never = config;
      throw new Error(`Unknown messenger backend: ${JSON.stringify(unknown)}`);
    }
  }
}
