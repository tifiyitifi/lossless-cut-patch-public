import type { PatchDetachableSourceReason } from '../../../../common/features/patchDeletable/deletable';
import type { PatchOverviewResultFolder } from '../../../../common/features/patchResultsOverview/groupResults';

/**
The state lines of a deletion-check card (fork-owned).

They live outside the card because the deletion settings dialog lists the same kinds of sources it
lets the user delete: one wording, one set of translation keys.
*/

/** A result card's folder line. */
export function resultFolderLabel(folder: PatchOverviewResultFolder | undefined, t: (key: string) => string) {
  switch (folder) {
    case 'finishedClips': { return t('Cut result'); }
    case 'finishedMerged': { return t('Merged result'); }
    case 'detachedClips': { return t('Temporary clip, waiting for deletion'); }
    default: { return t('Merged result, waiting for deletion'); }
  }
}

/** A source card's reason line (also the label of the deletion settings' checkboxes). */
export function sourceReasonLabel(reason: PatchDetachableSourceReason, t: (key: string) => string) {
  switch (reason) {
    case 'deletable': { return t('Finished: a kept result is on disk'); }
    case 'parked-only': { return t('Only results waiting for deletion'); }
    case 'results-missing': { return t('Recorded results are gone from disk'); }
    case 'no-results': { return t('No result at all'); }
    default: { return t('Not in the waiting-for-deletion folder'); }
  }
}
