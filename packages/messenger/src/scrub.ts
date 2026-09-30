import { homedir, userInfo } from "node:os";

/**
 * Remove personal details from recorded Claude output before it's saved as a fixture:
 * your home folder path, OS username, and email addresses.
 */
export function scrub(text: string): string {
  const home = homedir();
  const user = userInfo().username;
  let out = text.replaceAll(home, "/home/user");
  if (user.length >= 3) {
    // word-boundary match, case-insensitive: "ryan", "Ryan", "/Users/ryan"
    out = out.replace(
      new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
      "user",
    );
  }
  return out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "user@example.com");
}
