import type { SyntheticEvent } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { TimecodeFormat } from '../../../../common/types';
import type { TimecodeHintId } from '../../../../common/features/timecodeInput/formatHints';
import { getTimecodeHintGroups } from '../../../../common/features/timecodeInput/formatHints';
import { applyCompactSwap } from '../../../../common/features/timecodeInput/compactSwap';
import patchConfig from '../patchWork/patchConfigApi';

const cellStyle = {
  padding: '.15em .4em',
  textAlign: 'left',
  verticalAlign: 'top',
  borderTop: '1px solid var(--gray-6)',
} as const;

const headingStyle = { margin: '.5em 0 .15em', fontWeight: 'bold' } as const;

/**
The formats the timecode input accepts, as a collapsible table inside the patch-mode `g` dialog
(fork-owned).

The rows come from `common/features/timecodeInput/formatHints`, so the help follows the active
timecode format (plain seconds, frame count, frames as the fraction) and the compact `..` forms.
The descriptions are the only copy: templates and examples are technical constants.

`swapped` follows the dialog's swap switch: the table then shows the two groups the way they are
typed in that mode (compact forms without the marker, everything else after `..`), because a help
table that disagrees with the input would be worse than no table.

The block starts open and the user closes it by hand: the state is remembered in the patch
settings, so a closed block stays closed for the next seek and the next session (same pattern as
the cut queue's guide).
*/
export default function TimecodeHelp({ mode, showRelative, swapped }: {
  mode: TimecodeFormat,
  /** Does the dialog turn a leading `+`/`-` into a relative seek? */
  showRelative: boolean,
  /** Are plain numbers read as compact time (the dialog's swap switch)? */
  swapped: boolean,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => patchConfig.getPatchSetting('timecodeHelpOpen'));

  const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const nextOpen = event.currentTarget.open;
    setOpen(nextOpen);
    patchConfig.setPatchSetting('timecodeHelpOpen', nextOpen);
  };

  // The descriptions never spell the `..` marker out: the table above them carries the marker, so
  // the same sentence is right in both switch positions.
  const descriptions = useMemo<Record<TimecodeHintId, string>>(() => ({
    compactFields: t('Dots only separate the values, so the padding may be left out: 1.2.3 and 0102.3 are both 01:02:03.'),
    compactMillis: t('A fourth value is milliseconds: 12.34.56.7 is 12:34:56.700.'),
    compactMinutesSeconds: t('Hours are left out: 34.56 is 34 minutes 56 seconds.'),
    compactPositional: t('Digits only, read as hours, minutes, seconds and milliseconds. Pad single digits yourself: 12345 is 01:23:45, not 12:34:05.'),
    compactColon: t('Colons separate the values too, but dots are the recommended form.'),
    relative: t('A leading + or - seeks from the current position instead of jumping to that time.'),
    seconds: t('Plain seconds, with an optional fraction.'),
    commaDecimal: t('A comma works as the decimal separator too.'),
    minutesSeconds: t('Minutes and seconds.'),
    hoursMinutesSeconds: t('Hours, minutes, seconds and milliseconds.'),
    frameCount: t('A frame number.'),
    frameMinutesSeconds: t('Minutes, seconds and frames: this format shows the fraction as frames, not as milliseconds.'),
    frameHoursMinutesSeconds: t('Hours, minutes, seconds and frames.'),
  }), [t]);

  const groups = getTimecodeHintGroups({ mode, showRelative }).map((group) => ({
    ...group,
    hints: group.hints.map((hint) => ({
      ...hint,
      template: applyCompactSwap(hint.template, swapped),
      example: applyCompactSwap(hint.example, swapped),
    })),
  }));

  const groupTitle = (id: 'compact' | 'mode') => {
    if (id === 'compact') return t(swapped ? 'Compact time, written without ..' : 'Compact time, written after ..');
    return t(swapped ? 'This timecode format, written after ..' : 'This timecode format');
  };

  return (
    <details open={open} onToggle={onToggle} style={{ margin: '.5em 0', padding: '.3em .5em', border: '1px solid var(--gray-6)', borderRadius: 4, color: 'var(--gray-11)', fontSize: '.8em' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>{t('Accepted timecode formats')}</summary>

      <div style={{ maxHeight: '32vh', overflowY: 'auto' }}>
        {swapped && (
          <p style={{ margin: '.4em 0' }}>
            {t('The switch is on: a plain number is compact time and a leading .. asks for this timecode format. A timecode copied from elsewhere therefore needs .. in front of it.')}
          </p>
        )}

        {groups.map((group) => (
          <div key={group.id}>
            <div style={headingStyle}>{groupTitle(group.id)}</div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={cellStyle}>{t('Template')}</th>
                  <th style={cellStyle}>{t('Example')}</th>
                  <th style={cellStyle}>{t('Meaning')}</th>
                </tr>
              </thead>

              <tbody>
                {group.hints.map((hint) => (
                  <tr key={hint.id}>
                    <td style={cellStyle}><code>{hint.template}</code></td>
                    <td style={cellStyle}><code>{hint.example}</code></td>
                    <td style={cellStyle}>{descriptions[hint.id]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </details>
  );
}
