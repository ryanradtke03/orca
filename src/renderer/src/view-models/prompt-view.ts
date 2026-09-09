/**
 * How Orca answers a Session's pending prompt.
 *
 * A permission prompt is Claude Code's numbered TUI dialog - "1. Yes" / "2. Yes,
 * and don't ask again" / "3. No" - selected by typing the matching digit. So a
 * card's Approve / Always allow / Deny buttons answer it by sending that digit
 * as the `respondToPrompt` response string (process/real.ts `respond` writes it
 * followed by Enter). These digits are a heuristic on the current CLI layout;
 * the write path itself is timing-based and the least robust link in the chain,
 * so it may want its own hardening pass later (#60).
 *
 * An input prompt (waiting-on-input) or an idle session instead receives the
 * free-text reply the composer sends verbatim - no mapping needed.
 */
export type PermissionAction = 'approve-once' | 'always-allow' | 'deny'

export const PERMISSION_RESPONSE: Record<PermissionAction, string> = {
  'approve-once': '1',
  'always-allow': '2',
  deny: '3'
}

/** The response string a permission action sends - the digit that selects its TUI option. */
export function permissionResponse(action: PermissionAction): string {
  return PERMISSION_RESPONSE[action]
}
