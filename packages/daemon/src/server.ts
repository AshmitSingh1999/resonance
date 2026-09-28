import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve as resolvePath } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg, ServerMsg } from '@resonance/shared';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export interface ServerOptions {
  port: number;
  /** Directory of built web assets. Absent during development, when Vite serves. */
  webRoot: string | null;
  /** Called when a client connects, so current state can be replayed to it. */
  onConnect: (send: (message: ServerMsg) => void) => void;
  onClientMessage: (message: ClientMsg) => void;
  /**
   * Upstream URL of a track's audio preview, if one is known.
   *
   * The bytes are proxied rather than linked directly: Apple's CDN does not send
   * CORS headers, so `fetch` + `decodeAudioData` in the page would be blocked.
   */
  previewUrlFor?: (trackId: string) => string | null;
}

/**
 * Serves the page and pushes state to it.
 *
 * State is broadcast rather than polled, and every new client is replayed the
 * current track, lyrics and position on connect — so opening a second tab, or
 * reloading after a code change, lands mid-song rather than blank.
 */
export class ResonanceServer {
  #wss: WebSocketServer | null = null;
  readonly #clients = new Set<WebSocket>();

  constructor(private readonly options: ServerOptions) {}

  async start(): Promise<void> {
    const http = createServer((request, response) => void this.#serveStatic(request, response));

    this.#wss = new WebSocketServer({ server: http });
    this.#wss.on('connection', (socket) => {
      this.#clients.add(socket);
      socket.on('close', () => this.#clients.delete(socket));
      socket.on('message', (raw) => {
        try {
          this.options.onClientMessage(JSON.parse(String(raw)) as ClientMsg);
        } catch {
          // A malformed frame from a page is not worth tearing the socket down.
        }
      });
      this.options.onConnect((message) => this.#sendTo(socket, message));
    });

    await new Promise<void>((done) => http.listen(this.options.port, done));
  }

  broadcast(message: ServerMsg): void {
    const payload = JSON.stringify(message);
    for (const socket of this.#clients) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  #sendTo(socket: WebSocket, message: ServerMsg): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  }

  /** Stream a track's preview through, so the page can decode it same-origin. */
  async #servePreview(trackId: string, response: ServerResponse): Promise<void> {
    const upstream = this.options.previewUrlFor?.(trackId) ?? null;
    if (upstream === null) {
      response.writeHead(404).end('no preview');
      return;
    }
    try {
      const fetched = await fetch(upstream, { signal: AbortSignal.timeout(8_000) });
      if (!fetched.ok || fetched.body === null) {
        response.writeHead(502).end('preview unavailable');
        return;
      }
      response.writeHead(200, {
        'Content-Type': fetched.headers.get('content-type') ?? 'audio/mp4',
        'Cache-Control': 'public, max-age=86400',
      });
      response.end(Buffer.from(await fetched.arrayBuffer()));
    } catch {
      response.writeHead(502).end('preview fetch failed');
    }
  }

  async #serveStatic(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestedPath = (request.url ?? '/').split('?')[0] ?? '/';
    if (requestedPath.startsWith('/preview/')) {
      await this.#servePreview(decodeURIComponent(requestedPath.slice('/preview/'.length)), response);
      return;
    }

    const root = this.options.webRoot;
    if (root === null) {
      response.writeHead(404).end('Run the Vite dev server for the UI.');
      return;
    }

    const requested = (request.url ?? '/').split('?')[0] ?? '/';
    // Resolve inside the web root and verify containment, so a crafted path
    // cannot escape it — this server is on localhost but still faces a browser.
    const candidate = resolvePath(join(root, normalize(requested)));
    if (!candidate.startsWith(resolvePath(root))) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    let filePath = candidate;
    try {
      if ((await stat(filePath)).isDirectory()) filePath = join(filePath, 'index.html');
    } catch {
      // Unknown paths fall through to the app shell, so client routing works.
      filePath = join(root, 'index.html');
    }

    try {
      const body = await readFile(filePath);
      response
        .writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' })
        .end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  }

  async stop(): Promise<void> {
    for (const socket of this.#clients) socket.close();
    this.#clients.clear();
    this.#wss?.close();
  }
}
