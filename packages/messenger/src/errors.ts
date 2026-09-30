import type { DoneEvent, MessengerErrorKind } from "./types.js";

export type HelperErrorKind = MessengerErrorKind | "invalid_json";

/**
 * Thrown by helpers that promise a value (askJson). send(), ask() and conversation()
 * never throw; they return a DoneEvent with ok: false instead.
 */
export class MessengerError extends Error {
  constructor(
    readonly kind: HelperErrorKind,
    message: string,
    readonly done?: DoneEvent | undefined, // the last DoneEvent, for cost / sessionId / debugging
  ) {
    super(message);
    this.name = "MessengerError";
  }
}
