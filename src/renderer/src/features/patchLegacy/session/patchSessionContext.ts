import { createContext, useContext } from 'react';
import type { ReactEventHandler, RefObject } from 'react';

import type { FFprobeStream } from '../../../../../common/ffprobe';
import type { PatchAction, PatchKeyBinding } from '../../../../../common/features/patchData/keymap';
import type { PatchVideoFile } from '../../../../../common/features/patchData/videoFile';
import type { PatchPlaylistEntry, PatchPlayerView } from '../../../../../common/features/patchMerge/playlist';
import type { PatchSourcePostAction, PatchViewSwitchStyle } from '../../../../../common/features/patchData/settings';
import type { PatchSegmentOperation } from '../../../../../common/features/patchData/segmentOperations';
import type { PatchFileOperation, PatchFileOperationParams } from '../../../../../common/features/patchData/fileOperations';
import type useErrorHandling from '../../../hooks/useErrorHandling';
import type useLoading from '../../../hooks/useLoading';
import type useSegments from '../../../hooks/useSegments';
import type useTimecode from '../../../hooks/useTimecode';
import type { ChromiumHTMLVideoElement, PlaybackMode, StateSegment } from '../../../types';

/**
 * Patch session: the composition of upstream hooks (playback, timecode, loading, ...) that patch
 * mode wires once and every panel consumes. Kept deliberately small and grows phase by phase.
 *
 * Members are listed explicitly (instead of exposing whole upstream hook return objects) so that
 * consumers do not have to deal with ref-tainted objects during render (React Compiler lint).
 */
export interface PatchSessionValue {
  /** Currently opened media file, if any. */
  filePath: string | undefined;
  /** Load a media file into the session (probe + open). */
  openFile: (filePath: string) => Promise<void>;
  /** Prompt the user for a media file and open it. */
  openFileDialog: () => Promise<void>;
  /** Close the current file and reset the session. */
  closeFile: () => void;

  // Playback
  videoRef: RefObject<ChromiumHTMLVideoElement | null>;
  videoContainerRef: RefObject<HTMLDivElement | null>;
  /** `file://` URL of the current file, or `undefined` when no file is loaded. */
  videoUrl: string | undefined;
  playing: boolean;
  playbackRate: number;
  relevantTime: number;
  togglePlay: (options?: { resetPlaybackRate?: boolean, requestPlaybackMode?: PlaybackMode }) => void;
  /** Play the selected segments in order, stopping after the last one (upstream playback mode). */
  togglePlaySelectedSegments: () => void;
  play: () => void;
  pause: () => void;
  seekAbs: (value: number | undefined) => void;
  seekRel: (value: number) => void;
  setPlaybackRate: (rate: number) => void;
  /** Step by a single frame (fallback 0.1s when fps is unknown). */
  frameStep: (direction: number) => void;
  /** Nudge the playback rate by `delta` (clamped). */
  adjustPlaybackRate: (delta: number) => void;
  /** Nudge the volume by `delta` (clamped to 0..1). */
  adjustVolume: (delta: number) => void;
  /** Mute / unmute (restores to 1). */
  toggleMute: () => void;
  /** Toggle fullscreen on the video container. */
  toggleFullscreen: () => void;
  /** Select and seek to the previous/next segment. */
  jumpSegment: (direction: number) => void;
  /** Capture the current frame to an image in the work directory (upstream capture flow). */
  captureSnapshot: () => Promise<void>;
  /** Capture the current frame to the clipboard. */
  captureSnapshotToClipboard: () => Promise<void>;

  // Preview source / view switching
  /** Active player view (falls back to `source` when unavailable). */
  playerView: PatchPlayerView;
  /** Views currently available (source / cut / merge). */
  availableViews: PatchPlayerView[];
  /** Switch the player to a specific view. */
  setPlayerView: (view: PatchPlayerView) => void;
  /** Move `direction` steps through the available views (wraps). */
  stepPlayerView: (direction: number) => void;
  /** Sequential playlist for the clip-based views (empty in the `source` view). */
  previewPlaylist: PatchPlaylistEntry[];
  /** Index within `previewPlaylist`. */
  previewIndex: number;
  /** Advance to the next playlist entry when a clip ends. */
  onPreviewEnded: () => void;
  /** Behaviour of the `V` view switch key. */
  viewSwitchStyle: PatchViewSwitchStyle;

  // Video element handlers
  onStartPlaying: () => void;
  onStopPlaying: () => void;
  onVideoAbort: () => void;
  onSeeked: ReactEventHandler<HTMLVideoElement>;
  onTimeUpdate: ReactEventHandler<HTMLVideoElement>;
  onDurationChange: ReactEventHandler<HTMLVideoElement>;

  // Timecode
  formatTimecode: ReturnType<typeof useTimecode>['formatTimecode'];

  // Media metadata
  fileDuration: number | undefined;
  setFileDuration: (duration: number | undefined) => void;
  detectedFps: number | undefined;
  formatName: string | undefined;
  videoStreams: FFprobeStream[];
  audioStreams: FFprobeStream[];
  videoStream: FFprobeStream | undefined;

  // Work directory file list / flow
  videoFiles: PatchVideoFile[];
  /** Index of the open file within `videoFiles`, or -1. */
  currentFileIndex: number;
  /** Open the previous/next file in the work directory list (wraps). */
  openRelativeFile: (delta: number) => void;
  /** Re-scan the work directory. */
  refreshVideoFiles: () => void;

  // Cut segments
  cutSegments: StateSegment[];
  currentSegIndex: number;
  setCurrentSegIndex: (index: number) => void;
  currentCutSeg: StateSegment | undefined;
  addSegment: () => void;
  setCutStart: () => void;
  setCutEnd: () => void;
  removeCurrentSegment: () => void;
  splitCurrentSegment: () => void;
  clearSegments: () => void;
  // Segment selection (upstream `useSegments` state, exposed for multi-select + play-selected).
  selectedSegments: ReturnType<typeof useSegments>['selectedSegments'];
  selectAllSegments: () => void;
  deselectAllSegments: () => void;
  invertSelectedSegments: () => void;
  /** Flip the `selected` flag of the current segment. */
  toggleCurrentSegmentSelected: () => void;
  /** Flip the `selected` flag of one segment by id (used by the list checkboxes). */
  toggleSegmentSelected: ReturnType<typeof useSegments>['toggleSegmentSelected'];
  /** Export the current file's segments to the work directory (cut) and write the patch data file. Returns the output paths. */
  cut: () => Promise<string[]>;
  /** Import segments for the current file from a legacy `src_*.txt` file. */
  importSrcTxtDialog: () => Promise<void>;
  haveInvalidSegs: boolean;
  /** Paths produced by the last cut. */
  exportedPaths: string[];

  // Merge / post-processing
  /** Merge the current file's cut clips into one output. */
  merge: () => Promise<void>;
  /** Cut, then merge, in one action. */
  cutAndMerge: () => Promise<void>;
  /** Path of the last merged output, if any. */
  mergedPath: string | undefined;
  /** What to do with the source file after finishing it. */
  sourcePostAction: PatchSourcePostAction;
  setSourcePostAction: (action: PatchSourcePostAction) => void;
  /** When cutting, merge the produced clips into one file too. */
  autoMerge: boolean;
  /** Move / trash the source file according to `sourcePostAction` (no-op for keep / skip). */
  applySourcePostAction: () => Promise<void>;
  /** Apply the post action, then advance to the next file. */
  finishCurrentFile: () => Promise<void>;

  /** Run one of the upstream segment operations (detect scenes, invert, reorder, …). */
  runSegmentOperation: (operation: PatchSegmentOperation) => Promise<void>;
  /** Run one of the upstream file operations (fix invalid duration, extract all tracks, html5ify, decimate). */
  runFileOperation: (operation: PatchFileOperation, params?: PatchFileOperationParams) => Promise<void>;

  // Key bindings
  /** Effective patch key bindings (custom over defaults). */
  patchKeyBindings: PatchKeyBinding[];
  /** Bind `key` (+ shift) to an action; persists only the override. */
  setPatchKeyBinding: (action: PatchAction, key: string, shift: boolean | undefined) => void;
  /** Drop all custom bindings. */
  resetPatchKeyBindings: () => void;

  // Loading / errors
  progress: number | undefined;
  setProgress: (value: number | undefined) => void;
  working: ReturnType<typeof useLoading>['working'];
  abortWorking: () => void;
  handleError: ReturnType<typeof useErrorHandling>['handleError'];

  // Volume
  playbackVolume: number;
  setPlaybackVolume: (value: number) => void;
}

export const PatchSessionContext = createContext<PatchSessionValue | undefined>(undefined);

export function usePatchSession(): PatchSessionValue {
  const value = useContext(PatchSessionContext);
  if (value == null) throw new Error('usePatchSession must be used inside PatchSessionProvider');
  return value;
}
