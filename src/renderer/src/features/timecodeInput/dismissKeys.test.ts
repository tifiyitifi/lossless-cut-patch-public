// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import { isTimecodeDialogDismissEvent } from './dismissKeys';

function keyEvent(code: string, modifiers: Partial<{ ctrlKey: boolean, shiftKey: boolean, altKey: boolean, metaKey: boolean, repeat: boolean, isComposing: boolean }> = {}) {
  return {
    code,
    ctrlKey: modifiers.ctrlKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
    altKey: modifiers.altKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    repeat: modifiers.repeat ?? false,
    isComposing: modifiers.isComposing ?? false,
  };
}

const dismissKeys = ['KeyG', 'NumpadDivide'];

describe('isTimecodeDialogDismissEvent', () => {
  it('closes on every key bound to the action, so both G and the keypad / toggle', () => {
    expect(isTimecodeDialogDismissEvent(keyEvent('KeyG'), dismissKeys)).toBe(true);
    expect(isTimecodeDialogDismissEvent(keyEvent('NumpadDivide'), dismissKeys)).toBe(true);
  });

  it('ignores a key that is not bound to the action', () => {
    expect(isTimecodeDialogDismissEvent(keyEvent('KeyL'), dismissKeys)).toBe(false);
  });

  it('ignores the repeat of a held key', () => {
    // Otherwise opening the dialog with a held key would close it again immediately.
    expect(isTimecodeDialogDismissEvent(keyEvent('NumpadDivide', { repeat: true }), dismissKeys)).toBe(false);
  });

  it('never takes a key the timecode field needs, even when the action is bound to it', () => {
    const digitKeys = ['Digit1', 'Numpad1', 'Period', 'NumpadDecimal', 'Comma', 'Minus', 'NumpadSubtract', 'Equal', 'NumpadAdd', 'Semicolon', 'Backspace'];
    for (const code of digitKeys) {
      expect(isTimecodeDialogDismissEvent(keyEvent(code), [code])).toBe(false);
    }
  });

  it('closes even while an IME is composing', () => {
    // Chromium flags every keydown with `isComposing` while an input method is on, whatever the
    // focus is. Honouring it turned the bound keys into typing (the dialog could not be closed at
    // all), so the flag is ignored: no timecode character is an IME composition.
    expect(isTimecodeDialogDismissEvent(keyEvent('KeyG', { isComposing: true }), dismissKeys)).toBe(true);
    expect(isTimecodeDialogDismissEvent(keyEvent('NumpadDivide', { isComposing: true }), dismissKeys)).toBe(true);
  });

  it('needs the exact modifiers of the binding', () => {
    expect(isTimecodeDialogDismissEvent(keyEvent('KeyG', { shiftKey: true }), dismissKeys)).toBe(false);
    expect(isTimecodeDialogDismissEvent(keyEvent('KeyG', { shiftKey: true }), ['ShiftLeft+KeyG'])).toBe(true);
  });

  it('reads a real KeyboardEvent, whose fields live on the prototype', () => {
    // A real `KeyboardEvent` keeps `code`, `ctrlKey`, ... behind prototype getters, so
    // `{ ...event }` yields an object without any of them. The matcher must read the
    // properties instead of spreading: this event has no own properties at all.
    const eventProto = {
      get code() { return 'KeyG'; },
      get ctrlKey() { return false; },
      get shiftKey() { return false; },
      get altKey() { return false; },
      get metaKey() { return false; },
      get repeat() { return false; },
    };
    const event = Object.create(eventProto) as KeyboardEvent;
    expect(Object.keys(event)).toStrictEqual([]);
    expect(isTimecodeDialogDismissEvent(event, dismissKeys)).toBe(true);
  });
});
