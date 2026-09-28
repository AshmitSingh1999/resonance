import { describe, it, expect } from 'vitest';
import { parseHelperLine, stateForErrorCode } from '../src/audio/frames.js';

const frameLine = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'frame', bass: 0.4, mid: 0.3, treble: 0.2, rms: 0.5, centroid: 0.6, onset: false, ...over });

describe('parseHelperLine', () => {
  it('parses a feature frame', () => {
    const result = parseHelperLine(frameLine());
    expect(result).toEqual({
      kind: 'frame',
      frame: { bass: 0.4, mid: 0.3, treble: 0.2, rms: 0.5, centroid: 0.6, onset: false },
    });
  });

  it('recognises the ready line', () => {
    expect(parseHelperLine('{"type":"ready"}')).toEqual({ kind: 'ready' });
  });

  it('recognises a structured error', () => {
    expect(parseHelperLine('{"type":"error","code":"denied","message":"nope"}')).toEqual({
      kind: 'error',
      code: 'denied',
      message: 'nope',
    });
  });

  it('clamps values above one', () => {
    // The helper applies its own gain shaping; a stray value above 1 would reach
    // a shader uniform and glitch silently rather than fail loudly.
    expect(parseHelperLine(frameLine({ bass: 4.2 })).kind === 'frame' &&
      (parseHelperLine(frameLine({ bass: 4.2 })) as { frame: { bass: number } }).frame.bass).toBe(1);
  });

  it('clamps negative values to zero', () => {
    const r = parseHelperLine(frameLine({ rms: -3 })) as { frame: { rms: number } };
    expect(r.frame.rms).toBe(0);
  });

  it('treats missing or non-numeric fields as zero', () => {
    const r = parseHelperLine('{"type":"frame"}') as { frame: Record<string, number> };
    expect(r.frame).toMatchObject({ bass: 0, mid: 0, treble: 0, rms: 0, centroid: 0 });
  });

  it('coerces a non-boolean onset to false', () => {
    const r = parseHelperLine(frameLine({ onset: 1 })) as { frame: { onset: boolean } };
    expect(r.frame.onset).toBe(false);
  });

  it('reports unparseable output as an error rather than throwing', () => {
    const r = parseHelperLine('not json at all');
    expect(r.kind).toBe('error');
  });

  it('ignores blank lines', () => {
    expect(parseHelperLine('')).toEqual({ kind: 'ignored' });
    expect(parseHelperLine('   ')).toEqual({ kind: 'ignored' });
  });

  it('ignores line types it does not know', () => {
    expect(parseHelperLine('{"type":"future"}')).toEqual({ kind: 'ignored' });
  });

  it('truncates a very long unparseable line', () => {
    const r = parseHelperLine('x'.repeat(5000)) as { message: string };
    expect(r.message.length).toBeLessThanOrEqual(200);
  });
});

describe('stateForErrorCode', () => {
  it('maps the codes the UI needs to distinguish', () => {
    expect(stateForErrorCode('denied')).toBe('denied');
    expect(stateForErrorCode('unsupported')).toBe('unsupported');
    expect(stateForErrorCode('tap-failed')).toBe('off');
  });
});
