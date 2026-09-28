import type { AudioFrame } from '@resonance/shared';

/** One line of the helper's NDJSON output. */
export type HelperLine =
  | { kind: 'frame'; frame: AudioFrame }
  | { kind: 'ready' }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'ignored' };

function clamp01(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Parse one line from the audio helper.
 *
 * Every field is clamped rather than trusted. The helper applies its own gain
 * shaping, and a value slipping outside 0..1 would propagate into CSS custom
 * properties and shader uniforms where the effect is a visual glitch rather than
 * an error anyone would trace back here.
 *
 * Kept pure so the protocol can be tested without spawning a process — the same
 * arrangement as the MediaRemote payload parser.
 */
export function parseHelperLine(line: string): HelperLine {
  const trimmed = line.trim();
  if (trimmed === '') return { kind: 'ignored' };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return { kind: 'error', code: 'unparseable', message: trimmed.slice(0, 200) };
  }

  switch (parsed['type']) {
    case 'frame':
      return {
        kind: 'frame',
        frame: {
          bass: clamp01(parsed['bass']),
          mid: clamp01(parsed['mid']),
          treble: clamp01(parsed['treble']),
          rms: clamp01(parsed['rms']),
          centroid: clamp01(parsed['centroid']),
          onset: parsed['onset'] === true,
        },
      };
    case 'ready':
      return { kind: 'ready' };
    case 'error':
      return {
        kind: 'error',
        code: typeof parsed['code'] === 'string' ? parsed['code'] : 'unknown',
        message: typeof parsed['message'] === 'string' ? parsed['message'] : '',
      };
    default:
      return { kind: 'ignored' };
  }
}

/** Map a helper error code onto the state the UI shows. */
export function stateForErrorCode(code: string): 'denied' | 'unsupported' | 'off' {
  if (code === 'denied') return 'denied';
  if (code === 'unsupported') return 'unsupported';
  return 'off';
}
