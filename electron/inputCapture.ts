import { appendMessage, type ChatHistoryMessage } from "./db/chatDb"

type State = {
  buf: string
  cursor: number
  inPaste: boolean
}

const states = new Map<string, State>()

function getState(sessionId: string): State {
  let s = states.get(sessionId)
  if (!s) {
    s = { buf: "", cursor: 0, inPaste: false }
    states.set(sessionId, s)
  }
  return s
}

function insertAt(s: State, text: string) {
  s.buf = s.buf.slice(0, s.cursor) + text + s.buf.slice(s.cursor)
  s.cursor += text.length
}

function backspace(s: State) {
  if (s.cursor === 0) return
  s.buf = s.buf.slice(0, s.cursor - 1) + s.buf.slice(s.cursor)
  s.cursor -= 1
}

function deleteForward(s: State) {
  if (s.cursor >= s.buf.length) return
  s.buf = s.buf.slice(0, s.cursor) + s.buf.slice(s.cursor + 1)
}

function reset(s: State) {
  s.buf = ""
  s.cursor = 0
}

export type FlushHandler = (msg: ChatHistoryMessage) => void

/**
 * Feed raw bytes the user typed into a session. On Enter we extract the line.
 * Lines are persisted only when an agent CLI is detected for the session.
 */
export function feed(
  sessionId: string,
  projectId: string | null,
  data: string,
  agent: string | null,
  onFlush: FlushHandler,
): void {
  const s = getState(sessionId)
  let i = 0
  while (i < data.length) {
    const ch = data[i]
    if (s.inPaste) {
      // Look for end-of-paste marker \x1b[201~
      if (
        ch === "\x1b" &&
        data.slice(i, i + 6) === "\x1b[201~"
      ) {
        s.inPaste = false
        i += 6
        continue
      }
      if (ch === "\r" || ch === "\n") {
        // Newlines inside a bracketed paste are part of one prompt. The final
        // Enter after the paste submits and records the whole pasted block.
        insertAt(s, "\n")
        i += ch === "\r" && data[i + 1] === "\n" ? 2 : 1
        continue
      }
      insertAt(s, ch)
      i += 1
      continue
    }

    if (ch === "\r" || ch === "\n") {
      if (agent && s.buf.trim().length > 0) {
        void appendMessage(sessionId, projectId, s.buf, agent)
          .then(onFlush)
          .catch((err) => console.error("[chatDb] appendMessage", err))
      }
      reset(s)
      i += 1
      continue
    }

    // Backspace (\b or DEL)
    if (ch === "\x08" || ch === "\x7f") {
      backspace(s)
      i += 1
      continue
    }

    // Ctrl-U: clear line
    if (ch === "\x15") {
      reset(s)
      i += 1
      continue
    }

    // Ctrl-W: delete previous word
    if (ch === "\x17") {
      while (s.cursor > 0 && /\s/.test(s.buf[s.cursor - 1])) backspace(s)
      while (s.cursor > 0 && !/\s/.test(s.buf[s.cursor - 1])) backspace(s)
      i += 1
      continue
    }

    // Ctrl-C: abort current line without recording
    if (ch === "\x03") {
      reset(s)
      i += 1
      continue
    }

    if (ch === "\x1b") {
      // Bracketed paste start \x1b[200~
      if (data.slice(i, i + 6) === "\x1b[200~") {
        s.inPaste = true
        i += 6
        continue
      }
      const next = data[i + 1]
      // CSI sequence \x1b[ ...
      if (next === "[") {
        let j = i + 2
        // Parameter bytes 0x30-0x3F, intermediate 0x20-0x2F, final 0x40-0x7E
        while (j < data.length) {
          const code = data.charCodeAt(j)
          if (code >= 0x40 && code <= 0x7e) {
            const finalByte = data[j]
            const params = data.slice(i + 2, j)
            if (finalByte === "D") {
              if (s.cursor > 0) s.cursor -= 1
            } else if (finalByte === "C") {
              if (s.cursor < s.buf.length) s.cursor += 1
            } else if (finalByte === "H") {
              s.cursor = 0
            } else if (finalByte === "F") {
              s.cursor = s.buf.length
            } else if (finalByte === "~" && params === "3") {
              deleteForward(s)
            }
            // Other CSI sequences (colors, cursor moves on output) are
            // irrelevant for keystroke capture; ignore.
            j += 1
            break
          }
          j += 1
        }
        i = j
        continue
      }
      // OSC (]), DCS (P), SOS (X), PM (^), APC (_): skip everything up to
      // a terminator — either BEL (\x07) or ST (\x1b\\). xterm.js answers
      // OSC color queries through onData → term:write, so these byte
      // sequences arrive through this same pipe and would otherwise be
      // captured as if the user had typed them.
      if (
        next === "]" ||
        next === "P" ||
        next === "X" ||
        next === "^" ||
        next === "_"
      ) {
        let j = i + 2
        while (j < data.length) {
          const c = data[j]
          if (c === "\x07") {
            j += 1
            break
          }
          if (c === "\x1b" && data[j + 1] === "\\") {
            j += 2
            break
          }
          j += 1
        }
        i = j
        continue
      }
      // ESC alone or ESC + single byte (Alt-key combo).
      i += next ? 2 : 1
      continue
    }

    const code = ch.charCodeAt(0)
    // Drop C0 controls (other than the ones handled above) and C1 controls.
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      i += 1
      continue
    }

    insertAt(s, ch)
    i += 1
  }
}

export function dispose(sessionId: string): void {
  states.delete(sessionId)
}

export function disposeAll(): void {
  states.clear()
}
