import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { LightState } from '@resonance/shared';

export interface BridgeEvents {
  state: (state: LightState, detail?: string) => void;
  /** A colour write finished, so another may be sent. */
  wrote: () => void;
}

/**
 * Supervises the Python bulb bridge.
 *
 * Third use of the spawn-a-helper-that-speaks-NDJSON pattern in this repo, after
 * the MediaRemote perl adapter and the Swift audio helper. The difference is that
 * this one takes input too: commands go in on stdin.
 *
 * Python rather than Node because `tuyapi` is no longer actively developed while
 * `tinytuya` is, and only the latter covers the 3.4/3.5 protocol versions current
 * bulb firmware uses.
 */
export class LightBridge extends EventEmitter {
  #child: ChildProcess | null = null;
  #stopping = false;
  #state: LightState = 'off';

  constructor(
    private readonly pythonPath: string,
    private readonly scriptPath: string,
    private readonly configPath: string,
  ) {
    super();
  }

  get state(): LightState {
    return this.#state;
  }

  get connected(): boolean {
    return this.#state === 'live';
  }

  override on<E extends keyof BridgeEvents>(event: E, listener: BridgeEvents[E]): this {
    return super.on(event, listener);
  }

  #setState(state: LightState, detail?: string): void {
    if (this.#state === state) return;
    this.#state = state;
    this.emit('state', state, detail);
  }

  start(): void {
    if (this.#child !== null) return;

    if (!existsSync(this.pythonPath) || !existsSync(this.scriptPath)) {
      // Not an error: the light is optional and everything else works without it.
      this.#setState('unconfigured', 'bulb bridge not installed — run scripts/tuya-setup.sh');
      return;
    }

    this.#stopping = false;
    this.#setState('connecting');

    const child = spawn(this.pythonPath, [this.scriptPath, '--config', this.configPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.#child = child;

    createInterface({ input: child.stdout! }).on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed === '') return;
      try {
        const message = JSON.parse(trimmed) as { type?: string; code?: string; message?: string };
        if (message.type === 'ready') this.#setState('live');
        else if (message.type === 'wrote') this.emit('wrote');
        else if (message.type === 'error') {
          this.#setState(
            message.code === 'unconfigured' || message.code === 'no-tinytuya'
              ? 'unconfigured'
              : 'unreachable',
            message.message,
          );
        }
      } catch {
        // The bridge writes only JSON to stdout; anything else is not ours.
      }
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text !== '') console.error(`[resonance] bulb: ${text}`);
    });

    child.on('exit', (code) => {
      this.#child = null;
      if (this.#stopping) return;
      this.#setState('off', `bulb bridge exited (${code})`);
    });
  }

  /**
   * Send a command. Returns false when the bridge is not running, so the caller
   * can release its throttle rather than waiting for an answer that never comes.
   */
  send(command: Record<string, unknown>): boolean {
    const stdin = this.#child?.stdin;
    if (stdin === undefined || stdin === null || stdin.destroyed) return false;
    return stdin.write(`${JSON.stringify(command)}\n`);
  }

  stop(): void {
    this.#stopping = true;
    this.#child?.kill('SIGTERM');
    this.#child = null;
    this.#setState('off');
  }
}
