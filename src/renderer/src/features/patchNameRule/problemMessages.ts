import i18n from 'i18next';

import type { CutNameProblem } from '../../../../common/features/patchData/cutName';
import type { MergedNameProblem } from '../../../../common/features/patchData/mergedName';

/**
The user-facing message for a naming rule that cannot render (fork-owned).

The messages live next to the rule editor rather than in one of the flows that use them: the export
dialog, the merge dialog and the finish dialog all render the same problem codes, and the wording
has to be the same in each (the same rule failed, whatever step asked).
*/

/** The user-facing message for a rule that cannot name the cut results. */
export function cutNameProblemMessage(problem: CutNameProblem) {
  switch (problem.code) {
    case 'emptyRule': {
      return i18n.t('The name rule is empty');
    }
    case 'separator': {
      return i18n.t('The name rule cannot contain a folder separator: {{chars}}', { chars: problem.chars });
    }
    case 'emptyName': {
      return i18n.t('The name rule renders an empty name');
    }
    case 'pathTooLong': {
      return i18n.t('The output path is too long for the file name. Choose a shorter working folder, or shorten the name rule.');
    }
    case 'duplicateNames': {
      return i18n.t('The name rule still names two cut results the same');
    }
    default: {
      return i18n.t('The cut result names cannot be used');
    }
  }
}

/** The user-facing message for a rule that cannot render a file name. */
export function mergedNameProblemMessage(problem: MergedNameProblem) {
  switch (problem.code) {
    case 'emptyRule': {
      return i18n.t('The name rule is empty');
    }
    case 'separator': {
      return i18n.t('The name rule cannot contain a folder separator: {{chars}}', { chars: problem.chars });
    }
    case 'emptyName': {
      return i18n.t('The name rule renders an empty name');
    }
    case 'pathTooLong': {
      return i18n.t('The output path is too long for the file name. Choose a shorter working folder, or shorten the name rule.');
    }
    default: {
      return i18n.t('The merged file name cannot be used');
    }
  }
}
