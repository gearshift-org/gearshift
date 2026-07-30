/**
 * Prepare clipboard text for an agent composer without emitting a bare return.
 * Trailing line breaks are discarded because many copied blocks include one,
 * while internal line breaks use the terminal's Shift+Enter sequence.
 */
export function prepareAgentPaste(
  text: string,
  multilineEnterSequence: string
): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n+$/g, "")
    .split("\n")
    .join(multilineEnterSequence)
}
