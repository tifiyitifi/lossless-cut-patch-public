/* eslint-disable import/prefer-default-export */
import type { SourceDamageKind } from './types.js';
import { sourceDamageMissingCompositionOffsets } from './types.js';

/**
The words for one repair (fork-owned).

They are here rather than in the registry because translation keys are literal English sentences
that `yarn scan-i18n` has to find inside a `t()` call; a string kept as data in the registry would
never reach the translation files. `t` is passed in so both processes can use this: the main
process builds the native menu, the renderer builds the in-app one.
*/
export function getSourceRepairCopy(kind: SourceDamageKind, t: (key: string) => string) {
  switch (kind) {
    case sourceDamageMissingCompositionOffsets: {
      return {
        title: t('Missing composition time offsets (ctts)'),
        symptom: t('The frames are stored out of order, so the picture jumps back a frame.'),
      };
    }
    default: {
      // A kind without words would show up as a blank menu row; fail loudly in development instead.
      const exhaustive: never = kind;
      throw new Error(`No copy is declared for source damage kind ${String(exhaustive)}`);
    }
  }
}
