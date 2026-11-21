import { useTranslation } from 'react-i18next';

import type { PatchNoticeId } from '../../../../common/features/patchNotice';

import Checkbox from '../../components/Checkbox';
import { usePatchNotice } from './PatchNoticeProvider';

/**
The "do not show this again" checkbox of a patch-mode notice (fork-owned).

The box ships unchecked: silencing a notice is an explicit act, never a default. Ticking it
writes the setting right away, so it also applies to a notice that is dismissed with "Close".
*/
export default function PatchDontShowAgainCheckbox({ noticeId }: { noticeId: PatchNoticeId }) {
  const { t } = useTranslation();
  const patchNotice = usePatchNotice();

  if (patchNotice == null) return null;

  return (
    <Checkbox
      label={t('Do not show this again')}
      // The dialog body is a list with a 1em indent, so the box lines up with the list items.
      style={{ marginTop: '.6em', marginLeft: '1em' }}
      checked={patchNotice.isSuppressed(noticeId)}
      onCheckedChange={(checked) => {
        if (checked) patchNotice.suppress(noticeId);
        else patchNotice.unsuppress(noticeId);
      }}
    />
  );
}
