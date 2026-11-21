import type { KeyboardAction } from '../../types.js';

/**
Keyboard practice mode: the local guides (pure data).

Practice mode splits every bound key into small "local guides". Pressing a key that belongs to a
guide opens that guide's notes instead of running the action, so the user learns what a key does
(and which keys are related) before it takes effect.

Two invariants keep the behaviour predictable:
- `triggers` are unique across guides: an action belongs to at most one guide, so "the current
  guide" is always well defined (see `practiceMode.ts`).
- `related` is deliberately allowed to repeat across guides: the same shortcut may be referenced
  from several guides (that is the point of the feature).

The panel lists the guide's own `triggers` together with the curated `related` links (see
`guideRelatedActions`), so every bound key the guide owns shows up on its card. Actions without a
key are filtered out by the panel.

Display text lives in the renderer (`features/patchPractice/practiceCopy.ts`), keyed by `id`.
*/
export interface PracticeGuide {
  /** Stable id, also the key into the renderer's copy table. */
  id: string;
  /** Base actions that belong to this guide. An action may trigger at most one guide. */
  triggers: readonly KeyboardAction[];
  /** Base actions listed as "related" links. May repeat across guides on purpose. */
  related: readonly KeyboardAction[];
}

/** `toggleKeyboardShortcuts` is referenced by every guide so the full reference is always one key away. */
export const practiceGuides = [
  {
    // Play/pause and the arrow-key seek live in one guide: they are the same transport workflow.
    id: 'transport',
    triggers: ['togglePlayResetSpeed', 'togglePlayNoResetSpeed', 'play', 'pause', 'seekBackwards', 'seekBackwards2', 'seekBackwards3', 'seekBackwardsPercent', 'seekBackwardsKeyframe', 'seekForwards', 'seekForwards2', 'seekForwards3', 'seekForwardsPercent', 'seekForwardsKeyframe', 'jumpTimelineStart', 'jumpTimelineEnd', 'goToTimecode', 'toggleFullscreenVideo'],
    related: ['togglePlayNoResetSpeed', 'increasePlaybackRate', 'reducePlaybackRate', 'seekBackwards', 'seekForwards', 'seekBackwardsPercent', 'seekForwardsPercent', 'seekBackwards2', 'seekForwards2', 'seekBackwardsKeyframe', 'seekForwardsKeyframe', 'jumpCutStart', 'jumpCutEnd', 'seekPreviousFrame', 'seekNextFrame', 'jumpPrevSegment', 'jumpNextSegment', 'jumpTimelineStart', 'jumpTimelineEnd', 'timelineZoomIn', 'timelineZoomOut', 'goToTimecode', 'toggleFullscreenVideo', 'toggleKeyboardShortcuts'],
  },
  {
    id: 'speed',
    triggers: ['increasePlaybackRate', 'reducePlaybackRate', 'increasePlaybackRateMore', 'reducePlaybackRateMore', 'resetPlaybackRate', 'togglePlaybackRate'],
    related: ['increasePlaybackRate', 'reducePlaybackRate', 'increasePlaybackRateMore', 'reducePlaybackRateMore', 'resetPlaybackRate', 'togglePlaybackRate', 'togglePlayNoResetSpeed', 'toggleKeyboardShortcuts'],
  },
  {
    id: 'frame-step',
    triggers: ['seekPreviousFrame', 'seekNextFrame'],
    related: ['seekPreviousFrame', 'seekNextFrame', 'seekBackwardsKeyframe', 'seekForwardsKeyframe', 'setCutStart', 'setCutEnd', 'toggleKeyboardShortcuts'],
  },
  {
    id: 'zoom',
    triggers: ['timelineZoomIn', 'timelineZoomOut', 'timelineToggleComfortZoom'],
    related: ['timelineZoomIn', 'timelineZoomOut', 'timelineToggleComfortZoom', 'toggleKeyboardShortcuts'],
  },
  {
    id: 'volume',
    triggers: ['increaseVolume', 'decreaseVolume', 'toggleMuted'],
    related: ['increaseVolume', 'decreaseVolume', 'toggleMuted', 'toggleKeyboardShortcuts'],
  },
  {
    id: 'cutpoints',
    triggers: ['setCutStart', 'setCutEnd', 'removeCurrentCutpoint', 'addSegment', 'splitCurrentSegment', 'removeCurrentSegment', 'toggleKeyframeCutMode', 'jumpCutStart', 'jumpCutEnd'],
    related: ['setCutStart', 'setCutEnd', 'addSegment', 'splitCurrentSegment', 'removeCurrentSegment', 'removeCurrentCutpoint', 'toggleKeyframeCutMode', 'jumpCutStart', 'jumpCutEnd', 'toggleKeyboardShortcuts'],
  },
  {
    id: 'segment-nav',
    triggers: ['jumpPrevSegment', 'jumpNextSegment', 'jumpFirstSegment', 'jumpLastSegment', 'jumpSeekPrevSegment', 'jumpSeekNextSegment', 'jumpSeekFirstSegment', 'jumpSeekLastSegment', 'jumpSegmentEndPreview', 'focusSegmentAtCursor'],
    related: ['jumpPrevSegment', 'jumpNextSegment', 'jumpFirstSegment', 'jumpLastSegment', 'jumpSeekPrevSegment', 'jumpSeekNextSegment', 'jumpSeekFirstSegment', 'jumpSeekLastSegment', 'jumpSegmentEndPreview', 'focusSegmentAtCursor', 'toggleKeyboardShortcuts'],
  },
  {
    id: 'segment-select',
    triggers: ['toggleCurrentSegmentSelected', 'selectOnlyCurrentSegment', 'selectAllSegments', 'deselectAllSegments', 'invertSelectedSegments', 'selectSegmentsAtCursor', 'removeSelectedSegments', 'combineSelectedSegments', 'selectAllMarkers', 'selectSegmentsByLabel', 'selectSegmentsByExpr', 'labelSelectedSegments', 'labelCurrentSegment', 'editCurrentSegmentTags', 'mutateSegmentsByExpr'],
    related: ['toggleCurrentSegmentSelected', 'selectAllSegments', 'deselectAllSegments', 'invertSelectedSegments', 'removeSelectedSegments', 'combineSelectedSegments', 'selectSegmentsAtCursor', 'labelCurrentSegment', 'toggleKeyboardShortcuts'],
  },
  {
    id: 'segment-generate',
    triggers: ['detectBlackScenes', 'detectSilentScenes', 'detectSceneChanges', 'createSegmentsFromKeyframes', 'createFixedDurationSegments', 'createNumSegments', 'createFixedByteSizedSegments', 'createRandomSegments', 'shuffleSegments', 'invertAllSegments', 'fillSegmentsGaps', 'combineOverlappingSegments', 'reorderSegsByStartTime', 'clearSegments', 'shiftAllSegmentTimes', 'alignSegmentTimesToKeyframes', 'duplicateCurrentSegment'],
    related: ['detectBlackScenes', 'detectSilentScenes', 'detectSceneChanges', 'createSegmentsFromKeyframes', 'invertAllSegments', 'fillSegmentsGaps', 'combineOverlappingSegments', 'reorderSegsByStartTime', 'clearSegments', 'toggleKeyboardShortcuts'],
  },
  {
    id: 'export',
    triggers: ['export', 'captureSnapshot', 'captureSnapshotToClipboard', 'captureSnapshotAsCoverArt', 'extractCurrentSegmentFramesAsImages', 'extractSelectedSegmentsFramesAsImages', 'exportYouTube'],
    related: ['export', 'captureSnapshot', 'captureSnapshotToClipboard', 'extractCurrentSegmentFramesAsImages', 'toggleKeyboardShortcuts'],
  },
  {
    id: 'batch-tools',
    triggers: ['concatBatch', 'cleanupFilesDialog', 'convertFormatBatch', 'convertFormatCurrentFile', 'fixInvalidDuration', 'decimate'],
    related: ['concatBatch', 'convertFormatBatch', 'fixInvalidDuration', 'decimate', 'cleanupFilesDialog', 'closeBatch', 'toggleKeyboardShortcuts'],
  },
  {
    id: 'files',
    triggers: ['batchNextFile', 'batchPreviousFile', 'batchOpenNextFile', 'batchOpenPreviousFile', 'batchOpenPlayNextFile', 'batchOpenPlayPreviousFile', 'batchOpenSelectedFile', 'closeBatch'],
    related: ['batchNextFile', 'batchPreviousFile', 'batchOpenNextFile', 'batchOpenPreviousFile', 'batchOpenPlayNextFile', 'batchOpenPlayPreviousFile', 'batchOpenSelectedFile', 'closeBatch', 'toggleKeyboardShortcuts'],
  },
  {
    id: 'tracks',
    triggers: ['toggleStripAudio', 'toggleStripVideo', 'toggleStripSubtitle', 'toggleStripThumbnail', 'toggleStripAll', 'toggleStripCurrentFilter', 'toggleStreamsSelector', 'showStreamsSelector', 'extractAllStreams', 'showIncludeExternalStreamsDialog'],
    related: ['toggleStripAudio', 'toggleStripVideo', 'toggleStripAll', 'toggleStripCurrentFilter', 'toggleStreamsSelector', 'extractAllStreams', 'toggleKeyboardShortcuts'],
  },
  {
    id: 'view',
    triggers: ['toggleWaveformMode', 'generateOverviewWaveform', 'toggleShowThumbnails', 'toggleShowKeyframes', 'readAllKeyframes', 'toggleSegmentsList', 'toggleDarkMode', 'toggleCaptureFormat', 'reloadFile', 'html5ify', 'makeCursorTimeZero', 'increaseRotation', 'setStartTimeOffset'],
    related: ['toggleWaveformMode', 'toggleShowThumbnails', 'toggleShowKeyframes', 'toggleSegmentsList', 'increaseRotation', 'makeCursorTimeZero', 'toggleDarkMode', 'toggleKeyboardShortcuts'],
  },
  {
    id: 'edit',
    triggers: ['undo', 'redo', 'copySegmentsToClipboard'],
    related: ['undo', 'redo', 'copySegmentsToClipboard', 'toggleKeyboardShortcuts'],
  },
  {
    id: 'selective-playback',
    triggers: ['togglePlayOnlyCurrentSegment', 'toggleLoopOnlyCurrentSegment', 'toggleLoopStartEndOnlyCurrentSegment', 'togglePlaySelectedSegments', 'toggleLoopSelectedSegments'],
    related: ['togglePlayOnlyCurrentSegment', 'toggleLoopOnlyCurrentSegment', 'togglePlaySelectedSegments', 'toggleLoopSelectedSegments', 'toggleKeyboardShortcuts'],
  },
  {
    id: 'app',
    triggers: ['openFilesDialog', 'openDirDialog', 'closeCurrentFile', 'quit', 'toggleSettings', 'openSendReportDialog', 'toggleLastCommands'],
    related: ['openFilesDialog', 'openDirDialog', 'closeCurrentFile', 'reloadFile', 'toggleSettings', 'toggleLastCommands', 'quit', 'toggleKeyboardShortcuts'],
  },
  {
    id: 'cut-results',
    triggers: ['playlistPrev', 'playlistNext', 'playlistFirst', 'playlistLast', 'renameResultLabel', 'renameResultFull', 'mergeCutResults'],
    related: ['playlistPrev', 'playlistNext', 'playlistFirst', 'playlistLast', 'renameResultLabel', 'renameResultFull', 'mergeCutResults', 'toggleKeyboardShortcuts'],
  },
  {
    id: 'help',
    triggers: ['toggleKeyboardShortcuts', 'togglePatchCommandConsole', 'togglePatchMenuBar'],
    related: ['toggleKeyboardShortcuts', 'togglePatchCommandConsole', 'togglePatchMenuBar', 'toggleSettings'],
  },
] as const satisfies readonly PracticeGuide[];

export type PracticeGuideId = (typeof practiceGuides)[number]['id'];
