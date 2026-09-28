import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Lyrics } from '@resonance/shared';
import { wordProgress } from '../sync/scheduler.js';
import type { ActiveLyricView } from '../sync/scheduler.js';

import { layoutById } from '../theme/layouts.js';
import type { LayoutId } from '@resonance/shared';

interface Props {
  lyrics: Lyrics | null;
  view: ActiveLyricView;
  /** How many context lines to keep, and which arrangement class to wear. */
  layout: LayoutId;
}

/**
 * The active line, with a word-level highlight sweep.
 *
 * LRCLIB timings are per line, so the sweep is interpolated across the line's
 * window. It is an approximation of when each word is sung, but it gives the eye
 * something to follow rather than a line that appears and then waits.
 */
function ActiveLine({ text, progress }: { text: string; progress: number }) {
  const words = useMemo(() => text.split(/\s+/).filter((word) => word !== ''), [text]);
  const progresses = useMemo(
    () => wordProgress({ startMs: 0, endMs: 1, text }, progress),
    [text, progress],
  );

  return (
    <>
      {words.map((word, index) => (
        // The space between words is a real text node, not margin. Adjacent
        // spans with no whitespace give the browser no break opportunity, so the
        // line could not wrap and simply ran off the edge.
        <Fragment key={`${word}-${index}`}>
          {index > 0 ? ' ' : null}
          <span
            className="word"
            // `--index` lets a family stagger words without any per-word
            // JavaScript; Cascade uses it as an animation delay.
            style={
              { '--sung': progresses[index] ?? 0, '--index': index } as React.CSSProperties
            }
          >
            {word}
          </span>
        </Fragment>
      ))}
    </>
  );
}

export function LyricStage({ lyrics, view, layout }: Props) {
  const arrangement = layoutById(layout);
  const stageRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLParagraphElement>(null);
  const [shiftPx, setShiftPx] = useState(0);

  /**
   * Centre the active line by measuring it.
   *
   * Lines wrap to different heights depending on their length and the viewport,
   * so translating the stack by a fixed per-line step misplaces every line after
   * the first wrapped one. Measuring the real offset is the only thing that stays
   * correct as text reflows.
   */
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const active = activeRef.current;
    if (stage === null || active === null) return;
    const centre = stage.clientHeight / 2;
    setShiftPx(centre - (active.offsetTop + active.offsetHeight / 2));
  }, [view.index, lyrics, layout]);

  if (lyrics === null) return <div className="stage stage--empty" />;

  if (lyrics.kind === 'plain') {
    // No timings to follow, so the words are offered as a static reading rather
    // than implying a synchronisation we do not have.
    return (
      <div className={`stage stage--plain ${arrangement.className}`}>
        {lyrics.lines.map((line, index) => (
          <p key={index} className="line line--static">
            {line.text}
          </p>
        ))}
      </div>
    );
  }

  if (lyrics.kind === 'none') {
    return (
      <div className={`stage stage--empty ${arrangement.className}`}>
        <p className="line--hint">no lyrics found for this track</p>
      </div>
    );
  }

  const first = Math.max(0, view.index - arrangement.contextBefore);
  const window = lyrics.lines.slice(first, view.index + arrangement.contextAfter + 1);

  return (
    <div className={`stage ${arrangement.className}`} ref={stageRef}>
      <div className="stack" style={{ transform: `translateY(${shiftPx}px)` }}>
        {window.map((line, offset) => {
          const index = first + offset;
          const isActive = index === view.index;
          const distance = Math.abs(index - view.index);
          const blank = line.text.trim() === '';

          return (
            <p
              key={index}
              ref={isActive ? activeRef : null}
              className={[
                'line',
                isActive ? 'line--active' : index < view.index ? 'line--past' : 'line--future',
                blank ? 'line--instrumental' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ '--distance': distance } as React.CSSProperties}
            >
              {blank ? '· · ·' : isActive ? <ActiveLine text={line.text} progress={view.progress} /> : line.text}
            </p>
          );
        })}
      </div>
    </div>
  );
}
