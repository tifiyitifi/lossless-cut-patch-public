import { useMemo } from 'react';

import type { PatchAction } from '../../../../../common/features/patchData';
import { usePatchSession } from '../session/patchSessionContext';
import { usePatchUi } from '../ui/patchUiContext';

export type PatchActionHandlers = Partial<Record<PatchAction, () => void>>;

/**
 * The single source of truth for "action id → what it does".
 *
 * Consumed by the global keyboard layer, the command console and the command palette so the three
 * never drift apart. Segment marking is only enabled on the `source` view: the clip views are for
 * reviewing the cut result, and marking there would write clip-relative times into the source data.
 */
export default function usePatchActions(): PatchActionHandlers {
  const {
    togglePlay, toggleFullscreen, toggleMute,
    seekRel, adjustVolume, frameStep, adjustPlaybackRate, setPlaybackRate,
    setCutStart, setCutEnd, splitCurrentSegment, addSegment, removeCurrentSegment, jumpSegment,
    cut, openRelativeFile, playerView, viewSwitchStyle, stepPlayerView, autoMerge, cutAndMerge,
    captureSnapshot, captureSnapshotToClipboard,
    toggleCurrentSegmentSelected, selectAllSegments, deselectAllSegments, invertSelectedSegments,
    togglePlaySelectedSegments,
  } = usePatchSession();
  const { openViewOverlay } = usePatchUi();

  return useMemo<PatchActionHandlers>(() => {
    const canMark = playerView === 'source';
    const mark = (run: () => void) => () => {
      if (canMark) run();
    };

    return {
      'play-pause': togglePlay,
      fullscreen: toggleFullscreen,
      mute: toggleMute,
      'seek-back': () => seekRel(-5),
      'seek-forward': () => seekRel(5),
      'volume-up': () => adjustVolume(0.05),
      'volume-down': () => adjustVolume(-0.05),
      'frame-next': () => frameStep(1),
      'frame-prev': () => frameStep(-1),
      'rate-down': () => adjustPlaybackRate(-0.25),
      'rate-up': () => adjustPlaybackRate(0.25),
      'rate-reset': () => setPlaybackRate(1),
      'set-cut-start': mark(setCutStart),
      'set-cut-end': mark(setCutEnd),
      'split-segment': mark(splitCurrentSegment),
      'add-segment': mark(addSegment),
      'remove-segment': mark(removeCurrentSegment),
      'prev-segment': () => jumpSegment(-1),
      'next-segment': () => jumpSegment(1),
      // Selection state is view-independent; playing the selection seeks, so it stays source-only.
      'toggle-select': toggleCurrentSegmentSelected,
      'select-all-segments': selectAllSegments,
      'clear-selection': deselectAllSegments,
      'invert-selection': invertSelectedSegments,
      'play-selected': mark(togglePlaySelectedSegments),
      'prev-file': () => openRelativeFile(-1),
      'next-file': () => openRelativeFile(1),
      'view-candidates': () => {
        if (viewSwitchStyle === 'cycle') stepPlayerView(1);
        else openViewOverlay();
      },
      'view-previous': () => stepPlayerView(-1),
      // Snapshots only make sense on the source view (the tag capture reads the source element).
      snapshot: mark(() => {
        captureSnapshot().catch((err: unknown) => { console.error(err); });
      }),
      'snapshot-clipboard': mark(() => {
        captureSnapshotToClipboard().catch((err: unknown) => { console.error(err); });
      }),
      // With `autoMerge` the cut key also merges the produced clips (one file instead of N).
      cut: () => {
        const run = autoMerge ? cutAndMerge() : cut();
        run.catch((err: unknown) => { console.error(err); });
      },
    };
  }, [addSegment, adjustPlaybackRate, adjustVolume, autoMerge, captureSnapshot, captureSnapshotToClipboard, cut, cutAndMerge, deselectAllSegments, frameStep, invertSelectedSegments, jumpSegment, openRelativeFile, openViewOverlay, playerView, removeCurrentSegment, seekRel, selectAllSegments, setCutEnd, setCutStart, setPlaybackRate, splitCurrentSegment, stepPlayerView, toggleCurrentSegmentSelected, toggleFullscreen, toggleMute, togglePlay, togglePlaySelectedSegments, viewSwitchStyle]);
}
