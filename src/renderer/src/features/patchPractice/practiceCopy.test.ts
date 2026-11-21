// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';

import { guideRelatedActions, practiceGuides } from '../../../../common/features/patchPractice';
import { buildActionLabels, buildGuideCopy } from './practiceCopy';

// The panel only needs the keys back, so the identity function is enough here.
const t = ((key: string) => key) as unknown as TFunction;

describe('practiceCopy', () => {
  it('labels every shortcut the panel can list, so none of them renders as a raw action id', () => {
    const labels = buildActionLabels(t);
    for (const guide of practiceGuides) {
      for (const action of guideRelatedActions(guide)) {
        expect(labels[action], `${guide.id} lists ${action}`).toBeDefined();
      }
    }
  });

  it('has a title and a body for every guide', () => {
    const copy = buildGuideCopy(t);
    for (const guide of practiceGuides) {
      expect(copy[guide.id], guide.id).toBeDefined();
    }
  });
});
