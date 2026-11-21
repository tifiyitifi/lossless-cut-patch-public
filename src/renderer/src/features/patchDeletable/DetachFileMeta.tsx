import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { PatchDeepCheckView, PatchFileQuickHealth } from '../../../../common/features/patchDeletable';
import { formatDuration } from '../../util/duration';
import { buildSourceListDetail } from '../patchSourceList/sourceListDetails';
import type { DetachableFileDetails } from './useDetachableFileDetails';

/**
The type scale of the deletion check (fork-owned).

One size per role, instead of a number wherever a style happens to be written. The chips are in `rem`
on purpose: the same chip is used inside a card (1 em of the page) and inside the toolbar row (which
is set smaller), and a chip that shrank with its container would make one control look like two.

The `em` values are relative to the 16 px base that `main.css` sets on `html`.
*/
export const patchCheckText = {
  /** The window title. */
  windowTitle: '1.02em',
  /** Settings labels, the toolbar row and the summary bars. */
  toolbar: '.85em',
  /** A card's file name. */
  cardTitle: '.9em',
  /** A group header, a card's state line, its duration/size/time line and its notices. */
  meta: '.78em',
  /** Every chip and chip button. */
  chip: '.75rem',
} as const;

/**
The chip shape every panel row, card and header button shares.

`fontFamily` instead of the `font` shorthand: the shorthand also resets the font size, and React
applies an inline style in key order - here it would land after `fontSize` and undo it.
*/
export const chipStyle = {
  background: 'var(--gray-3)',
  border: '1px solid var(--gray-6)',
  borderRadius: '.3em',
  padding: '.05em .4em',
  fontSize: patchCheckText.chip,
  lineHeight: 1.35,
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
} as const;

/** The same chip, as a button (a result card's Locate, the column header's select all/none). */
export const chipButtonStyle = { ...chipStyle, cursor: 'pointer', color: 'var(--gray-11)' } as const;

/** The `duration · size · modified` line the source list also uses. */
export function FileDetailLine({ details }: { details: DetachableFileDetails | undefined }) {
  const parts = buildSourceListDetail(details);
  if (parts.length === 0) return <span style={{ opacity: 0.4 }}>…</span>;
  return <>{parts.map((part) => part.text).join(' · ')}</>;
}

/**
The same line, as parts that wrap between the values.

A card is narrow (140 px in the compact preset), so a single line would clip the modification time
that the card is read by. Every value stays on one line (`whiteSpace: nowrap`), the line as a whole
wraps, and the separator stays glued to nothing: it is its own span, so a wrap can happen before or
after it.
*/
export function FileDetailParts({ details }: { details: DetachableFileDetails | undefined }) {
  const parts = buildSourceListDetail(details);
  if (parts.length === 0) return <span style={{ opacity: 0.4 }}>…</span>;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', columnGap: '.30em', rowGap: 0 }}>
      {parts.map((part, index) => (
        <span key={part.field} style={{ whiteSpace: 'nowrap' }}>
          {index > 0 && <span style={{ color: 'var(--gray-8)' }}>· </span>}
          {part.text}
        </span>
      ))}
    </span>
  );
}

/**
The fast status: shape only, never a promise that the file plays (see `health.ts`).

A healthy file is the norm, so it shows nothing at all - a tick on every card would be noise that
hides the cards that do have something to say. Every problem keeps its full text.
*/
export function QuickHealthChip({ health }: { health: PatchFileQuickHealth }) {
  const { t } = useTranslation();
  switch (health) {
    case 'ok': {
      return null;
    }
    case 'empty': {
      return <span style={{ ...chipStyle, color: 'var(--red-9)' }}>{t('Empty file (0 B)')}</span>;
    }
    case 'duration-unreadable': {
      return <span style={{ ...chipStyle, color: 'var(--orange-9)' }}>{t('Duration unreadable')}</span>;
    }
    default: {
      return <span style={{ ...chipStyle, color: 'var(--orange-9)' }}>{t('Could not be read')}</span>;
    }
  }
}

/**
The optional full decode of one row, with its progress, its cancel button and its result.

Every finished result is a button, not a label: the check is a snapshot of the file as it was read, and
the user may want it again after a disk error, a moved file or a run that was stopped early. The
tooltip of each state says what the run covered and what it did not, and the arrow marks the chip as
repeatable.

The idle tooltip is the place where the user learns what the check actually is: it decodes every video
and audio packet of the first video stream and of all audio streams, skips subtitles, attachments and
extra video tracks, and proves the streams decode - not that a particular player can open the file.
*/
export function DeepCheckControl({ state, onStart, onCancel }: {
  state: PatchDeepCheckView | undefined;
  onStart: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const phase = state?.phase ?? 'idle';

  // The card itself is the click target that selects it, so checking a file must not change what is
  // selected for deletion - the same rule the play and locate buttons follow.
  const start = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onStart();
  };
  const cancel = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onCancel();
  };

  if (phase === 'running') {
    const percent = state?.ratio != null ? Math.round(state.ratio * 100) : undefined;
    return (
      <span style={{ display: 'inline-flex', gap: '.35em', alignItems: 'center' }}>
        <span
          style={{ ...chipStyle, color: 'var(--blue-9)' }}
          title={t('The share of the file decoded so far. The check stops at the first packet FFmpeg cannot decode.')}
        >
          {percent == null ? t('Decoding...') : t('Decoding... {{percent}}%', { percent })}
        </span>
        <button type="button" onClick={cancel} style={chipButtonStyle}>{t('Cancel')}</button>
      </span>
    );
  }

  if (phase === 'ok') {
    return (
      <button
        type="button"
        onClick={start}
        style={{ ...chipButtonStyle, color: 'var(--green-9)' }}
        title={t('Every video and audio packet decoded, though subtitles, attachments and extra video tracks were skipped. Click to decode the file again and replace this result.')}
      >
        {t('Full decode passed')} <span aria-hidden>↻</span>
      </button>
    );
  }

  if (phase === 'failed') {
    const at = state?.atSeconds != null ? formatDuration({ seconds: state.atSeconds, showFraction: false }) : undefined;
    return (
      <button
        type="button"
        onClick={start}
        style={{ ...chipButtonStyle, color: 'var(--red-9)' }}
        title={state?.message ?? t('FFmpeg stopped at the first packet it could not decode. Click to run the check again.')}
      >
        {at == null ? t('Decode failed') : t('Decode failed at {{time}}', { time: at })} <span aria-hidden>↻</span>
      </button>
    );
  }

  if (phase === 'canceled') {
    return (
      <button
        type="button"
        onClick={start}
        style={{ ...chipButtonStyle, color: 'var(--gray-11)' }}
        title={t('The check stopped before the end of the file, so it says nothing about whether the file plays. Click to run it again.')}
      >
        {t('Decode check stopped')} <span aria-hidden>↻</span>
      </button>
    );
  }

  if (phase === 'unavailable') {
    return (
      <button
        type="button"
        onClick={start}
        style={{ ...chipButtonStyle, color: 'var(--orange-9)' }}
        title={state?.message ?? t('The decode check could not start. Click to try again.')}
      >
        {t('The decode check could not run')} <span aria-hidden>↻</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      style={chipButtonStyle}
      title={t('Decodes every video and audio packet with FFmpeg and stops at the first one it cannot decode. Subtitles, attachments and extra video tracks are skipped, a pass does not promise that a particular player can open the file, and it takes about as long as the file.')}
    >
      {t('Full decode check')}
    </button>
  );
}
