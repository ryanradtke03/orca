export type ParsedLine =
  | { ok: true; value: unknown }
  | { ok: false; line: string };

/**
 * Turn stdout lines into parsed JSON. Never throws: a bad line comes back as { ok: false }.
 * onLine lets a caller see every raw line (used later for trace files).
 */
export async function* parseJsonLines(
  lines: AsyncIterable<string>,
  onLine?: (line: string) => void,
): AsyncGenerator<ParsedLine> {
  for await (const line of lines) {
    if (!line.trim()) continue;
    onLine?.(line);
    try {
      yield { ok: true, value: JSON.parse(line) };
    } catch {
      yield { ok: false, line };
    }
  }
}
