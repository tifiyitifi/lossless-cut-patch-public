// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { splitRelativeTimecodeInput } from './relativeInput.js';

describe('splitRelativeTimecodeInput', () => {
  it('reads the sign of a relative seek', () => {
    expect(splitRelativeTimecodeInput({ value: '+12.5', allowRelative: true })).toStrictEqual({ text: '12.5', relDirection: 1 });
    expect(splitRelativeTimecodeInput({ value: '-12.5', allowRelative: true })).toStrictEqual({ text: '12.5', relDirection: -1 });
  });

  it('leaves an absolute value alone', () => {
    expect(splitRelativeTimecodeInput({ value: '12.5', allowRelative: true })).toStrictEqual({ text: '12.5', relDirection: undefined });
    expect(splitRelativeTimecodeInput({ value: '..1.2.3', allowRelative: true })).toStrictEqual({ text: '..1.2.3', relDirection: undefined });
  });

  it('keeps the sign of a pasted value with surrounding whitespace', () => {
    // The compact parser strips whitespace, but the sign check happens first: with the space kept the
    // prefix is missed and a valid `..` time is reported as invalid.
    expect(splitRelativeTimecodeInput({ value: ' +..1.2.3 ', allowRelative: true })).toStrictEqual({ text: '..1.2.3', relDirection: 1 });
    expect(splitRelativeTimecodeInput({ value: '\t-30', allowRelative: true })).toStrictEqual({ text: '30', relDirection: -1 });
  });

  it('trims even when relative seeking is off', () => {
    expect(splitRelativeTimecodeInput({ value: ' 12.5 ', allowRelative: false })).toStrictEqual({ text: '12.5', relDirection: undefined });
  });

  it('ignores the sign when the dialog does not offer relative seeking', () => {
    expect(splitRelativeTimecodeInput({ value: '+12.5', allowRelative: false })).toStrictEqual({ text: '+12.5', relDirection: undefined });
  });

  it('has nothing left to parse for a bare sign', () => {
    expect(splitRelativeTimecodeInput({ value: '-', allowRelative: true })).toStrictEqual({ text: '', relDirection: -1 });
  });
});
