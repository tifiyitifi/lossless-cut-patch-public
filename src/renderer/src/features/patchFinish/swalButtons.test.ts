// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { primaryColor } from '../../colors';
import withNonDestructiveDeny from './swalButtons';

describe('withNonDestructiveDeny', () => {
  it('paints the deny button with the confirm button colour', () => {
    const options = withNonDestructiveDeny({ showDenyButton: true, denyButtonText: 'Open the merged result folder' });
    // Red is the destructive "do it anyway" colour; a harmless second action must not use it.
    expect(options.denyButtonColor).toBe(primaryColor);
  });

  it('keeps the rest of the dialog as it was', () => {
    const didOpen = () => undefined;
    const options = withNonDestructiveDeny({ showDenyButton: true, text: 'some text', didOpen });
    expect(options.showDenyButton).toBe(true);
    expect(options.text).toBe('some text');
    expect(options.didOpen).toBe(didOpen);
  });
});
