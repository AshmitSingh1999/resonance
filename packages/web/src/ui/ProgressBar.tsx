/**
 * Song progress, as a full-width hairline pinned to the bottom of the window.
 *
 * Driven by a `--progress` custom property written from the app's animation
 * frame, and scaled with `transform` rather than `width`. Animating `width`
 * would trigger layout on every frame, and the transition it needed to look
 * smooth actively fought a value already being updated sixty times a second —
 * which is what made the previous bar look laggy. A transform stays on the
 * compositor and needs no transition at all.
 */
export function ProgressBar({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="progress" aria-hidden>
      <div className="progress__fill" />
    </div>
  );
}
