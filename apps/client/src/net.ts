import {
  decodeMessages,
  encodeMessage,
  MessageType,
  PROTOCOL_VERSION,
  type HelloPayload,
  type InputPayload,
  type PongPayload,
  type SnapshotPayload,
  type WelcomePayload,
} from "@azure-edge/shared";

export interface NetCallbacks {
  onWelcome(w: WelcomePayload): void;
  onSnapshot(s: SnapshotPayload): void;
  onReject(seq: number, reason: string): void;
  onClose(): void;
}

/**
 * Browser WebSocket client. Binary framing per PROTOCOL.md.
 * `simulatedLatencyMs` splits the delay across both directions (out/in),
 * so the measured ping ≈ the configured value — used for the M0 100 ms test.
 */
export class GameClient {
  private ws: WebSocket | null = null;
  private inbound: Uint8Array = new Uint8Array(0);
  private readonly latencyHalf: number;
  private pingTimer: number | null = null;
  private lastPingSent = 0;
  /** Last measured round-trip time (ms), including simulated latency. */
  rttMs = 0;
  /** Snapshot ticks missed (gap in serverTick) — approximate packet loss. */
  lostSnapshots = 0;
  private lastServerTick = -1;

  constructor(
    private readonly url: string,
    simulatedLatencyMs: number,
    private readonly cb: NetCallbacks,
  ) {
    this.latencyHalf = Math.max(0, simulatedLatencyMs) / 2;
  }

  connect(name: string): void {
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      const hello: HelloPayload = { protocolVersion: PROTOCOL_VERSION, clientBuild: "m0", name };
      this.sendRaw(encodeMessage(MessageType.Hello, hello));
      this.pingTimer = window.setInterval(() => this.sendPing(), 1000);
    };
    ws.onmessage = (ev: MessageEvent) => {
      const data = new Uint8Array(ev.data as ArrayBuffer);
      // Simulated inbound latency.
      window.setTimeout(() => this.handleData(data), this.latencyHalf);
    };
    ws.onclose = () => {
      if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
      this.cb.onClose();
    };
  }

  private handleData(data: Uint8Array): void {
    const joined = new Uint8Array(this.inbound.length + data.length);
    joined.set(this.inbound, 0);
    joined.set(data, this.inbound.length);
    this.inbound = joined;
    const { messages, rest } = decodeMessages(this.inbound);
    this.inbound = rest;
    for (const { type, payload } of messages) {
      if (type === MessageType.Welcome) this.cb.onWelcome(payload as WelcomePayload);
      else if (type === MessageType.Snapshot) {
        const snap = payload as SnapshotPayload;
        if (this.lastServerTick >= 0 && snap.serverTick > this.lastServerTick + 1) {
          this.lostSnapshots += snap.serverTick - this.lastServerTick - 1;
        }
        this.lastServerTick = snap.serverTick;
        this.cb.onSnapshot(snap);
      } else if (type === MessageType.Pong) {
        const pong = payload as PongPayload;
        this.rttMs = performance.now() - pong.clientTime;
      } else if (type === MessageType.Reject) {
        const r = payload as { seq: number; reason: string };
        this.cb.onReject(r.seq, r.reason);
      }
    }
  }

  private sendRaw(bytes: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.latencyHalf > 0) {
      const copy = bytes.slice();
      window.setTimeout(() => this.ws?.send(copy), this.latencyHalf);
    } else {
      this.ws.send(bytes);
    }
  }

  sendInput(input: InputPayload): void {
    this.sendRaw(encodeMessage(MessageType.Input, input));
  }

  private sendPing(): void {
    this.lastPingSent = performance.now();
    this.sendRaw(encodeMessage(MessageType.Ping, { clientTime: this.lastPingSent }));
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
