import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IoIosHelpCircle } from 'react-icons/io';

import type { JoinRepairBlockReason, MergeBoundaryGuard, MergeBoundaryPolicy } from '../../../../common/features/patchExportPolicy';
import AnimatedTr from '../../components/AnimatedTr';
import { withBlur } from '../../util';
import { primaryTextColor } from '../../colors';

/**
The A/B/C choice of how a patch cut treats its cut points (fork-owned).

Rendered inside the export options table of the `E` dialog, so the user can switch it right where
the export happens. It applies to every patch cut result, a single one included: the repair
rewrites the clip's ends, so it cannot be added later when the results are merged. Two rows,
because the guard only belongs to policy A. Each row has the same `?` bubble the other export
options use, because both choices trade a re-encode and a little content for a smoother join and
that cost is not obvious from the label alone.

The explanation is deliberately blunt about the cause: a merged lossless cut cannot have a clean
join (see `features/patchExportPolicy/policy.ts`), and the "fast playback after a seek" the user
may have seen is the same defect, not a player bug.
*/

export interface MergeBoundaryControl {
  policy: MergeBoundaryPolicy;
  guard: MergeBoundaryGuard;
  setPolicy: (policy: MergeBoundaryPolicy) => void;
  setGuard: (guard: MergeBoundaryGuard) => void;
  /** A keeps this many extra frames at every cut end (for the note under the guard choice). */
  guardFrames: number;
  /** The same guard in seconds. */
  guardSeconds: number;
  /** The user's `-shortest` setting cannot be used: a copied track would end the clip before the video. */
  shortestBlocked: boolean;
  /** Why the join repair is skipped for this export (`undefined` when it runs). */
  repairBlockReason: JoinRepairBlockReason | undefined;
  /** The subtitle/data tracks are cut in their own pass and remuxed (no re-encode, a second write). */
  extraRemux: boolean;
  /** Extend the last cut result to the source video's real last frame. */
  tailToSourceEnd: boolean;
  setTailToSourceEnd: (value: boolean) => void;
}

const hintStyle = { fontSize: '.85em', color: 'var(--gray-11)', lineHeight: 1.35, marginTop: '.2em' } as const;
const helpIconStyle = { fontSize: '1.2em', verticalAlign: 'middle', cursor: 'pointer', color: primaryTextColor } as const;

function Choice({ id, name, checked, onSelect, disabled, children }: {
  id: string;
  name: string;
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', gap: '.35em', alignItems: 'flex-start' }}>
      <input id={id} type="radio" name={name} checked={checked} disabled={disabled} onChange={onSelect} style={{ marginTop: '.25em', flexShrink: 0 }} />
      <label htmlFor={id} style={{ cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1, lineHeight: 1.3 }}>{children}</label>
    </div>
  );
}

export default function MergeBoundarySection({
  policy, guard, setPolicy, setGuard, guardFrames, guardSeconds, shortestBlocked, repairBlockReason, extraRemux, tailToSourceEnd, setTailToSourceEnd, showHelpText,
}: MergeBoundaryControl & { showHelpText: (options: { text: string }) => void }) {
  const { t } = useTranslation();

  return (
    <>
      <AnimatedTr>
        <td>
          {t('Cut points when merging')}
          <div style={hintStyle}>
            {t('A merged lossless cut leaves the video timeline broken at every cut: a short freeze, and a burst of fast playback right after you seek. The default re-encodes one small group of frames at each cut point to repair it.')}
          </div>
          <div style={hintStyle}>
            {t('These options change the clips themselves: A and B re-encode the ends of every clip (H.264 sources without rotation only); A also keeps a little extra, so a single result is slightly longer. C keeps the pure lossless cut. Merging these results later reuses them.')}
          </div>
        </td>
        <td>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.25em', fontSize: '.9em' }}>
            <Choice id="patch-merge-boundary-a" name="patchMergeBoundary" checked={policy === 'losslessGuard'} onSelect={() => setPolicy('losslessGuard')}>
              {t('A — repair the joins, and keep a little extra past every cut end')}
            </Choice>
            <Choice id="patch-merge-boundary-b" name="patchMergeBoundary" checked={policy === 'exactTail'} onSelect={() => setPolicy('exactTail')}>
              {t('B — repair the joins, and cut exactly where you asked')}
            </Choice>
            <Choice id="patch-merge-boundary-c" name="patchMergeBoundary" checked={policy === 'compat'} onSelect={() => setPolicy('compat')}>
              {t('C — no re-encode (old behaviour): fast, but the joins stutter')}
            </Choice>
          </div>
          {repairBlockReason === 'streams' && (
            <div style={{ ...hintStyle, color: 'var(--amber-11)' }}>
              {t('This export also copies a track from another file or a subtitle/data track, so the joins cannot be repaired: A and B fall back to the old behaviour and the joins may stutter. Disable that track under Tracks and export again to get the smooth result.')}
            </div>
          )}
          {repairBlockReason === 'codec' && (
            <div style={{ ...hintStyle, color: 'var(--amber-11)' }}>
              {t('The join repair only supports H.264 sources. This export falls back to the old behaviour and the joins may stutter.')}
            </div>
          )}
          {repairBlockReason === 'rotation' && (
            <div style={{ ...hintStyle, color: 'var(--amber-11)' }}>
              {t('The join repair cannot repair a rotated video. This export falls back to the old behaviour and the joins may stutter.')}
            </div>
          )}
          {repairBlockReason === 'fps' && (
            <div style={{ ...hintStyle, color: 'var(--amber-11)' }}>
              {t('The frame rate is unknown, so the join repair cannot place the cut ends. This export falls back to the old behaviour and the joins may stutter.')}
            </div>
          )}
          {shortestBlocked && (
            <div style={{ ...hintStyle, color: 'var(--amber-11)' }}>
              {t('The "shortest" setting is on, but this export keeps a track that ends before the video, so using it would cut the clip. It is left out for this export.')}
            </div>
          )}
          {extraRemux && (
            <div style={hintStyle}>
              {t('This export keeps a subtitle or data track, so every clip is cut in two passes and then joined again: no re-encoding, but a second write per clip.')}
            </div>
          )}
          <div style={{ ...hintStyle, marginTop: '.45em' }}>
            {t('PotPlayer: turning off automatic audio/video sync stops the fast playback after a seek. It hides the symptom, not the broken join.')}
          </div>
        </td>
        <td>
          <IoIosHelpCircle
            role="button"
            onClick={withBlur(() => showHelpText({
              text: t('A lossless cut cannot end on an arbitrary frame: it stops a few frames early and drops the last B-frames. When several clips are merged, that missing piece is in the middle of the file: a short freeze at every join. A copied clip can also start a few frames late, which puts two frames on the same timestamp. A player follows the audio clock, so after you seek it re-aligns and drops frames to catch up: that is the burst of fast playback. It is a known ffmpeg limitation (see mifi/lossless-cut #2921 and #1202), not a player bug. A and B repair it by re-encoding the first and last group of frames of every clip (up to one GOP at each end, about 2-4 seconds per cut point on a source with a 4 second GOP) and by telling the merge exactly where each clip\'s video ends; the middle of every clip is still copied untouched. A keeps a few extra frames past every cut end, B cuts exactly where you asked. C keeps the old command line: no re-encoding at all, but the joins keep both defects. The choice applies to every cut result, a single clip included, because a result that is merged later can no longer have its ends re-encoded. The repair only works for H.264 sources without rotation; other sources, and an unknown frame rate, fall back to the old behaviour and the dialog says which rule stopped it.'),
            }))}
            style={helpIconStyle}
          />
        </td>
      </AnimatedTr>

      <AnimatedTr>
        <td>
          {t('Last cut and the source end')}
          <div style={hintStyle}>
            {t('Only the last result of an export can reach the source video\'s real last frame, and only when its cut end is the end of the video. A last result that stops earlier keeps its cut point. The other results and the merge join repair are not changed.')}
          </div>
        </td>
        <td>
          <div style={{ display: 'flex', gap: '.35em', alignItems: 'flex-start', fontSize: '.9em' }}>
            <input
              id="patch-tail-to-source-end"
              type="checkbox"
              checked={tailToSourceEnd}
              onChange={(e) => setTailToSourceEnd(e.currentTarget.checked)}
              style={{ marginTop: '.25em', flexShrink: 0 }}
            />
            <label htmlFor="patch-tail-to-source-end" style={{ cursor: 'pointer', lineHeight: 1.3 }}>
              {t('Include the source\'s last frame in the last result')}
            </label>
          </div>
        </td>
        <td>
          <IoIosHelpCircle
            role="button"
            onClick={withBlur(() => showHelpText({
              text: t('A lossless cut stops before its end time, so the last result can miss the frame you stopped on. When this is on, the last result keeps that frame; when its cut end is also the end of the video, it is extended to the source video\'s real last frame, even when the player reports a shorter duration (AV1 sources do this). A last result that stops before the video end keeps its cut point and only includes one more frame. Only the last result changes: the other results, the A/B/C join repair and base mode are untouched. Turn it off to keep the exact cut, without the extra frame.'),
            }))}
            style={helpIconStyle}
          />
        </td>
      </AnimatedTr>

      <AnimatedTr>
        <td>
          {t('Extra tail kept by A')}
          <div style={hintStyle}>
            {t('A keeps {{frames}} extra frames ({{seconds}} s) at every cut end.', { frames: guardFrames, seconds: guardSeconds.toFixed(2) })}
          </div>
        </td>
        <td>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.25em', fontSize: '.9em' }}>
            <Choice id="patch-merge-guard-bframes" name="patchMergeGuard" checked={guard === 'bFrames'} onSelect={() => setGuard('bFrames')} disabled={policy !== 'losslessGuard'}>
              {t('From the B-frame count (default)')}
            </Choice>
            <Choice id="patch-merge-guard-fixed" name="patchMergeGuard" checked={guard === 'fixed'} onSelect={() => setGuard('fixed')} disabled={policy !== 'losslessGuard'}>
              {t('Always 0.1 seconds')}
            </Choice>
          </div>
        </td>
        <td>
          <IoIosHelpCircle
            role="button"
            onClick={withBlur(() => showHelpText({
              text: t('How much extra content A keeps after your cut point. From the B-frame count: a three-level B-frame video gets 6 frames (about 0.1 s at 60 fps), a video without B frames still gets the 6-frame minimum. Always 0.1 seconds: the same duration whatever the frame rate. More is safer for a cut that is hard to place but shows more content that you did not select. It only applies to A.'),
            }))}
            style={helpIconStyle}
          />
        </td>
      </AnimatedTr>
    </>
  );
}
