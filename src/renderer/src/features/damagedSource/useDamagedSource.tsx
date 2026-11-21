import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import mainApi from '../../mainApi';
import type {
  DamagePlaybackQuality, DamageSettings, SourceDamage, SourceRepairChoice, SourceRepairMenuAction, SourceRepairMenuState,
} from '../../../../common/features/damagedSource';
import { resolveDamagePolicy, sourceRepairMenuChannel } from '../../../../common/features/damagedSource';
import type { ShowGenericDialog } from '../../components/GenericDialog';
import DamagedSourcePrompt from './DamagedSourcePrompt';
import type { DamagePlaybackAnswer } from './DamagedSourcePrompt';

const { ipcRenderer } = window.require('electron');

const noDamage: SourceDamage[] = [];
const noKinds: SourceDamage['kind'][] = [];

/**
Detect a damaged source and ask what to do about it (fork-owned).

The main process probes the file (cheap: one header-only ffprobe for a healthy file) and keeps the
"already asked" memory for the whole run, so the same source opened in another window does not ask
again but still plays the way the user chose.

Repair-or-not is a per-file override of the playback setting, not a new setting: it dies with the
app and the settings panel keeps meaning what it says. The quality is different: it is one answer
for all files, so choosing it here (or from the repair menu, `applyPlaybackChoice`) writes the
setting. That keeps the settings panel honest about what the app will do next time.

The repair has two entry points: the in-app tools menu (this window only) and the native Tools >
Repair menu (one menu for the whole app). The native one cannot hold state, so this hook reports
what the window is looking at and applies the intents that come back.
*/
export default function useDamagedSource({
  patchMode, filePath, settings, canExport, frameRateKnown, showGenericDialog, onQualityChosen, onExportRepairChosen,
}: {
  patchMode: boolean;
  filePath: string | undefined;
  settings: DamageSettings;
  /** Only the cutting window exports; the results windows must not talk about it. */
  canExport: boolean;
  /** False when the source's frame rate could not be read: the full-resolution preview would drift. */
  frameRateKnown: boolean;
  showGenericDialog: ShowGenericDialog;
  /** Store the chosen playback quality as the default for every damaged source. */
  onQualityChosen: (quality: DamagePlaybackQuality) => void;
  /** Store the export repair switch (the same setting the export dialog shows). */
  onExportRepairChosen: (repair: boolean) => void;
}) {
  const [probe, setProbe] = useState<{ path: string, damages: SourceDamage[] } | undefined>(undefined);
  const [override, setOverride] = useState<{ path: string, repair: boolean | undefined } | undefined>(undefined);

  const probedPathRef = useRef<string | undefined>(undefined);
  // Which file the window is on *now*: when the user switches files, `probedPathRef` moves on, so a
  // probe that finishes late can tell it is stale. A ref is used instead of a cleanup flag because
  // StrictMode runs the effect twice, and a flag would throw the first answer away.
  const isCurrent = (path: string) => probedPathRef.current === path;

  const damages = probe != null && probe.path === filePath ? probe.damages : noDamage;
  const sessionOverride = override != null && override.path === filePath ? override.repair : undefined;

  const policy = useMemo(
    () => resolveDamagePolicy({ damages, settings, sessionOverride, frameRateKnown }),
    [damages, frameRateKnown, sessionOverride, settings],
  );

  /**
  The repair menu: repair off, or repairing at one quality. Repair-or-not is remembered for the
  rest of the run (in the main process, so every window agrees); the quality becomes the default.
  */
  const applyPlaybackChoice = useCallback((choice: SourceRepairChoice) => {
    if (filePath == null) return;
    const repair = choice !== 'off';
    setOverride({ path: filePath, repair });
    mainApi.setSourceDamagePlaybackOverride({ path: filePath, repair }).catch((err: unknown) => {
      console.warn('Could not store the playback repair choice', err);
    });
    if (repair) onQualityChosen(choice);
  }, [filePath, onQualityChosen]);

  /** One intent from the native menu, applied to the file this window has open. */
  const applyMenuAction = useCallback((action: SourceRepairMenuAction) => {
    if (action.type === 'playback') applyPlaybackChoice(action.repair ? settings.playbackRepairQuality : 'off');
    else if (action.type === 'quality') applyPlaybackChoice(action.quality);
    else onExportRepairChosen(action.repair);
  }, [applyPlaybackChoice, onExportRepairChosen, settings.playbackRepairQuality]);

  useEffect(() => {
    if (!patchMode) return undefined;
    const onAction = (_event: unknown, action: SourceRepairMenuAction) => applyMenuAction(action);
    ipcRenderer.on(sourceRepairMenuChannel, onAction);
    return () => { ipcRenderer.off(sourceRepairMenuChannel, onAction); };
  }, [applyMenuAction, patchMode]);

  // What the native menu should show. It is one menu for the whole app, so the focused window is the
  // one that describes it: focus is reported again, and the last report wins.
  const menuState = useMemo<SourceRepairMenuState>(() => ({
    hasDamage: damages.length > 0,
    kinds: damages.length > 0 ? damages.map((damage) => damage.kind) : noKinds,
    repair: policy.playbackNeedsTranscode,
    quality: policy.playbackQuality,
    exportRepair: settings.exportRepair,
  }), [damages, policy.playbackNeedsTranscode, policy.playbackQuality, settings.exportRepair]);

  useEffect(() => {
    if (!patchMode) return undefined;

    const report = () => {
      mainApi.setSourceRepairMenuState({ state: filePath == null ? undefined : menuState }).catch((err: unknown) => {
        console.warn('Could not report the repair state to the menu', err);
      });
    };

    report();
    window.addEventListener('focus', report);
    return () => { window.removeEventListener('focus', report); };
  }, [filePath, menuState, patchMode]);

  useEffect(() => {
    if (!patchMode || filePath == null) {
      // The next file must be probed again, even if it is the one that was just closed.
      probedPathRef.current = undefined;
      return;
    }

    if (probedPathRef.current === filePath) return;
    probedPathRef.current = filePath;

    (async () => {
      try {
        const found = await mainApi.probeSourceDamage({ path: filePath });
        if (!isCurrent(filePath)) return;

        if (found.length === 0) {
          setProbe({ path: filePath, damages: [] });
          setOverride(undefined);
          return;
        }

        const claim = await mainApi.claimSourceDamageAsk({ path: filePath });
        if (!isCurrent(filePath)) return;

        setProbe({ path: filePath, damages: found });
        setOverride({ path: filePath, repair: claim.playbackOverride });

        // Already answered in this run (or by another window).
        if (!claim.firstTime) return;

        const answer = await new Promise<DamagePlaybackAnswer | undefined>((resolve) => {
          try {
            showGenericDialog({
              render: () => (
                <DamagedSourcePrompt
                  initialQuality={settings.playbackRepairQuality}
                  exportRepair={settings.exportRepair}
                  canExport={canExport}
                  originalResolutionAvailable={frameRateKnown}
                  onConfirm={resolve}
                />
              ),
              onClose: () => resolve(undefined),
            });
          } catch (err) {
            // Another dialog is open. The settings still apply, so nothing is lost but the question.
            console.warn('Could not ask about the damaged source', err);
            resolve(undefined);
          }
        });

        if (answer == null || !isCurrent(filePath)) return;

        setOverride({ path: filePath, repair: answer.repair });
        await mainApi.setSourceDamagePlaybackOverride({ path: filePath, repair: answer.repair });
        if (answer.repair && answer.quality != null) onQualityChosen(answer.quality);
      } catch (err) {
        // A probe that cannot run says nothing about the file; stay quiet and play it as usual.
        console.warn('Could not probe the source for damage', err);
      }
    })();
  }, [canExport, filePath, frameRateKnown, onQualityChosen, patchMode, settings.exportRepair, settings.playbackRepair, settings.playbackRepairQuality, showGenericDialog]);

  return { policy, hasDamage: damages.length > 0, kinds: menuState.kinds, applyPlaybackChoice };
}
