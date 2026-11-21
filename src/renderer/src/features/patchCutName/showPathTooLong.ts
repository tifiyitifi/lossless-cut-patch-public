import i18n from 'i18next';

import getSwal from '../../swal';

/**
The blocking error for a name that does not fit the output folder (fork-owned).

A cut or merged name that would have to be shortened is refused instead: the export stops while
the options sheet stays open, so the user can shorten the working folder or the rule. A toast
would be gone before they could act on it, hence the modal.
*/
export default async function showPathTooLong() {
  await getSwal().Swal.fire({
    icon: 'error',
    text: i18n.t('The output path is too long for the file name. Choose a shorter working folder, or shorten the name rule.'),
  });
}
