import type { ClientMsg, ServerMsg } from '@resonance/shared';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

/**
 * WebSocket link to the daemon, with reconnection.
 *
 * The daemon is a local process the user may restart while the page stays open,
 * so a dropped connection is an ordinary event rather than an error. Backoff is
 * capped low so reconnecting after a restart still feels immediate.
 */
export class Connection {
  #socket: WebSocket | null = null;
  #retryMs = 250;
  #closed = false;

  constructor(
    private readonly url: string,
    private readonly onMessage: (message: ServerMsg) => void,
    private readonly onStatus: (status: ConnectionStatus) => void,
  ) {}

  connect(): void {
    if (this.#closed) return;
    this.onStatus('connecting');

    const socket = new WebSocket(this.url);
    this.#socket = socket;

    socket.onopen = () => {
      this.#retryMs = 250;
      this.onStatus('open');
    };
    socket.onmessage = (event) => {
      try {
        this.onMessage(JSON.parse(String(event.data)) as ServerMsg);
      } catch {
        // Ignore a frame we cannot read rather than breaking the stream.
      }
    };
    socket.onclose = () => {
      this.onStatus('closed');
      if (this.#closed) return;
      setTimeout(() => this.connect(), this.#retryMs);
      this.#retryMs = Math.min(this.#retryMs * 2, 5_000);
    };
    socket.onerror = () => socket.close();
  }

  send(message: ClientMsg): void {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.#closed = true;
    this.#socket?.close();
  }
}
