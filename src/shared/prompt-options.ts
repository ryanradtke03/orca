export interface PromptOption {
  number: string
  label: string
}

const OPTION_LINE = /^\s*❯?\s*(\d+)[.)]\s*(.+?)\s*$/
const CURSOR_LINE = /❯/

/**
 * Only the cursor line and what follows it are real menu options — text
 * above it (the command/question being asked) can itself contain numbered
 * lines that would otherwise be mistaken for options.
 */
function parsePromptOptions(text: string): PromptOption[] {
  const lines = text.split(/\r?\n/)
  const cursorIndex = lines.findIndex((line) => CURSOR_LINE.test(line))
  const optionLines = cursorIndex === -1 ? lines : lines.slice(cursorIndex)

  const options: PromptOption[] = []
  for (const line of optionLines) {
    const match = OPTION_LINE.exec(line)
    if (match) options.push({ number: match[1], label: match[2] })
  }
  return options
}

export interface PermissionResponses {
  approve: string
  deny: string
}

/**
 * Maps a permission prompt's rendered options to the responses that approve
 * or deny it. Claude Code's dialog always puts "Yes" first and a "No" variant
 * last, but the option count (and therefore the "No" option's number) varies
 * with the tool being run, so this reads the actual numbers from the text
 * rather than assuming a fixed layout.
 */
export function resolvePermissionResponses(text: string): PermissionResponses {
  const options = parsePromptOptions(text)

  const approve = options.find((option) => /^yes\b/i.test(option.label))
  const deny = [...options].reverse().find((option) => /^no\b/i.test(option.label))

  return {
    approve: approve?.number ?? '1',
    deny: deny?.number ?? options[options.length - 1]?.number ?? '2'
  }
}
