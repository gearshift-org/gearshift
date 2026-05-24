export const CURRENT_PROTOCOL_VERSION = 1
export const SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [1]

export type ClientMessage =
  | { type: "hello"; protocolVersions: number[] }
  | { type: "list" }
  | {
      type: "open"
      sessionId: string
      shell: string
      args: string[]
      cwd: string
      cols: number
      rows: number
      env: Record<string, string>
    }
  | { type: "attach"; sessionId: string }
  | { type: "input"; sessionId: string; data: string }
  | { type: "resize"; sessionId: string; cols: number; rows: number }
  | { type: "close"; sessionId: string }

export type ServerMessage =
  | { type: "hello-ack"; protocolVersion: number; daemonVersion: string }
  | { type: "error"; reason: string; sessionId?: string }
  | { type: "list"; sessions: Array<{ sessionId: string; pid: number }> }
  | { type: "opened"; sessionId: string; pid: number }
  | {
      type: "attached"
      sessionId: string
      pid: number
      cols: number
      rows: number
      replay: string
    }
  | { type: "data"; sessionId: string; data: string }
  | { type: "exit"; sessionId: string; exitCode: number; signal?: number }

const LENGTH_PREFIX_BYTES = 4
// Hard cap per frame. Anything bigger means the peer is broken or hostile —
// without this the decoder would Buffer.concat indefinitely waiting for a
// 4 GB payload and OOM the daemon.
const MAX_FRAME_BYTES = 16 * 1024 * 1024

export class FrameDecodeError extends Error {}

export function encodeFrame(msg: ClientMessage | ServerMessage): Buffer {
  const payload = Buffer.from(JSON.stringify(msg), "utf8")
  const frame = Buffer.alloc(LENGTH_PREFIX_BYTES + payload.length)
  frame.writeUInt32BE(payload.length, 0)
  payload.copy(frame, LENGTH_PREFIX_BYTES)
  return frame
}

export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): Array<ClientMessage | ServerMessage> {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk])
    const out: Array<ClientMessage | ServerMessage> = []
    while (this.buf.length >= LENGTH_PREFIX_BYTES) {
      const len = this.buf.readUInt32BE(0)
      if (len > MAX_FRAME_BYTES) {
        this.buf = Buffer.alloc(0)
        throw new FrameDecodeError(
          `frame length ${len} exceeds cap ${MAX_FRAME_BYTES}`,
        )
      }
      if (this.buf.length < LENGTH_PREFIX_BYTES + len) break
      const json = this.buf
        .subarray(LENGTH_PREFIX_BYTES, LENGTH_PREFIX_BYTES + len)
        .toString("utf8")
      this.buf = this.buf.subarray(LENGTH_PREFIX_BYTES + len)
      try {
        out.push(JSON.parse(json))
      } catch {
        // Malformed frame; advance past it so the stream can recover.
      }
    }
    return out
  }
}
