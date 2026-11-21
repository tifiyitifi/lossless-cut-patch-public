import { useCallback, useEffect, useState } from 'react';

import { defaultMergedNameRule, mergedNamePresets, ruleHasUniqueToken } from '../../../../common/features/patchData/mergedName';

/**
The name dialog in front of the cut-results merge (fork-owned).

It only selects the rule and the overwrite answer; the merge itself stays in `App` (the hook
receives it as `onMerge`), so nothing here touches files. The preview is generated with the same
function the merge uses, so what the dialog shows is the name that will be written.
*/

export interface MergeNamePreview {
  fileName?: string | undefined;
  error?: string | undefined;
}

export interface UsePatchMergeNameOptions {
  /** The dialog belongs to the cutting window's merge action only. */
  enabled: boolean;
  isWorking: () => boolean;
  rule: string;
  setRule: (rule: string) => void;
  labelSeparator: string;
  setLabelSeparator: (separator: string) => void;
  /**
  Resolve the rule against this job (the same call the merge makes).

  `epochMs` is the job's timestamp: the preview and the merge must use the same one, or a rule
  with `{datetime}` or `{epoch_ms}` would preview a name that differs from the file written.
  */
  generatePreview: (rule: string, epochMs: number) => Promise<MergeNamePreview>;
  onMerge: (params: { rule: string; overwrite: boolean; epochMs: number }) => Promise<void>;
}

export default function usePatchMergeName({
  enabled, isWorking, rule, setRule, labelSeparator, setLabelSeparator, generatePreview, onMerge,
}: UsePatchMergeNameOptions) {
  const [isShown, setIsShown] = useState(false);
  const [preview, setPreview] = useState<{
    rule: string;
    epochMs: number;
    fileName?: string | undefined;
    error?: string | undefined;
  }>();
  /** The timestamp of this merge job: the preview and the merge share it (see `generatePreview`). */
  const [epochMs, setEpochMs] = useState(() => Date.now());
  /**
  "May an existing file be replaced?" is a per-merge answer, not the global export setting: the
  export setting is on by default, and reusing it here would replace a file the app does not own
  without the user ever choosing to. It is reset on every opening for the same reason.
  */
  const [overwrite, setOverwrite] = useState(false);

  /** The merge key: ask for a name first, do not merge yet. */
  const request = useCallback(() => {
    if (!enabled || isWorking()) return;
    // A fresh opening must not show the name of an earlier job: the cut list may have changed.
    setPreview(undefined);
    setOverwrite(false);
    setEpochMs(Date.now());
    setIsShown(true);
  }, [enabled, isWorking]);

  const close = useCallback(() => setIsShown(false), []);

  // The preview follows the selected rule; `loading` is derived, so nothing is set while the
  // effect body runs. A result of an earlier rule (or job) is ignored.
  const loading = isShown && (preview?.rule !== rule || preview?.epochMs !== epochMs);
  useEffect(() => {
    if (!isShown) return undefined;
    let cancelled = false;
    generatePreview(rule, epochMs)
      .then((result) => {
        if (!cancelled) setPreview({ rule, epochMs, ...result });
      })
      .catch((err: unknown) => {
        if (!cancelled) setPreview({ rule, epochMs, error: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [isShown, rule, epochMs, generatePreview]);

  const confirm = useCallback(() => {
    setIsShown(false);
    onMerge({ rule, overwrite, epochMs }).catch((err: unknown) => { console.error('Failed to merge the cut results', err); });
  }, [epochMs, onMerge, overwrite, rule]);

  const currentPreview = preview?.rule === rule && preview.epochMs === epochMs ? preview : undefined;

  return {
    request,
    dialogProps: {
      isShown,
      rule,
      setRule,
      defaultRule: defaultMergedNameRule,
      presets: mergedNamePresets,
      labelSeparator,
      setLabelSeparator,
      loading,
      previewFileName: currentPreview?.fileName,
      previewError: currentPreview?.error,
      // A rule with a token that always differs cannot collide; the others can, and then the merge
      // has to be told whether the existing file may be replaced.
      collisionProne: !ruleHasUniqueToken(rule),
      overwrite,
      onOverwriteChange: setOverwrite,
      onClose: close,
      onConfirm: confirm,
    },
  };
}
