import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FaWrench } from 'react-icons/fa';
import { IoMdCheckmark } from 'react-icons/io';

import * as DropdownMenu from '../../components/DropdownMenu';
import { primaryTextColor } from '../../colors';
import type { DamagePlaybackQuality, SourceDamageKind, SourceRepairChoice } from '../../../../common/features/damagedSource';
import { getSourceRepairCopy } from '../../../../common/features/damagedSource';

const noteStyle = { padding: '.15em .8em .35em', color: 'var(--gray-11)', fontSize: '.85em', lineHeight: 1.3 } as const;

function Row({ checked, disabled, onSelect, children }: {
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Item disabled={disabled === true} onSelect={onSelect} style={{ gap: '.45em', opacity: disabled === true ? 0.5 : undefined }}>
      <span style={{ width: '1em', flexShrink: 0, display: 'inline-flex', color: primaryTextColor }}>{checked ? <IoMdCheckmark /> : null}</span>
      <span>{children}</span>
    </DropdownMenu.Item>
  );
}

/**
The tools menu of the player (fork-owned).

It sits with the other controls under the timeline and shows a wrench only: the bottom bar already
has more labels than fits, and this is an operation on one file, not a mode of the app. The icon is
highlighted while a repair is running, the same way the waveform and thumbnail toggles show their
state.

The menu is the window's own, so it always describes the file this window has open. The native
Tools > Repair menu offers the same choices for the focused window; both write the same settings.
*/
export default function SourceRepairMenu({
  kinds, repair, quality, exportRepair, onChoice, onExportRepair,
}: {
  /** What the probe found in the open file; empty for a healthy file. */
  kinds: SourceDamageKind[];
  repair: boolean;
  quality: DamagePlaybackQuality;
  exportRepair: boolean;
  onChoice: (choice: SourceRepairChoice) => void;
  onExportRepair: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const hasDamage = kinds.length > 0;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          title={t('Repair')}
          aria-label={t('Repair')}
          style={{ background: 'none', border: 0, padding: 0, margin: '0 .2em', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
        >
          <FaWrench style={{ fontSize: '1.2em', color: repair ? primaryTextColor : 'var(--gray-12)' }} />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content side="top" align="start" sideOffset={5} style={{ minWidth: '17em' }}>
          {hasDamage ? (
            <>
              {kinds.map((kind) => {
                const copy = getSourceRepairCopy(kind, t);
                return (
                  <div key={kind}>
                    <div style={{ ...noteStyle, color: 'var(--gray-12)', paddingBottom: 0 }}>{copy.title}</div>
                    <div style={noteStyle}>{copy.symptom}</div>
                  </div>
                );
              })}

              <DropdownMenu.Separator />
              <Row checked={!repair} onSelect={() => onChoice('off')}>{t('Play this file as stored')}</Row>
              <Row checked={repair} onSelect={() => onChoice(quality)}>{t('Repair this file')}</Row>

              <DropdownMenu.Separator />
              <Row checked={repair && quality === 'smooth'} disabled={!repair} onSelect={() => onChoice('smooth')}>
                {t('Smooth (800 pixels wide)')}
              </Row>
              <Row checked={repair && quality === 'original'} disabled={!repair} onSelect={() => onChoice('original')}>
                {t('Original resolution')}
              </Row>
            </>
          ) : (
            <div style={noteStyle}>{t('No damage detected in this file')}</div>
          )}

          <DropdownMenu.Separator />
          <Row checked={exportRepair} onSelect={() => onExportRepair(!exportRepair)}>{t('Repair exported clips too')}</Row>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
