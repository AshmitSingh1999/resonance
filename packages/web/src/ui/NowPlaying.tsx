import type { Track } from '@resonance/shared';

/** Shared with the progress readout; exported so there is one formatter. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

interface Props {
  track: Track | null;
  positionMs: number;
  playing: boolean;
}

export function NowPlaying({ track, positionMs, playing }: Props) {
  if (track === null) return null;

  return (
    <div className="now-playing">
      {track.artworkDataUrl !== null && (
        <img className="now-playing__art" src={track.artworkDataUrl} alt="" />
      )}
      <div className="now-playing__text">
        <div className="now-playing__title">{track.title}</div>
        <div className="now-playing__artist">{track.artist}</div>
        <div className="now-playing__time">
          <span className={playing ? 'dot dot--live' : 'dot'} />
          {clock(positionMs)}
          {track.durationMs !== null && ` / ${clock(track.durationMs)}`}
        </div>
      </div>
    </div>
  );
}
