import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import * as Dialog from '../../components/Dialog';
import { DialogButton } from '../../components/Button';
import { useGenericDialogContext } from '../../components/GenericDialog';
import type { DamagePlaybackQuality } from '../../../../common/features/damagedSource';

export interface DamagePlaybackAnswer {
  repair: boolean;
  /** Only present when repairing. */
  quality?: DamagePlaybackQuality | undefined;
}

const hintStyle = { fontSize: '.85em', color: 'var(--gray-11)', lineHeight: 1.4, marginTop: '.15em' } as const;
const sectionStyle = { margin: '1em 0 0', color: 'var(--gray-12)', fontWeight: 500 } as const;

function Choice({ id, name, checked, disabled = false, onSelect, hint, children }: {
  id: string;
  name: string;
  checked: boolean;
  disabled?: boolean | undefined;
  onSelect: () => void;
  hint: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', gap: '.4em', alignItems: 'flex-start', marginTop: '.5em', opacity: disabled ? 0.55 : 1 }}>
      <input id={id} type="radio" name={name} checked={checked} disabled={disabled} onChange={onSelect} style={{ marginTop: '.3em', flexShrink: 0 }} />
      <div>
        <label htmlFor={id} style={{ cursor: disabled ? 'default' : 'pointer', lineHeight: 1.35 }}>{children}</label>
        <div style={hintStyle}>{hint}</div>
      </div>
    </div>
  );
}

/**
The "this file is stored badly" question, shown once per file per run (fork-owned).

The wording is deliberately plain: the user does not know what a composition time offset is, and
telling them would not help. What they need to know is that the stutter is in the file, that other
players hide it, that cutting it correctly requires re-encoding the video, and that repairing
playback comes in two qualities.

The choice only decides playback (`features/damagedSource`): the export setting is the user's own
switch and is never changed from here, so saying "watch it as is" cannot silently produce clips
with the same defect.
*/
export default function DamagedSourcePrompt({ initialQuality, exportRepair, canExport, originalResolutionAvailable, onConfirm }: {
  /** The quality the settings currently use, preselected so "repair" behaves as the user configured. */
  initialQuality: DamagePlaybackQuality;
  exportRepair: boolean;
  /** The results windows cannot export, so they must not promise anything about it. */
  canExport: boolean;
  /** False when the source's frame rate is unknown: the full-resolution preview would drift. */
  originalResolutionAvailable: boolean;
  onConfirm: (answer: DamagePlaybackAnswer) => void;
}) {
  const { t } = useTranslation();
  const { onOpenChange } = useGenericDialogContext();
  const [quality, setQuality] = useState<DamagePlaybackQuality>(originalResolutionAvailable ? initialQuality : 'smooth');

  const confirm = useCallback(() => {
    onConfirm({ repair: true, quality });
    onOpenChange(false);
  }, [onConfirm, onOpenChange, quality]);

  return (
    <Dialog.Content aria-describedby={undefined} style={{ width: '60vw' }}>
      <Dialog.Title>
        {t('This video is stored in a way that some players cannot show correctly')}
      </Dialog.Title>

      <Dialog.Description>
        {t('Its frames are not saved in the order you see them, and the file is missing the small table that tells a player how to put them back in the right order. VLC and PotPlayer work the order out by themselves, so they look fine. The player built into this app cannot, so the picture keeps jumping back a frame.')}
      </Dialog.Description>

      {canExport && (
        <Dialog.Description>
          {t(exportRepair ? 'To cut this video correctly the video has to be re-encoded, so that is what exporting does for this kind of file. A plain lossless copy keeps the problem: the clips would look fine in VLC but would keep jumping here, in Chrome and in Edge. Repairing this kind of file re-encodes the whole video of every clip, not only its ends, so exporting takes as long as encoding the clips; the original file is left unmodified.' : 'Cutting this video correctly needs the video re-encoded, but "repair exported clips" is turned off, so the clips you cut now will keep the problem. You can turn it on in the export options (E) before you export.')}
        </Dialog.Description>
      )}

      <div style={sectionStyle}>
        {t('How should it play while you work on it?')}
      </div>

      <Choice
        id="damaged-playback-smooth"
        name="damaged-playback"
        checked={quality === 'smooth'}
        onSelect={() => setQuality('smooth')}
        hint={t('The picture is a smaller copy of the original, which keeps up on almost any computer.')}
      >
        {t('Smooth (800 pixels wide)')}
      </Choice>

      <Choice
        id="damaged-playback-original"
        name="damaged-playback"
        checked={quality === 'original'}
        disabled={!originalResolutionAvailable}
        onSelect={() => setQuality('original')}
        hint={t(originalResolutionAvailable ? 'The full picture, as sharp as the file itself. Needs a fast CPU; on a slower computer it can stutter again.' : 'Unavailable: the frame rate of this file could not be read, so the full-size preview would drift away from the sound.')}
      >
        {t('Original resolution')}
      </Choice>

      <div style={{ ...hintStyle, marginTop: '.9em' }}>
        {t('Both repairs fix the jumping picture. You can switch between them, or turn the repair off, from the wrench button under the timeline, or from Tools → Repair in the menu bar. The default is in Settings → Damaged source videos.')}
      </div>

      <Dialog.ButtonRow>
        <DialogButton
          onClick={() => {
            onConfirm({ repair: false });
            onOpenChange(false);
          }}
        >
          {t('Watch it as it is')}
        </DialogButton>

        <DialogButton primary onClick={confirm}>{t('Repair and continue')}</DialogButton>
      </Dialog.ButtonRow>
    </Dialog.Content>
  );
}
