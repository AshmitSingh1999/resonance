import { describe, it, expect } from 'vitest';
import { parseLrc } from '../src/lrc.js';

describe('parseLrc', () => {
  it('parses [mm:ss.xx] centisecond timestamps', () => {
    const r = parseLrc('[00:14.93] You cannot keep me down');
    expect(r.lines).toEqual([
      { startMs: 14930, endMs: Number.POSITIVE_INFINITY, text: 'You cannot keep me down' },
    ]);
  });

  it('parses [mm:ss.xxx] millisecond timestamps', () => {
    expect(parseLrc('[01:02.345] hi').lines[0]!.startMs).toBe(62345);
  });

  it('treats a 2-digit fraction as centiseconds, not milliseconds', () => {
    // [00:00.05] is 50ms, not 5ms. This is the classic LRC parsing bug.
    expect(parseLrc('[00:00.05] x').lines[0]!.startMs).toBe(50);
  });

  it('sets each line endMs to the next line startMs', () => {
    const r = parseLrc('[00:01.00] a\n[00:03.50] b');
    expect(r.lines[0]).toMatchObject({ startMs: 1000, endMs: 3500 });
    expect(r.lines[1]!.endMs).toBe(Number.POSITIVE_INFINITY);
  });

  it('clamps the final endMs to track duration when provided', () => {
    const r = parseLrc('[00:01.00] a', { durationMs: 9000 });
    expect(r.lines[0]!.endMs).toBe(9000);
  });

  it('expands multiple timestamps on one line into repeated lines', () => {
    const r = parseLrc('[00:10.00][01:20.00] chorus');
    expect(r.lines.map((l) => l.startMs)).toEqual([10000, 80000]);
    expect(r.lines.every((l) => l.text === 'chorus')).toBe(true);
  });

  it('sorts out-of-order lines by start time', () => {
    const r = parseLrc('[00:30.00] second\n[00:10.00] first');
    expect(r.lines.map((l) => l.text)).toEqual(['first', 'second']);
  });

  it('extracts metadata tags without emitting them as lyric lines', () => {
    const r = parseLrc('[ar:Swedish House Mafia]\n[ti:Lioness]\n[00:01.00] words');
    expect(r.meta).toMatchObject({ ar: 'Swedish House Mafia', ti: 'Lioness' });
    expect(r.lines).toHaveLength(1);
  });

  it('applies a positive [offset:] tag by shifting timestamps later', () => {
    // LRC convention: offset is milliseconds to shift the lyrics.
    const r = parseLrc('[offset:+500]\n[00:10.00] x');
    expect(r.lines[0]!.startMs).toBe(10500);
  });

  it('applies a negative [offset:] tag', () => {
    expect(parseLrc('[offset:-250]\n[00:10.00] x').lines[0]!.startMs).toBe(9750);
  });

  it('never produces a negative timestamp after applying offset', () => {
    expect(parseLrc('[offset:-5000]\n[00:01.00] x').lines[0]!.startMs).toBe(0);
  });

  it('keeps timed blank lines as instrumental gap markers', () => {
    const r = parseLrc('[00:01.00] a\n[00:05.00]\n[00:09.00] b');
    expect(r.lines).toHaveLength(3);
    expect(r.lines[1]!.text).toBe('');
  });

  it('ignores untimed junk lines', () => {
    const r = parseLrc('not a lyric line\n[00:01.00] real');
    expect(r.lines).toHaveLength(1);
  });

  it('handles minutes beyond 59 and CRLF line endings', () => {
    const r = parseLrc('[75:30.00] long\r\n[00:01.00] early\r\n');
    expect(r.lines.map((l) => l.startMs)).toEqual([1000, 75 * 60000 + 30000]);
  });

  it('returns an empty result for empty or whitespace-only input', () => {
    expect(parseLrc('').lines).toEqual([]);
    expect(parseLrc('   \n  \n').lines).toEqual([]);
  });

  it('trims surrounding whitespace from lyric text', () => {
    expect(parseLrc('[00:01.00]    padded   ').lines[0]!.text).toBe('padded');
  });
});
