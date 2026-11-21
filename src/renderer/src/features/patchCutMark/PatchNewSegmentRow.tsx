import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

/**
The cut queue's "0" row (patch, fork-owned).

It sits above the first segment for as long as `Alt+/` has armed "the next in point starts a
new segment" (see `common/features/patchCutMark`). The row is a *marker of the mode*, not a
segment: it is never part of `cutSegments`, so it cannot be exported, merged, counted in the
queue, or saved into a `.llc` file.

Clicking it runs the in point right away, which is exactly what the row promises: the segment
starts at the playhead and becomes the current one (so the arm is used up and the row disappears).
*/
export default function PatchNewSegmentRow({ onCreate, style }: {
  onCreate: () => void,
  style?: CSSProperties | undefined,
}) {
  const { t } = useTranslation();

  return (
    // A div, not a button: focusing a real button would take the focus off `document.body`, and the
    // upstream keyboard hook only dispatches there - the in-point key would go dead after clicking.
    <div
      role="button"
      onClick={onCreate}
      title={t('The next in point starts a new segment. Press it or click here to start it now.')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '.5em',
        width: '100%',
        margin: '.15em 0',
        padding: '.35em .5em',
        border: '1px dashed var(--gray-8)',
        borderRadius: 3,
        background: 'var(--gray-4)',
        color: 'var(--gray-12)',
        cursor: 'pointer',
        font: 'inherit',
        textAlign: 'left',
        ...style,
      }}
    >
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 'bold', minWidth: '1.2em', color: 'var(--gray-11)' }}>0</span>
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
        <span style={{ fontSize: '.85em' }}>{t('New segment')}</span>
        <span style={{ fontSize: '.7em', color: 'var(--gray-11)' }}>{t('The next in point starts a new segment. Press it or click here to start it now.')}</span>
      </span>
    </div>
  );
}
