import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Lyrics } from '@resonance/shared';

/**
 * `node:sqlite` is loaded through `createRequire` rather than imported.
 *
 * It ships with Node 22 and needs no native build, but the bundler used by the
 * test runner predates it: its builtin list does not contain `sqlite`, so it
 * strips the `node:` prefix and fails trying to resolve a package named
 * `sqlite`. Requiring it at runtime hands resolution to Node, which knows.
 */
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
type Database = InstanceType<typeof DatabaseSync>;

/**
 * Persistent lyrics cache.
 *
 * Misses are cached as well as hits. Without that, replaying an album LRCLIB does
 * not know would re-query the whole tracklist on every listen — rude to a free,
 * unauthenticated service and slow for us. Misses expire so that lyrics uploaded
 * later are eventually picked up.
 */
/**
 * How far apart two durations may be while still being the same recording.
 *
 * Generous enough to absorb the second or two that different sources report for
 * one track, tight enough to keep a radio edit from matching an extended mix.
 */
const SAME_RECORDING_TOLERANCE_MS = 15_000;

export class LyricsCache {
  readonly #db: Database;

  constructor(
    path: string,
    private readonly missTtlMs = 7 * 24 * 60 * 60 * 1000,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    // Keyed on name *and* length: one song can have several recordings, and
    // showing a 3-minute edit's lyrics over a 6-minute mix would be wrong.
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS lyrics (
        cache_key   TEXT NOT NULL,
        duration_ms INTEGER,
        kind        TEXT NOT NULL,
        lines_json  TEXT NOT NULL,
        source_id   TEXT,
        fetched_at  INTEGER NOT NULL,
        PRIMARY KEY (cache_key, duration_ms)
      );
    `);
  }

  /**
   * Read the cached entry for this recording.
   *
   * Duration is compared with a tolerance rather than for equality, because it is
   * a continuous quantity: an exact-match key would fragment on the small
   * differences separate sources report for the same track.
   *
   * A cached miss is honoured only while fresh; past its TTL it is reported as
   * absent so the resolver tries the network again and picks up later uploads.
   */
  get(cacheKey: string, durationMs: number | null): Lyrics | null {
    const rows = this.#db
      .prepare(
        'SELECT kind, lines_json, source_id, duration_ms, fetched_at FROM lyrics WHERE cache_key = ?',
      )
      .all(cacheKey) as {
      kind: string;
      lines_json: string;
      source_id: string | null;
      duration_ms: number | null;
      fetched_at: number;
    }[];
    if (rows.length === 0) return null;

    let best: (typeof rows)[number] | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const distance =
        durationMs === null || row.duration_ms === null
          ? 0
          : Math.abs(row.duration_ms - durationMs);
      if (distance <= SAME_RECORDING_TOLERANCE_MS && distance < bestDistance) {
        bestDistance = distance;
        best = row;
      }
    }
    if (best === undefined) return null;

    if (best.kind === 'none' && Date.now() - best.fetched_at > this.missTtlMs) return null;

    return {
      kind: best.kind as Lyrics['kind'],
      lines: JSON.parse(best.lines_json) as Lyrics['lines'],
      sourceId: best.source_id,
    };
  }

  set(cacheKey: string, lyrics: Lyrics, durationMs: number | null): void {
    this.#db
      .prepare(
        `INSERT INTO lyrics (cache_key, duration_ms, kind, lines_json, source_id, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(cache_key, duration_ms) DO UPDATE SET
           kind = excluded.kind,
           lines_json = excluded.lines_json,
           source_id = excluded.source_id,
           fetched_at = excluded.fetched_at`,
      )
      .run(cacheKey, durationMs, lyrics.kind, JSON.stringify(lyrics.lines), lyrics.sourceId, Date.now());
  }

  close(): void {
    this.#db.close();
  }
}
