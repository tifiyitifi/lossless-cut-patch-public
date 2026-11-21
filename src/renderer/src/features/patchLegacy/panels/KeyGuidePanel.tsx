import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { PatchAction } from '../../../../../common/features/patchData';
import { defaultPatchKeyBindings, getPatchKeyLabelForAction } from '../../../../../common/features/patchData';
import { inferPatchFlowStage, patchGuideByStage, patchGuideGroupOrder } from '../../../../../common/features/patchGuide';
import type { PatchFlowStage, PatchGuideCommand, PatchGuideGroup } from '../../../../../common/features/patchGuide';
import { usePatchSession } from '../session/patchSessionContext';

const groupHeaderStyle = {
  opacity: 0.6,
  fontSize: '.78em',
  textTransform: 'uppercase',
  letterSpacing: '.04em',
  marginTop: '.6em',
  marginBottom: '.1em',
} as const;

const keyStyle = {
  minWidth: '3.6em',
  fontFamily: 'monospace',
  opacity: 0.9,
  flexShrink: 0,
} as const;

/** Column 1, row 3: context-aware shortcut guide, inferred from the current flow stage. */
export default function KeyGuidePanel() {
  const { t } = useTranslation();
  const { filePath, cutSegments, exportedPaths } = usePatchSession();

  // Labels are built with literal translation calls so the i18n extractor can find them.
  const stageLabels: Record<PatchFlowStage, string> = {
    'no-file': t('No file'),
    marking: t('Marking'),
    'segment-preview': t('Preview segments'),
    cut: t('Cut segments'),
    'merge-preview': t('Merge preview'),
    merged: t('Merged'),
    finish: t('Done'),
  };

  const stageAdvice: Record<PatchFlowStage, string> = {
    'no-file': t('Pick the work directory and open a video, or import a legacy src txt.'),
    marking: t('Mark the parts you want to keep with I and O, then press E to cut them out.'),
    'segment-preview': t('Check the marked segments (click one to jump to it), then press E to cut.'),
    cut: t('The clips are written next to the source file. Press V to review them.'),
    'merge-preview': t('Play through the predicted merge, then merge it or move on to the next file.'),
    merged: t('The merged file is ready. Then choose what to do with the source file and continue.'),
    finish: t('This file is done — open the next one.'),
  };

  const groupLabels: Record<PatchGuideGroup, string> = {
    mark: t('Cut marking'),
    transport: t('Playback'),
    file: t('File / flow'),
    view: t('Views'),
    ui: t('Interface'),
  };

  const actionLabels: Partial<Record<PatchAction, string>> = {
    'play-pause': t('Play / pause'),
    'seek-back': t('Seek back'),
    'seek-forward': t('Seek forward'),
    'frame-prev': t('Previous frame'),
    'frame-next': t('Next frame'),
    'set-cut-start': t('Set cut start'),
    'set-cut-end': t('Set cut end'),
    'add-segment': t('Add segment'),
    'split-segment': t('Split segment'),
    'remove-segment': t('Remove segment'),
    'prev-segment': t('Previous segment'),
    'next-segment': t('Next segment'),
    'prev-file': t('Previous file'),
    'next-file': t('Next file'),
    'view-candidates': t('Switch view'),
    'view-previous': t('Previous view'),
    snapshot: t('Take snapshot'),
    'toggle-select': t('Toggle segment selected'),
    'play-selected': t('Play selected segments'),
    cut: t('Cut'),
  };

  const commandLabels: Record<PatchGuideCommand, { label: string, hint?: string | undefined }> = {
    'open-file': { label: t('Open file') },
    'import-src-txt': { label: t('Import src txt') },
    'choose-directory': { label: t('Choose directory') },
    console: { label: t('Command console'), hint: ':' },
    palette: { label: t('Command palette'), hint: 'Ctrl+Shift+P' },
    settings: { label: t('Settings'), hint: 'Ctrl+,' },
  };

  const workflow: string[] = [
    t('1. Choose the work directory (top left) and open a video from the list'),
    t('2. Play with Space and mark what to keep with I and O'),
    t('3. Press E to cut (turn on merging in Settings to cut and merge in one step)'),
    t('4. Press V to review the clips and the predicted merge'),
    t('5. Finish the file to run the source post-processing and open the next one'),
  ];

  const stage = useMemo(() => inferPatchFlowStage({
    hasFile: filePath != null,
    hasSegments: cutSegments.some((segment) => !segment.initial),
    hasCutClips: exportedPaths.length > 0,
    mergePreviewActive: false,
    hasMergedOutput: false,
    isFinished: false,
  }), [cutSegments, exportedPaths.length, filePath]);

  const hints = patchGuideByStage[stage];

  return (
    <div style={{ padding: '.6em', height: '100%', boxSizing: 'border-box', overflow: 'auto', fontSize: '.9em' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '.5em' }}>
        <span style={{ fontWeight: 600 }}>{t('Shortcut guide')}</span>
        <span style={{ opacity: 0.6, fontSize: '.9em' }}>{stageLabels[stage]}</span>
      </div>
      <div style={{ margin: '.3em 0 .2em', lineHeight: 1.35 }}>{stageAdvice[stage]}</div>

      {patchGuideGroupOrder.map((group) => {
        const entries = hints.filter((hint) => hint.group === group);
        if (entries.length === 0) return null;
        return (
          <div key={group}>
            <div style={groupHeaderStyle}>{groupLabels[group]}</div>
            {entries.map((hint) => {
              const keyLabel = hint.action != null
                ? getPatchKeyLabelForAction(defaultPatchKeyBindings, hint.action)
                : commandLabels[hint.command ?? 'open-file'].hint;
              const label = hint.action != null
                ? actionLabels[hint.action]
                : commandLabels[hint.command ?? 'open-file'].label;
              return (
                <div key={hint.action ?? hint.command} style={{ display: 'flex', alignItems: 'baseline', gap: '.5em', padding: '.12em 0' }}>
                  <kbd style={keyStyle}>{keyLabel ?? '—'}</kbd>
                  <span>{label}</span>
                </div>
              );
            })}
          </div>
        );
      })}

      <div style={groupHeaderStyle}>{t('Workflow')}</div>
      <ol style={{ margin: 0, paddingLeft: '1.2em', lineHeight: 1.4 }}>
        {workflow.map((step) => <li key={step}>{step}</li>)}
      </ol>
    </div>
  );
}
