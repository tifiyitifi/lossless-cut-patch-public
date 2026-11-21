import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { FaUndo } from 'react-icons/fa';

import type { CutNamePresetId } from '../../../../common/features/patchData/cutName';
import { cutNameTokens } from '../../../../common/features/patchData/cutName';
import type { MergedNamePresetId } from '../../../../common/features/patchData/mergedName';
import { labelSeparatorOptions, mergedNameTokens, ruleUsesToken } from '../../../../common/features/patchData/mergedName';

import Select from '../../components/Select';
import TextInput from '../../components/TextInput';
import { warningColor } from '../../colors';

/**
Editor for a `{token}` naming rule (fork-owned).

The same component edits both patch rules: the merged result's (`common/features/patchData/
mergedName`) and the cut results' (`.../cutName`). They share the syntax (an input, chips that
insert a token at the caret, preset chips, a label separator and a preview), so only the token
list, the presets and the wording differ - `mode` picks those. The export dialog and the merge
dialog use it, so both show the name the job will really write.
*/

export interface NameRulePreset {
  id: string;
  rule: string;
}

export interface NameRuleEditorProps {
  /** Which rule set is edited: the merged result or the single cut results. */
  mode: 'merge' | 'cut';
  rule: string;
  setRule: (rule: string) => void;
  defaultRule: string;
  presets: readonly NameRulePreset[];
  labelSeparator: string;
  setLabelSeparator: (separator: string) => void;
  /** The name the rule renders for this job (merge mode, and cut mode with one clip). */
  previewFileName?: string | undefined;
  /** The names of a whole cut export (cut mode): each result gets its own. */
  previewLines?: readonly string[] | undefined;
  /** A warning about the names above (cut mode: a name had to get the number + time suffix). */
  previewWarning?: string | undefined;
  previewError?: string | undefined;
  loading: boolean;
  /** The rule renders the same name each time (no token that always differs). */
  collisionProne: boolean;
}

function cutPresetLabel(t: TFunction, id: CutNamePresetId | string) {
  switch (id) {
    case 'finish': {
      return t('Source, clip and number');
    }
    case 'default': {
      return t('Source, number, label and cut times');
    }
    case 'label': {
      return t('Source and label');
    }
    case 'timecode': {
      return t('Source, label and start time');
    }
    case 'number': {
      return t('Source and number');
    }
    case 'stamp': {
      return t('Source, label and time');
    }
    default: {
      return id;
    }
  }
}

function mergedPresetLabel(t: TFunction, id: MergedNamePresetId | string) {
  switch (id) {
    case 'default': {
      return t('Source, labels and merge');
    }
    case 'labels': {
      return t('Source and labels');
    }
    case 'datetime': {
      return t('Date and time');
    }
    case 'date': {
      return t('Date only');
    }
    case 'plain': {
      return t('Source only');
    }
    default: {
      return id;
    }
  }
}

function mergedTokenDescription(t: TFunction, name: string) {
  switch (name) {
    case 'source': {
      return t('The source file name, without its extension');
    }
    case 'source_folder': {
      return t('The folder the source file is in');
    }
    case 'labels': {
      return t('The labels of the merged clips, joined with the separator');
    }
    case 'label': {
      return t('The label, when exactly one merged clip has one');
    }
    case 'count': {
      return t('The number of merged clips');
    }
    case 'date': {
      return t('The local date');
    }
    case 'time': {
      return t('The local time');
    }
    case 'datetime': {
      return t('The local date and time, with milliseconds');
    }
    case 'epoch_ms': {
      return t('The number of milliseconds since 1970');
    }
    case 'export_count': {
      return t('The export counter');
    }
    default: {
      return '';
    }
  }
}

function cutTokenDescription(t: TFunction, name: string) {
  switch (name) {
    case 'source': {
      return t('The source file name, without its extension');
    }
    case 'source_folder': {
      return t('The folder the source file is in');
    }
    case 'label': {
      return t('The label of this cut result');
    }
    case 'labels': {
      return t('The labels of all cut results of this export, joined with the separator');
    }
    case 'seg_num': {
      return t('The position of this cut result in the export, zero padded');
    }
    case 'count': {
      return t('The number of cut results in this export');
    }
    case 'cut_from': {
      return t('The start time of this cut result');
    }
    case 'cut_to': {
      return t('The end time of this cut result');
    }
    case 'date': {
      return t('The local date');
    }
    case 'time': {
      return t('The local time');
    }
    case 'datetime': {
      return t('The local date and time, with milliseconds');
    }
    case 'epoch_ms': {
      return t('The number of milliseconds since 1970');
    }
    case 'export_count': {
      return t('The export counter');
    }
    default: {
      return '';
    }
  }
}

const formatToken = (name: string) => `{${name}}`;

export default function NameRuleEditor({
  mode, rule, setRule, defaultRule, presets, labelSeparator, setLabelSeparator,
  previewFileName, previewLines, previewWarning, previewError, loading, collisionProne,
}: NameRuleEditorProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const tokens = mode === 'cut' ? cutNameTokens : mergedNameTokens;
  const describeToken = mode === 'cut' ? cutTokenDescription : mergedTokenDescription;
  const presetLabel = mode === 'cut' ? cutPresetLabel : mergedPresetLabel;

  // Insert at the caret (a click on a chip must not lose the position in the rule).
  const insertToken = useCallback((name: string) => {
    const token = formatToken(name);
    const input = inputRef.current;
    if (input == null) {
      setRule(`${rule}${token}`);
      return;
    }
    const start = input.selectionStart ?? rule.length;
    const end = input.selectionEnd ?? start;
    const next = `${rule.slice(0, start)}${token}${rule.slice(end)}`;
    setRule(next);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
    });
  }, [rule, setRule]);

  // An escaped `{{labels}}` is literal text, so it does not use the label separator.
  const usesLabels = ruleUsesToken(rule, 'labels');

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4em' }}>
        {presets.map((preset) => {
          const selected = preset.rule === rule;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setRule(preset.rule)}
              style={{
                padding: '.35em .8em',
                borderRadius: '1em',
                cursor: 'pointer',
                border: `1px solid ${selected ? 'var(--cyan-9)' : 'var(--gray-7)'}`,
                background: selected ? 'var(--cyan-3)' : 'var(--gray-2)',
                color: selected ? 'var(--cyan-11)' : 'var(--gray-12)',
                fontWeight: selected ? 'bold' : 'normal',
              }}
            >
              {presetLabel(t, preset.id)}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: '.8em', fontSize: '.9em', color: 'var(--gray-11)' }}>{t('Name rule')}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.4em', marginTop: '.2em' }}>
        <TextInput
          ref={inputRef}
          value={rule}
          onChange={(e) => setRule(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          style={{ padding: '.3em' }}
        />
        <button
          type="button"
          onClick={() => setRule(defaultRule)}
          title={t('Reset')}
          style={{ padding: '.35em .6em', cursor: 'pointer' }}
        >
          <FaUndo style={{ fontSize: '.8em', color: 'var(--red-9)', marginRight: '.4em' }} />
          {t('Reset')}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '.3em', flexWrap: 'wrap', alignItems: 'center', marginTop: '.5em', fontSize: '.9em' }}>
        <span style={{ color: 'var(--gray-11)' }}>{t('Tokens')}:</span>
        {tokens.map((token) => (
          <button
            key={token.name}
            type="button"
            title={describeToken(t, token.name)}
            onClick={() => insertToken(token.name)}
            style={{
              padding: '.15em .45em',
              cursor: 'copy',
              borderRadius: '.3em',
              border: '1px dashed var(--gray-7)',
              background: 'transparent',
              color: 'var(--gray-11)',
              fontFamily: 'monospace',
            }}
          >
            {formatToken(token.name)}
          </button>
        ))}
      </div>

      {usesLabels && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4em', marginTop: '.5em', fontSize: '.9em' }}>
          <span style={{ color: 'var(--gray-11)' }}>{t('Join labels with')}</span>
          <Select
            value={labelSeparator}
            onChange={(e) => setLabelSeparator(e.target.value)}
            style={{ padding: '.15em .3em' }}
          >
            {labelSeparatorOptions.map((separator) => (
              <option key={separator} value={separator}>{separator}</option>
            ))}
          </Select>
        </div>
      )}

      <div style={{ marginTop: '.7em', fontSize: '.9em' }}>
        <div style={{ color: 'var(--gray-11)' }}>{t('Preview')}</div>
        {previewLines != null && previewLines.length > 0 ? (
          <div style={{ wordBreak: 'break-all', maxHeight: '7em', overflowY: 'auto' }}>
            {previewLines.map((name, index) => (
              // eslint-disable-next-line react/no-array-index-key -- the list is positional, names may repeat
              <div key={index}><code>{name}</code></div>
            ))}
          </div>
        ) : (
          <div style={{ wordBreak: 'break-all' }}>
            {previewError != null
              ? <span style={{ color: 'var(--red-11)' }}>{previewError}</span>
              : <code>{loading ? t('Reading the file name...') : (previewFileName ?? '')}</code>}
          </div>
        )}
      </div>

      {previewWarning != null && (
        <div style={{ marginTop: '.3em', fontSize: '.85em', color: warningColor }}>{previewWarning}</div>
      )}

      {collisionProne && (
        <div style={{ marginTop: '.4em', fontSize: '.85em', color: warningColor }}>
          {t(mode === 'cut' ? 'This rule can give two cut results the same name. The position in the export and the time are appended when that happens.' : 'This rule renders the same name each time. An existing file is replaced only when you allow it.')}
        </div>
      )}

      <details style={{ marginTop: '.7em', fontSize: '.85em', color: 'var(--gray-11)' }}>
        <summary style={{ cursor: 'pointer' }}>{t('How the name rule works')}</summary>
        <ul style={{ margin: '.4em 0 0', paddingLeft: '1.2em' }}>
          {tokens.map((token) => (
            <li key={token.name}>
              <code>{formatToken(token.name)}</code> {describeToken(t, token.name)}
              {token.mayEmpty ? <span> {t('(may be empty)')}</span> : null}
            </li>
          ))}
        </ul>
        <div style={{ marginTop: '.4em' }}>
          {t('A token in square brackets disappears together with the text around it when the token is empty. Example: [ - {labels}]')}
        </div>
        <div style={{ marginTop: '.2em' }}>
          {t(mode === 'cut' ? 'The extension is added automatically. Every cut result is one file, so the rule cannot contain a folder separator.' : 'The extension is added automatically. The merged result is one file, so the rule cannot contain a folder separator.')}
        </div>
        <div style={{ marginTop: '.2em' }}>
          {t('A doubled brace writes a literal token: {{source}}. Unknown tokens are written as they are.')}
        </div>
        {mode === 'cut' && (
          <div style={{ marginTop: '.2em' }}>
            {t('When two cut results would get the same name, both get the position in the export and the time appended, so neither overwrites the other.')}
          </div>
        )}
      </details>
    </>
  );
}
