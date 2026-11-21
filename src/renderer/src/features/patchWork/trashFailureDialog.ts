import type { TFunction } from 'i18next';

import { getParentPath } from '../../../../common/features/patchFinish';
import getSwal from '../../swal';

/**
The refusal window for an empty work folder that could not be moved to the recycle bin.

The app never falls back to a permanent delete: the folder is left untouched and the user is
given the folder it lives in, so the cleanup can be finished by hand. Shared by the `cewd`
command and the finish dialog's optional cleanup.
*/
export interface WorkDirTrashFailure {
  path: string;
  reason?: string | undefined;
}

export async function showWorkDirTrashFailureDialog({ t, failures, clearedCount }: {
  t: TFunction;
  failures: readonly WorkDirTrashFailure[];
  /** Folders the same run did clear, so the window does not look like a total failure. */
  clearedCount?: number | undefined;
}): Promise<void> {
  const [first] = failures;
  if (first == null) return;

  const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const lines = failures.slice(0, 5).map((failure) => [
    '<div style="margin-top:.5em;word-break:break-all">',
    `<code>${escapeHtml(failure.path)}</code>`,
    failure.reason != null ? `<div style="font-size:.9em;opacity:.8">${escapeHtml(failure.reason)}</div>` : '',
    '</div>',
  ].join(''));

  const clearedLine = clearedCount != null && clearedCount > 0
    ? `<div>${escapeHtml(t('Moved {{count}} empty work folder(s) to the recycle bin. Nothing else was touched.', { count: clearedCount }))}</div>`
    : '';

  const answer = await getSwal().Swal.fire({
    icon: 'warning',
    title: t('Some work folders were left alone'),
    html: [
      clearedLine,
      `<div>${escapeHtml(t('The recycle bin is not available here, so nothing was deleted. Open the folder and remove it by hand if you want to.'))}</div>`,
      ...lines,
    ].join(''),
    showCancelButton: true,
    confirmButtonText: t('Close'),
    cancelButtonText: t('Open the folder'),
  });

  // Only the "Open the folder" button opens anything: Esc and a click outside must not.
  if (answer.dismiss === 'cancel') {
    await window.electron.patchOpenWorkPath(getParentPath(first.path));
  }
}
