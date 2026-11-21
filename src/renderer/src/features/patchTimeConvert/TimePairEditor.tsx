import type { CSSProperties } from 'react';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { TimePairParseError } from '../../../../common/features/patchTimeConvert';
import { describeTimePairError } from './errorMessages';

/**
The cut point editor of the time converter (fork-owned).

A plain textarea cannot colour a single line, so the text is drawn twice: a backdrop with the same
font, size, line height, padding and `tab-size`, whose text is transparent, and the real textarea on
top with a transparent background. The backdrop paints the row of every broken line and appends the
problem right after that row's text, which is why lines must not wrap: one text line is one visual
line, and the note stays attached to the line it explains. Long lines scroll horizontally (in both
layers, kept in sync) instead of wrapping.

The note is drawn by the backdrop, so it is visible through the textarea but is not part of the
text: the textarea only carries the user's text and a note can never be typed over.
*/
export default function TimePairEditor({ value, onChange, errors, maxLabelLength }: {
  value: string;
  onChange: (value: string) => void;
  errors: readonly TimePairParseError[];
  /** The cut list's label limit, so the message can name it. */
  maxLabelLength: number;
}) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // One entry per line, with its character offset: the offset is unique per line, so it doubles as
  // the React key without keying on the array index.
  const lineEntries = useMemo(() => {
    const lines = value.split('\n');
    return lines.map((line, index) => ({
      line,
      offset: lines.slice(0, index).reduce((sum, previous) => sum + previous.length + 1, 0),
    }));
  }, [value]);

  // One note per line: the parser reports the first problem of a line and moves on.
  const errorByLine = useMemo(() => {
    const map = new Map<number, TimePairParseError>();
    for (const error of errors) {
      if (!map.has(error.lineNumber)) map.set(error.lineNumber, error);
    }
    return map;
  }, [errors]);

  const syncScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const backdrop = backdropRef.current;
    if (textarea == null || backdrop == null) return;
    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
  }, []);

  // Both layers must lay the text out identically, or the notes drift away from their line.
  const textStyle: CSSProperties = {
    fontFamily: 'monospace',
    fontSize: '.78em',
    lineHeight: 1.5,
    padding: '.45em .55em',
    whiteSpace: 'pre',
    tabSize: 4,
  };

  return (
    <div style={{ position: 'relative', border: '1px solid var(--gray-7)', borderRadius: '.4em', backgroundColor: 'var(--gray-3)', overflow: 'hidden' }}>
      <div
        ref={backdropRef}
        aria-hidden
        style={{ ...textStyle, position: 'absolute', inset: 0, overflow: 'hidden', color: 'transparent', pointerEvents: 'none' }}
      >
        {lineEntries.map(({ line, offset }, index) => {
          const error = errorByLine.get(index + 1);
          return (
            <div key={offset} style={error != null ? { backgroundColor: 'rgba(220, 38, 38, .12)' } : undefined}>
              {/* The transparent copy: it gives the row its height and the note its position. */}
              {line === '' ? ' ' : line}
              {error != null && (
                <span style={{ color: 'var(--red-11)' }}>
                  {`  ← ${describeTimePairError((key, options) => (options == null ? t(key) : t(key, options)), error, maxLabelLength)}`}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        wrap="off"
        style={{
          ...textStyle,
          position: 'relative',
          display: 'block',
          boxSizing: 'border-box',
          width: '100%',
          height: '11em',
          resize: 'vertical',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--gray-12)',
          caretColor: 'var(--gray-12)',
          overflow: 'auto',
        }}
      />
    </div>
  );
}
