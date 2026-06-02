const MASK = "********"
export const MAX_CHAT_HISTORY_BODY_LENGTH = 500

const SECRET_FIELD_RE =
  /((?:"|')?(?:api[_-]?key|apikey|password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key)(?:"|')?\s*[:=]\s*)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s,;&]+))/gi

const AUTHORIZATION_RE =
  /\b(Authorization\s*:\s*(?:Bearer|Basic|Token)\s+)[A-Za-z0-9._~+/=-]+/gi

const HIGH_ENTROPY_TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g

const KNOWN_SECRET_PATTERNS: RegExp[] = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
]

export function truncateChatHistoryBody(input: string): string {
  if (input.length <= MAX_CHAT_HISTORY_BODY_LENGTH) return input
  return `${input.slice(0, MAX_CHAT_HISTORY_BODY_LENGTH)}…`
}

export function sanitizeChatHistoryBody(input: string): string {
  return truncateChatHistoryBody(redactSecrets(input))
}

export function redactSecrets(input: string): string {
  let redacted = input.replace(
    SECRET_FIELD_RE,
    (_match, prefix: string, doubleQuoted?: string, singleQuoted?: string) => {
      if (doubleQuoted !== undefined) return `${prefix}"${MASK}"`
      if (singleQuoted !== undefined) return `${prefix}'${MASK}'`
      return `${prefix}${MASK}`
    }
  )

  redacted = redacted.replace(AUTHORIZATION_RE, `$1${MASK}`)

  for (const pattern of KNOWN_SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, MASK)
  }

  redacted = redacted.replace(HIGH_ENTROPY_TOKEN_RE, (token) => {
    if (!/[a-z]/.test(token) || !/[A-Z]/.test(token) || !/\d/.test(token)) {
      return token
    }
    return MASK
  })

  return redacted
}
