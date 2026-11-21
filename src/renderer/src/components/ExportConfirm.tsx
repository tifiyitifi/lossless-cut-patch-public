import type { CSSProperties, Dispatch, KeyboardEventHandler, ReactNode, SetStateAction } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { FaExclamationTriangle, FaInfoCircle, FaRegCheckCircle } from 'react-icons/fa';
import i18n from 'i18next';
import { useTranslation, Trans } from 'react-i18next';
import { IoIosHelpCircle, IoIosSettings } from 'react-icons/io';
import type { SweetAlertIcon } from 'sweetalert2';

import ExportButton from './ExportButton';
import { DialogButton } from './Button';
import ExportModeButton from './ExportModeButton';
import FileNameTemplateEditor from './FileNameTemplateEditor';
import HighlightedText from './HighlightedText';
import Select from './Select';
import Switch from './Switch';

import { primaryTextColor, warningColor } from '../colors';
import { withBlur } from '../util';
import getSwal from '../swal';
import { isMov as ffmpegIsMov } from '../util/streams';
import useUserSettings from '../hooks/useUserSettings';
import styles from './ExportConfirm.module.css';
import type { SegmentToExport } from '../types';
import type { GenerateOutFileNames } from '../util/outputNameTemplate';
import { defaultCutFileTemplate, defaultCutMergedFileTemplate } from '../util/outputNameTemplate';
import type { FFprobeStream } from '../../../common/ffprobe';
import type { AvoidNegativeTs, PreserveMetadata } from '../../../common/types';
import TextInput from './TextInput';
import type { UseSegments } from '../hooks/useSegments';
import ExportSheet from './ExportSheet';
import ToggleExportConfirm from './ToggleExportConfirm';
import type { LossyMode } from '../../../main';
import AnimatedTr from './AnimatedTr';
import type { Frame } from '../ffmpeg';
import type { FindNearestKeyframeTime } from '../hooks/useKeyframes';
import { troubleshootingUrl } from '../../../common/constants';
import OutDirSelector from './OutDirSelector';
import mainApi from '../mainApi';
// patch: the A/B/C choice of how a merged result's cut ends are handled (features/patchExportPolicy).
import MergeBoundarySection from '../features/patchExportPolicy/MergeBoundarySection';
import type { MergeBoundaryControl } from '../features/patchExportPolicy/MergeBoundarySection';
// patch: keep the export key working while a control inside the export screen has focus.
import { isModifierOnlyEvent, isTextEntryTarget, matchesKeyBinding } from '../features/patch/keyMatch';


const adjustCutFromValues = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const adjustCutToValues = [-10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const HelpIcon = ({ onClick, style }: { onClick: () => void, style?: CSSProperties }) => (
  <IoIosHelpCircle role="button" onClick={withBlur(onClick)} style={{ cursor: 'pointer', color: primaryTextColor, verticalAlign: 'middle', fontSize: '1.5em', ...style }} />
);

function ShiftTimes({ values, num, setNum }: { values: number[], num: number, setNum: (n: number) => void }) {
  const { t } = useTranslation();
  return (
    <Select value={num} onChange={(e) => setNum(Number(e.target.value))} style={{ height: 20, marginLeft: 5 }}>
      {values.map((v) => <option key={v} value={v}>{t('{{numFrames}} frames', { numFrames: v >= 0 ? `+${v}` : v, count: v })}</option>)}
    </Select>
  );
}

function renderNoticeIcon(notice: { warning?: boolean | undefined } | undefined, style?: CSSProperties) {
  if (!notice) return undefined;
  return notice.warning ? (
    <FaExclamationTriangle style={{ flexShrink: '0', fontSize: '.8em', verticalAlign: 'baseline', color: warningColor, ...style }} />
  ) : (
    <FaInfoCircle style={{ flexShrink: '0', fontSize: '.8em', verticalAlign: 'baseline', color: 'var(--cyan-10)', ...style }} />
  );
}

interface Notice {
  warning?: true,
  text: ReactNode,
}

interface GenericNotice {
  warning?: true,
  text: string,
  url?: string,
}

function Notice({ notice }: { notice: Notice | GenericNotice }) {
  const noticeStyle: CSSProperties = {};
  const infoStyle: CSSProperties = { ...noticeStyle, color: primaryTextColor };
  const warningStyle: CSSProperties = { ...noticeStyle, color: warningColor };

  const { text, warning } = notice;
  return (
    <div style={{ ...(warning ? warningStyle : infoStyle), display: 'flex', alignItems: 'center', gap: '0 .5em' }}>
      {renderNoticeIcon({ warning }, { fontSize: '1em', flexShrink: 0 })}
      {' '}
      <span style={{ fontSize: '.9em' }}>{text}</span>
    </div>
  );
}

function renderNotice(notice: Notice | undefined) {
  if (notice == null) return null;
  const { text } = notice;
  return (
    <Notice notice={notice} key={typeof text === 'string' ? text : undefined} />
  );
}

function renderGenericNotice(notice: GenericNotice) {
  const { url } = notice;
  return (
    <tr key={notice.text} className={styles['notice-row']}>
      <td colSpan={2}>
        <Notice notice={notice} />
      </td>
      <td>
        {url != null && <IoIosHelpCircle style={{ cursor: 'pointer', fontSize: '1.5em', flexShrink: 0, color: primaryTextColor }} title={i18n.t('Learn more')} role="button" tabIndex={0} onClick={() => mainApi.openExternal(url)} />}
      </td>
    </tr>
  );
}

const rightIconStyle: CSSProperties = { fontSize: '1.2em', verticalAlign: 'middle' };

function ExportConfirm({
  areWeCutting,
  segmentsToExport,
  willMerge,
  visible,
  onClosePress,
  onExportConfirm,
  onExportConfirmForce,
  outFormat,
  renderOutFmt,
  outputDir,
  numStreamsTotal,
  numStreamsToCopy,
  onShowStreamsSelectorClick,
  cutFileTemplate,
  cutMergedFileTemplate,
  mergedNameEditor,
  cutNameEditor,
  namingNote,
  reorderNote,
  onOutputDirPress,
  outputDirNote,
  generateCutFileNames,
  generateCutMergedFileNames,
  currentSegIndexSafe,
  segmentsOrInverse,
  mainCopiedThumbnailStreams,
  hvc1NeededStreams,
  needSmartCut,
  isEncoding,
  encBitrate,
  setEncBitrate,
  toggleSettings,
  outputPlaybackRate,
  lossyMode,
  neighbouringKeyFrames,
  findNearestKeyFrameTime,
  mergeBoundary,
  sourceDamaged,
  sourceFrameTimingDamaged,
  exportKey,
} : {
  areWeCutting: boolean,
  segmentsToExport: SegmentToExport[],
  willMerge: boolean,
  visible: boolean,
  onClosePress: () => void,
  onExportConfirm: () => void,
  /** patch: re-cut every selected result, ignoring the incremental-export manifest. */
  onExportConfirmForce?: (() => void) | undefined,
  outFormat: string | undefined,
  renderOutFmt: (style: CSSProperties) => ReactNode,
  outputDir: string | undefined,
  numStreamsTotal: number,
  numStreamsToCopy: number,
  onShowStreamsSelectorClick: () => void,
  cutFileTemplate: string,
  cutMergedFileTemplate: string,
  /** patch: the merged-name rule editor (the patch `{token}` rule replaces the upstream template). */
  mergedNameEditor?: ReactNode | undefined,
  /** patch: the cut-result name rule editor (the patch `{token}` rule replaces the cut template). */
  cutNameEditor?: ReactNode | undefined,
  /** patch: how a name clash is handled, shown only while overwriting is off (nothing can be skipped when it is on). */
  namingNote?: ReactNode | undefined,
  /** patch: why reordering clips re-cuts them instead of only renaming them, shown only for a source export. */
  reorderNote?: ReactNode | undefined,
  /**
  patch: patch mode writes the cut results into the work area, so the upstream out-dir selector
  would edit a setting that does not move them. The path itself opens the work directory instead.
  */
  onOutputDirPress?: (() => void) | undefined,
  /** patch: a note under the path row (where the cut results are written). */
  outputDirNote?: ReactNode | undefined,
  generateCutFileNames: GenerateOutFileNames,
  generateCutMergedFileNames: GenerateOutFileNames,
  currentSegIndexSafe: number,
  segmentsOrInverse: UseSegments['segmentsOrInverse'],
  mainCopiedThumbnailStreams: FFprobeStream[],
  hvc1NeededStreams: FFprobeStream[],
  needSmartCut: boolean,
  isEncoding: boolean,
  encBitrate: number | undefined,
  setEncBitrate: Dispatch<SetStateAction<number | undefined>>,
  toggleSettings: () => void,
  outputPlaybackRate: number,
  lossyMode: LossyMode | undefined,
  neighbouringKeyFrames: Frame[],
  findNearestKeyFrameTime: FindNearestKeyframeTime,
  /** patch: set for a merged patch export only; renders the A/B/C cut-end choice. */
  mergeBoundary?: MergeBoundaryControl | undefined,
  /** patch: the opened source cannot be decoded at its head; no cut can repair it. */
  sourceDamaged?: boolean | undefined,
  /** patch: the opened source is stored with broken frame timing; a repair encode makes the clips correct. */
  sourceFrameTimingDamaged?: boolean | undefined,
  /** patch: the binding that exports (`E`); it keeps working while the sheet has focus. */
  exportKey?: string | undefined,
}) {
  const { t } = useTranslation();

  const { keyframeCut, toggleKeyframeCut, preserveMovData, setPreserveMovData, preserveMetadata, setPreserveMetadata, preserveChapters, setPreserveChapters, movFastStart, setMovFastStart, avoidNegativeTs, setAvoidNegativeTs, autoDeleteMergedSegments, exportConfirmEnabled, toggleExportConfirmEnabled, segmentsToChapters, setSegmentsToChapters, preserveMetadataOnMerge, setPreserveMetadataOnMerge, enableSmartCut, setEnableSmartCut, effectiveExportMode, enableOverwriteOutput, setEnableOverwriteOutput, ffmpegExperimental, setFfmpegExperimental, cutFromAdjustmentFrames, setCutFromAdjustmentFrames, cutToAdjustmentFrames, setCutToAdjustmentFrames, setCutFileTemplate, setCutMergedFileTemplate, simpleMode, keyframesEnabled, damagedSourceExportRepair, setDamagedSourceExportRepair } = useUserSettings();

  const [showAdvanced, setShowAdvanced] = useState(!simpleMode);

  // patch: the export key keeps working while a control inside the sheet has focus (a radio, a
  // checkbox, a button). The upstream shortcut only dispatches while `document.body` has focus, so
  // without this the key dies as soon as the user touches an option - exactly where the workflow
  // should stay on the keyboard. Text fields keep their own keys.
  const onSheetKeyDownCapture = useCallback<KeyboardEventHandler<HTMLDivElement>>((event) => {
    if (event.repeat || isModifierOnlyEvent(event.code) || isTextEntryTarget(event.target) || !matchesKeyBinding(event, exportKey)) return;
    event.preventDefault();
    event.stopPropagation();
    onExportConfirm();
  }, [exportKey, onExportConfirm]);

  const togglePreserveChapters = useCallback(() => setPreserveChapters((val) => !val), [setPreserveChapters]);
  const togglePreserveMovData = useCallback(() => setPreserveMovData((val) => !val), [setPreserveMovData]);
  const toggleMovFastStart = useCallback(() => setMovFastStart((val) => !val), [setMovFastStart]);
  const toggleSegmentsToChapters = useCallback(() => setSegmentsToChapters((v) => !v), [setSegmentsToChapters]);
  const togglePreserveMetadataOnMerge = useCallback(() => setPreserveMetadataOnMerge((v) => !v), [setPreserveMetadataOnMerge]);

  const isMov = ffmpegIsMov(outFormat);
  const isIpod = outFormat === 'ipod';

  // patch: the video of a damaged source is re-encoded even though `isEncoding` stays false (the
  // repair replaces smart cut, see features/damagedSource). The lossless-only rows below would
  // promise a cut that does not happen for this file. This holds for a whole-file export too: the
  // repair encodes that segment even though `areWeCutting` is false.
  const sourceVideoRepairApplies = sourceFrameTimingDamaged === true && effectiveExportMode !== 'segments_to_chapters';
  const sourceVideoRepaired = sourceVideoRepairApplies && damagedSourceExportRepair;

  // some thumbnail streams (png,jpg etc) cannot always be cut correctly, so we warn if they try to.
  const areWeCuttingProblematicStreams = areWeCutting && mainCopiedThumbnailStreams.length > 0;

  const haveSegmentWithProblematicKeyframe = useMemo(() => {
    if (neighbouringKeyFrames.length === 0) return false; // we don't know
    return segmentsToExport.some(({ start, end }) => {
      const nearestPreviousKeyframeTime = findNearestKeyFrameTime({ time: start, direction: -1 }) ?? 0;
      const segmentDuration = end - start;
      const estimatedExportedSegmentDuration = end - nearestPreviousKeyframeTime;
      // if estimated actual output length of segment is more than 1.5 times the intended segment duration, then we consider it problematic and warn the user about it.
      return estimatedExportedSegmentDuration > segmentDuration * 1.5;
    });
  }, [neighbouringKeyFrames.length, segmentsToExport, findNearestKeyFrameTime]);

  const notices = useMemo(() => {
    const specific: Record<'exportMode' | 'problematicStreams' | 'movFastStart' | 'preserveMovData' | 'smartCut' | 'cutMode' | 'avoidNegativeTs' | 'overwriteOutput', Notice | undefined> = {
      exportMode: effectiveExportMode === 'segments_to_chapters' ? { text: i18n.t('Segments to chapters mode is active, this means that the file will not be cut. Instead chapters will be created from the segments.') } : undefined,
      problematicStreams: areWeCuttingProblematicStreams ? { warning: true, text: <Trans>Warning: Cutting thumbnail tracks is known to cause problems. Consider disabling track {{ trackNumber: mainCopiedThumbnailStreams[0] ? mainCopiedThumbnailStreams[0].index + 1 : 0 }}.</Trans> } : undefined,
      movFastStart: isMov && isIpod && !movFastStart ? { warning: true, text: t('For the ipod format, it is recommended to activate this option') } : undefined,
      preserveMovData: isMov && isIpod && preserveMovData ? { warning: true, text: t('For the ipod format, it is recommended to deactivate this option') } : undefined,
      smartCut: areWeCutting && needSmartCut ? { warning: true, text: t('Smart cut is experimental and will not work on all files.') } : undefined,
      cutMode: areWeCutting && !isEncoding && !sourceVideoRepaired && !keyframeCut ? { text: t('Note: Keyframe cut is recommended for most common files') } : undefined,
      avoidNegativeTs: !isEncoding && !sourceVideoRepaired ? (() => {
        if (willMerge) {
          if (avoidNegativeTs !== 'make_non_negative') {
            return { text: t('When merging, it\'s generally recommended to set this to "make_non_negative"') };
          }
          return undefined;
        }
        if (!['make_zero', 'auto'].includes(avoidNegativeTs)) {
          return { text: t('It\'s generally recommended to set this to one of: {{values}}', { values: '"auto", "make_zero"' }) };
        }
        return undefined;
      })() : undefined,
      overwriteOutput: enableOverwriteOutput ? { text: t('Existing files will be overwritten without warning!') } : undefined,
    };

    const generic: GenericNotice[] = [];

    if (simpleMode) {
      generic.push({ text: t('You are in simple mode, meaning some functionality has been simplified or hidden.') });
    }

    if (['separate', 'merge', 'merge+separate'].includes(effectiveExportMode) && !areWeCutting) {
      generic.push({ text: t('Exporting whole file without cutting, because there are no segments to export.') });
    }

    if (hvc1NeededStreams.length > 0) {
      generic.push({ warning: true, text: t('Track {{trackNumbers}} is HEVC without the "{{tag}}" codec tag, so it may not play on Apple devices (QuickTime, Safari, iOS). You can set the tag in the track editor.', { trackNumbers: hvc1NeededStreams.map((s) => s.index + 1).join(', '), tag: 'hvc1' }) });
    }

    if (areWeCutting) {
      // https://github.com/mifi/lossless-cut/issues/1809
      if (outFormat === 'flac') {
        generic.push({ text: t('There is a known issue in FFmpeg with cutting FLAC files. The file will be re-encoded, which is still lossless, but the export may be slower.') });
      }
      if (outputPlaybackRate !== 1) {
        generic.push({ warning: true, text: t('Adjusting the output FPS and cutting at the same time will cause incorrect cuts. Consider instead doing it in two separate steps.') });
      }
      if (keyframesEnabled && haveSegmentWithProblematicKeyframe) {
        generic.push({ warning: true, text: t('A segment may result in an unexpectedly long output file length after exporting, because your video file doesn\'t have any keyframes near the start time of the segment you\'re trying to cut.'), url: troubleshootingUrl });
      }
    }

    return {
      generic,
      specific,
      totalNum: generic.filter((n) => n.warning).length + Object.values(specific).filter((n) => n?.warning).length,
    };
  }, [effectiveExportMode, areWeCuttingProblematicStreams, mainCopiedThumbnailStreams, isMov, isIpod, movFastStart, t, preserveMovData, areWeCutting, needSmartCut, isEncoding, sourceVideoRepaired, keyframeCut, enableOverwriteOutput, simpleMode, willMerge, avoidNegativeTs, outFormat, outputPlaybackRate, keyframesEnabled, haveSegmentWithProblematicKeyframe, hvc1NeededStreams]);

  const exportModeDescription = useMemo(() => ({
    segments_to_chapters: t('Don\'t cut the file, but instead export an unmodified original which has chapters generated from segments'),
    merge: t('Auto merge segments to one file after export'),
    'merge+separate': t('Auto merge segments into one file after export, but keep exported per-segment files too'),
    separate: t('Export each segment to a separate file'),
  })[effectiveExportMode], [effectiveExportMode, t]);

  const showHelpText = useCallback(({ icon = 'info', timer = 10000, text }: { icon?: SweetAlertIcon, timer?: number, text: string }) => getSwal().toast.fire({ icon, timer, text }), []);

  const onPreserveChaptersPress = useCallback(() => {
    showHelpText({ text: i18n.t('Whether to preserve chapters from source file.') });
  }, [showHelpText]);

  const onPreserveMovDataHelpPress = useCallback(() => {
    showHelpText({ text: i18n.t('Preserve all MOV/MP4 metadata tags (e.g. EXIF, GPS position etc.) from source file? Note that some players have trouble playing back files where all metadata is preserved, like iTunes and other Apple software') });
  }, [showHelpText]);

  const onPreserveMetadataHelpPress = useCallback(() => {
    showHelpText({ text: i18n.t('Whether to preserve metadata from source file. Default: Global (file metadata), per-track and per-chapter metadata will be copied. Non-global: Only per-track and per-chapter metadata will be copied. None: No metadata will be copied') });
  }, [showHelpText]);

  const onMovFastStartHelpPress = useCallback(() => {
    showHelpText({ text: i18n.t('Enabling this will allow faster playback of the exported file. This makes processing use 3 times as much export I/O, which is negligible for small files but might slow down exporting of large files.') });
  }, [showHelpText]);

  const onOutFmtHelpPress = useCallback(() => {
    showHelpText({ text: i18n.t('Defaults to same format as input file. You can losslessly change the file format (container) of the file with this option. Not all formats support all codecs. Matroska/MP4/MOV support the most common codecs. Sometimes it\'s even impossible to export to the same output format as input.') });
  }, [showHelpText]);

  const onKeyframeCutHelpPress = useCallback(() => {
    showHelpText({ text: i18n.t('With "keyframe cut", we will cut at the nearest keyframe before the desired start cutpoint. This is recommended for most files. With "Normal cut" you may have to manually set the cutpoint a few frames before the next keyframe to achieve a precise cut') });
  }, [showHelpText]);

  const onSmartCutHelpPress = useCallback(() => {
    showHelpText({ text: i18n.t('This experimental feature will re-encode the part of the video from the cutpoint until the next keyframe in order to attempt to make a 100% accurate cut. Only works on some files. I\'ve had success with some h264 files, and only a few h265 files. See more here: {{url}}', { url: 'https://github.com/mifi/lossless-cut/issues/126' }) });
  }, [showHelpText]);

  const onTracksHelpPress = useCallback(() => {
    showHelpText({ text: i18n.t('Not all formats support all track types, and LosslessCut is unable to properly cut some track types, so you may have to sacrifice some tracks by disabling them in order to get correct result.') });
  }, [showHelpText]);

  const onSegmentsToChaptersHelpPress = useCallback(() => {
    showHelpText({ text: i18n.t('When merging, do you want to create chapters in the merged file, according to the cut segments? NOTE: This may dramatically increase processing time') });
  }, [showHelpText]);

  const onPreserveMetadataOnMergeHelpPress = useCallback(() => {
    showHelpText({ text: i18n.t('When merging, do you want to preserve metadata from your original file? NOTE: This may dramatically increase processing time') });
  }, [showHelpText]);

  const onCutFileTemplateHelpPress = useCallback(() => {
    showHelpText({ text: i18n.t('You can customize the file name of the output segment(s) using special variables.', { count: segmentsToExport.length }) });
  }, [segmentsToExport.length, showHelpText]);

  const onCutMergedFileTemplateHelpPress = useCallback(() => {
    showHelpText({ text: i18n.t('You can customize the file name of the merged file using special variables.') });
  }, [showHelpText]);

  const onExportModeHelpPress = useCallback(() => {
    showHelpText({ text: exportModeDescription });
  }, [exportModeDescription, showHelpText]);

  const onAvoidNegativeTsHelpPress = useCallback(() => {
    // https://ffmpeg.org/ffmpeg-all.html#Format-Options
    // https://github.com/mifi/lossless-cut/issues/1206
    const texts = {
      make_non_negative: i18n.t('Shift timestamps to make them non-negative. Also note that this affects only leading negative timestamps, and not non-monotonic negative timestamps.'),
      make_zero: i18n.t('Shift timestamps so that the first timestamp is 0. (LosslessCut default)'),
      auto: i18n.t('Enables shifting when required by the target format.'),
      disabled: i18n.t('Disables shifting of timestamp.'),
    };
    showHelpText({ text: `${avoidNegativeTs}: ${texts[avoidNegativeTs]}` });
  }, [avoidNegativeTs, showHelpText]);

  const onCutFromAdjustmentFramesHelpPress = useCallback(() => {
    showHelpText({ text: i18n.t('This option allows you to shift all segment start times forward by one or more frames before cutting. This can be useful if the output video starts from the wrong (preceding) keyframe.') });
  }, [showHelpText]);

  const onFfmpegExperimentalHelpPress = useCallback(() => {
    showHelpText({ text: t('Enable experimental ffmpeg features flag?') });
  }, [showHelpText, t]);

  const canEditSegTemplate = !willMerge || !autoDeleteMergedSegments;

  const handleEncBitrateToggle = useCallback((checked: boolean) => {
    setEncBitrate(() => (checked ? undefined : 10000));
  }, [setEncBitrate]);

  const handleEncBitrateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10);
    if (Number.isNaN(v) || v <= 0) return;
    setEncBitrate(v);
  }, [setEncBitrate]);

  return (
    <ExportSheet
      width="50em"
      visible={visible}
      title={t('Export options')}
      onClosePress={onClosePress}
      onKeyDownCapture={onSheetKeyDownCapture}
      renderButton={() => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5em' }}>
          {onExportConfirmForce != null && (
            <DialogButton onClick={withBlur(() => onExportConfirmForce())} style={{ fontSize: '.9em' }}>
              {t('Force re-export all')}
            </DialogButton>
          )}
          <ExportButton segmentsToExport={segmentsToExport} areWeCutting={areWeCutting} onClick={withBlur(() => onExportConfirm())} style={{ fontSize: '1.3em' }} />
        </div>
      )}
      renderBottom={() => (
        <>
          <ToggleExportConfirm size="1.5em" />
          <div style={{ fontSize: '.8em', marginLeft: '.4em', marginRight: '.5em', maxWidth: '8.5em', lineHeight: '100%', color: exportConfirmEnabled ? 'var(--gray-12)' : 'var(--gray-11)', cursor: 'pointer' }} role="button" onClick={toggleExportConfirmEnabled}>
            {t('Show this page before exporting?')}
          </div>
          {notices.totalNum > 0 && (
            renderNoticeIcon({ warning: true }, { fontSize: '1.5em', marginRight: '.5em' })
          )}
        </>
      )}
    >
      <table className={styles['options']}>
        <tbody>
          {notices.generic.map((notice) => renderGenericNotice(notice))}

          {/* patch: the source has a damaged head GOP; cutting cannot repair those frames. */}
          {sourceDamaged === true && (
            <tr className={styles['notice-row']}>
              <td colSpan={2}>
                <Notice notice={{ warning: true, text: t('The beginning of this video is damaged (decode errors). No cut can repair those frames; they will stutter or look broken in every player.') }} />
              </td>
              <td />
            </tr>
          )}

          {/* patch: this source's storage breaks a lossless copy, so the video is re-encoded and the
              clip is not lossless (features/damagedSource). */}
          {(sourceFrameTimingDamaged === true && sourceVideoRepairApplies) && (
            <tr className={styles['notice-row']}>
              <td colSpan={2}>
                <Notice
                  notice={damagedSourceExportRepair
                    ? { text: t('This video is stored with broken frame timing. The video of each clip will be re-encoded, so the clips are correct in every player, but they are no longer lossless. The audio is copied without loss.') }
                    : { warning: true, text: t('This video is stored with broken frame timing and the repair is turned off, so the clips will keep jumping here (and in Chrome or Edge) even though they look fine in VLC.') }}
                />
              </td>
              <td />
            </tr>
          )}

          {/* patch: the repair switch sits outside the advanced block (the merge-boundary row below
              for the same reason). It decides whether the clips are usable at all, and the
              damaged-source prompt sends the user here to turn it on. */}
          {sourceVideoRepairApplies && (
            <tr>
              <td>
                {t('Repair this damaged video by re-encoding it:')}
              </td>
              <td>
                <Switch checked={damagedSourceExportRepair} onCheckedChange={setDamagedSourceExportRepair} />
              </td>
              <td />
            </tr>
          )}

          {segmentsOrInverse.selected.length !== segmentsOrInverse.all.length && (
            <tr>
              <td colSpan={2}>
                <FaRegCheckCircle size={12} style={{ marginRight: 3 }} />{t('{{selectedSegments}} of {{nonFilteredSegments}} segments selected', { selectedSegments: segmentsOrInverse.selected.length, nonFilteredSegments: segmentsOrInverse.all.length })}
              </td>
              <td />
            </tr>
          )}

          <tr>
            <td>
              {segmentsOrInverse.selected.length > 1 ? t('Export mode for {{segments}} segments', { segments: segmentsOrInverse.selected.length }) : t('Export mode')}
              {renderNotice(notices.specific['exportMode'])}
            </td>
            <td>
              <ExportModeButton selectedSegments={segmentsOrInverse.selected} style={{ height: '1.8em' }} />
            </td>
            <td>
              {renderNoticeIcon(notices.specific['exportMode'], rightIconStyle) ?? <HelpIcon onClick={onExportModeHelpPress} />}
            </td>
          </tr>

          {/* patch: the cut-end policy of the merged result (features/patchExportPolicy), outside the
              advanced block so it is visible in simple mode too: it decides whether the result stutters. */}
          {mergeBoundary != null && (
            <MergeBoundarySection
              policy={mergeBoundary.policy}
              guard={mergeBoundary.guard}
              setPolicy={mergeBoundary.setPolicy}
              setGuard={mergeBoundary.setGuard}
              guardFrames={mergeBoundary.guardFrames}
              guardSeconds={mergeBoundary.guardSeconds}
              shortestBlocked={mergeBoundary.shortestBlocked}
              repairBlockReason={mergeBoundary.repairBlockReason}
              extraRemux={mergeBoundary.extraRemux}
              tailToSourceEnd={mergeBoundary.tailToSourceEnd}
              setTailToSourceEnd={mergeBoundary.setTailToSourceEnd}
              showHelpText={showHelpText}
            />
          )}

          <tr>
            <td>
              {t('Output container format:')}
            </td>
            <td>
              {renderOutFmt({ height: '1.8em', maxWidth: 150 })}
            </td>
            <td>
              <HelpIcon onClick={onOutFmtHelpPress} />
            </td>
          </tr>

          <tr>
            <td>
              <Trans>Input has {{ numStreamsTotal }} tracks</Trans>
              {renderNotice(notices.specific['problematicStreams'])}
            </td>
            <td>
              <HighlightedText style={{ cursor: 'pointer' }} onClick={onShowStreamsSelectorClick}><Trans>Keeping {{ numStreamsToCopy }} tracks</Trans></HighlightedText>
            </td>
            <td>
              {renderNoticeIcon(notices.specific['problematicStreams'], rightIconStyle) ?? <HelpIcon onClick={onTracksHelpPress} />}
            </td>
          </tr>

          <tr>
            <td>
              {t('Save output to path:')}
            </td>
            <td>
              {/* patch: patch mode writes the cut results into the work area, so the upstream
                  selector would edit a setting that does not move them. The path opens the work
                  directory dialog instead; base mode keeps the selector unchanged. */}
              {onOutputDirPress != null ? (
                <HighlightedText role="button" style={{ wordBreak: 'break-all', cursor: 'pointer' }} onClick={onOutputDirPress}>{outputDir}</HighlightedText>
              ) : (
                <OutDirSelector>
                  <HighlightedText role="button" style={{ wordBreak: 'break-all', cursor: 'pointer' }}>{outputDir}</HighlightedText>
                </OutDirSelector>
              )}
            </td>
            <td />
          </tr>

          {/* patch: where the cut results are written (patch mode only). */}
          {outputDirNote != null && (
            <tr>
              <td colSpan={3} style={{ textAlign: 'left', fontSize: '.85em', color: 'var(--gray-11)' }}>{outputDirNote}</td>
            </tr>
          )}

          {canEditSegTemplate && (
            cutNameEditor == null ? (
              <tr>
                <td colSpan={2}>
                  <FileNameTemplateEditor mode="separate" template={cutFileTemplate} setTemplate={setCutFileTemplate} defaultTemplate={defaultCutFileTemplate} generateFileNames={generateCutFileNames} currentSegIndexSafe={currentSegIndexSafe} />
                </td>
                <td>
                  <HelpIcon onClick={onCutFileTemplateHelpPress} />
                </td>
              </tr>
            ) : (
              // patch: patch mode names the cut results with its own `{token}` rule, so the upstream
              // `${}` editor (and its help) would be the wrong one. `textAlign` because a
              // `colSpan={3}` cell also matches `td:last-child` in the stylesheet (centered).
              <tr>
                <td colSpan={3} style={{ textAlign: 'left' }}>{cutNameEditor}</td>
              </tr>
            )
          )}

          {willMerge && (
            mergedNameEditor == null ? (
              <tr>
                <td colSpan={2}>
                  <FileNameTemplateEditor mode="merge-segments" template={cutMergedFileTemplate} setTemplate={setCutMergedFileTemplate} defaultTemplate={defaultCutMergedFileTemplate} generateFileNames={generateCutMergedFileNames} />
                </td>
                <td>
                  <HelpIcon onClick={onCutMergedFileTemplateHelpPress} />
                </td>
              </tr>
            ) : (
              // patch: patch mode names the merged result with its own `{token}` rule, so the
              // upstream `${}` editor (and its help) would be the wrong one.
              <tr>
                <td colSpan={3} style={{ textAlign: 'left' }}>{mergedNameEditor}</td>
              </tr>
            )
          )}

          <tr>
            <td>
              {t('Overwrite existing files')}
              {renderNotice(notices.specific['overwriteOutput'])}
            </td>
            <td>
              <Switch checked={enableOverwriteOutput} onCheckedChange={setEnableOverwriteOutput} />
            </td>
            <td>
              {renderNoticeIcon(notices.specific['overwriteOutput'], rightIconStyle) ?? <HelpIcon onClick={() => showHelpText({ text: t('Overwrite files when exporting, if a file with the same name as the output file name exists?') })} />}
            </td>
          </tr>
        </tbody>
      </table>

      {/* patch: how a name clash is handled. Shown only while overwriting is off: with it on nothing
          can be skipped, so the note would describe a case that cannot happen. */}
      {namingNote != null && !enableOverwriteOutput && (
        <details style={{ marginTop: '.6em', fontSize: '.9em', color: 'var(--gray-11)' }}>
          <summary style={{ cursor: 'pointer' }}>{t('When a name is already taken')}</summary>
          <div style={{ marginTop: '.3em' }}>{namingNote}</div>
        </details>
      )}

      {/* patch: reordering is not a pure rename while the tail fix is on (see App.tsx). */}
      {reorderNote != null && (
        <details style={{ marginTop: '.6em', fontSize: '.9em', color: 'var(--gray-11)' }}>
          <summary style={{ cursor: 'pointer' }}>{t('Why reordering can re-cut clips')}</summary>
          <div style={{ marginTop: '.3em' }}>{reorderNote}</div>
        </details>
      )}

      <h3 style={{ marginBottom: '.5em' }}>{t('Advanced options')}</h3>

      <table className={styles['options']}>
        <tbody>
          <tr>
            <td style={{ paddingTop: '.5em', color: 'var(--gray-11)', fontSize: '.9em' }} colSpan={2}>
              {t('Depending on your specific file/player, you may have to try different options for best results.')}
            </td>
            <td />
          </tr>

          <tr>
            <td>
              {t('Show advanced options')}
            </td>
            <td>
              <Switch checked={showAdvanced} onCheckedChange={setShowAdvanced} />
            </td>
            <td />
          </tr>

          {showAdvanced && (
            <>
              {areWeCutting && (
                <>
                  <AnimatedTr>
                    <td>
                      {t('Shift all start times')}
                    </td>
                    <td>
                      <ShiftTimes values={adjustCutFromValues} num={cutFromAdjustmentFrames} setNum={setCutFromAdjustmentFrames} />
                    </td>
                    <td>
                      <HelpIcon onClick={onCutFromAdjustmentFramesHelpPress} />
                    </td>
                  </AnimatedTr>
                  <AnimatedTr>
                    <td>
                      {t('Shift all end times')}
                    </td>
                    <td>
                      <ShiftTimes values={adjustCutToValues} num={cutToAdjustmentFrames} setNum={setCutToAdjustmentFrames} />
                    </td>
                    <td />
                  </AnimatedTr>
                </>
              )}

              {isMov && (
                <>
                  <AnimatedTr>
                    <td>
                      {t('Enable MOV Faststart?')}
                    </td>
                    <td>
                      <Switch checked={movFastStart} onCheckedChange={toggleMovFastStart} />
                      {renderNotice(notices.specific['movFastStart'])}
                    </td>
                    <td>
                      {renderNoticeIcon(notices.specific['movFastStart'], rightIconStyle) ?? <HelpIcon onClick={onMovFastStartHelpPress} />}
                    </td>
                  </AnimatedTr>

                  <AnimatedTr>
                    <td>
                      {t('Preserve all MP4/MOV metadata?')}
                      {renderNotice(notices.specific['preserveMovData'])}
                    </td>
                    <td>
                      <Switch checked={preserveMovData} onCheckedChange={togglePreserveMovData} />
                    </td>
                    <td>
                      {renderNoticeIcon(notices.specific['preserveMovData'], rightIconStyle) ?? <HelpIcon onClick={onPreserveMovDataHelpPress} />}
                    </td>
                  </AnimatedTr>
                </>
              )}

              <AnimatedTr>
                <td>
                  {t('Preserve chapters')}
                </td>
                <td>
                  <Switch checked={preserveChapters} onCheckedChange={togglePreserveChapters} />
                </td>
                <td>
                  <HelpIcon onClick={onPreserveChaptersPress} />
                </td>
              </AnimatedTr>

              <AnimatedTr>
                <td>
                  {t('Preserve metadata')}
                </td>
                <td>
                  <Select value={preserveMetadata} onChange={(e) => setPreserveMetadata(e.target.value as PreserveMetadata)} style={{ height: 20, marginLeft: 5 }}>
                    <option value={'default' satisfies PreserveMetadata}>{t('Default')}</option>
                    <option value={'none' satisfies PreserveMetadata}>{t('None')}</option>
                    <option value={'nonglobal' satisfies PreserveMetadata}>{t('Non-global')}</option>
                  </Select>
                </td>
                <td>
                  <HelpIcon onClick={onPreserveMetadataHelpPress} />
                </td>
              </AnimatedTr>

              {willMerge && (
                <>
                  <AnimatedTr>
                    <td>
                      {t('Create chapters from merged segments? (slow)')}
                    </td>
                    <td>
                      <Switch checked={segmentsToChapters} onCheckedChange={toggleSegmentsToChapters} />
                    </td>
                    <td>
                      <HelpIcon onClick={onSegmentsToChaptersHelpPress} />
                    </td>
                  </AnimatedTr>

                  <AnimatedTr>
                    <td>
                      {t('Preserve original metadata when merging? (slow)')}
                    </td>
                    <td>
                      <Switch checked={preserveMetadataOnMerge} onCheckedChange={togglePreserveMetadataOnMerge} />
                    </td>
                    <td>
                      <HelpIcon onClick={onPreserveMetadataOnMergeHelpPress} />
                    </td>
                  </AnimatedTr>
                </>
              )}

              {areWeCutting && (
                <>
                  {/* patch: a damaged source is not offered smart cut - its whole video is encoded
                      instead (the repair switch is above, outside the advanced block). */}
                  {!sourceFrameTimingDamaged && (
                    <AnimatedTr>
                      <td>
                        {t('Smart cut (experimental):')}
                        {renderNotice(notices.specific['smartCut'])}
                      </td>
                      <td>
                        <Switch checked={enableSmartCut} onCheckedChange={() => setEnableSmartCut((v) => !v)} />
                      </td>
                      <td>
                        {renderNoticeIcon(notices.specific['smartCut'], rightIconStyle) ?? <HelpIcon onClick={onSmartCutHelpPress} />}
                      </td>
                    </AnimatedTr>
                  )}

                  {!isEncoding && !sourceVideoRepaired && (
                    <AnimatedTr>
                      <td>
                        {t('Keyframe cut mode')}
                        {renderNotice(notices.specific['cutMode'])}
                      </td>
                      <td>
                        <Switch checked={keyframeCut} onCheckedChange={() => toggleKeyframeCut()} />
                      </td>
                      <td>
                        {renderNoticeIcon(notices.specific['cutMode'], rightIconStyle) ?? <HelpIcon onClick={onKeyframeCutHelpPress} />}
                      </td>
                    </AnimatedTr>
                  )}
                </>
              )}


              {isEncoding && (
                <AnimatedTr>
                  <td>
                    {t('Smart cut auto detect bitrate')}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                      {encBitrate != null && (
                        <>
                          <TextInput value={encBitrate} onChange={handleEncBitrateChange} style={{ width: '4em', flexGrow: 0, marginRight: '.3em' }} />
                          <span style={{ marginRight: '.3em' }}>{t('kbit/s')}</span>
                        </>
                      )}
                      <span><Switch checked={encBitrate == null} onCheckedChange={handleEncBitrateToggle} /></span>
                    </div>
                  </td>
                  <td />
                </AnimatedTr>
              )}

              {lossyMode != null && (
                <AnimatedTr>
                  <td>
                    {t('Lossy mode')}
                  </td>
                  <td>
                    <Switch disabled checked={lossyMode != null} />
                    <div>{lossyMode.videoEncoder}</div>
                  </td>
                  <td />
                </AnimatedTr>
              )}

              {!isEncoding && !sourceVideoRepaired && (
                <AnimatedTr>
                  <td>
                    &quot;ffmpeg&quot; <code className="highlighted">avoid_negative_ts</code>
                    {renderNotice(notices.specific['avoidNegativeTs'])}
                  </td>
                  <td>
                    <Select value={avoidNegativeTs} onChange={(e) => setAvoidNegativeTs(e.target.value as AvoidNegativeTs)} style={{ height: 20, marginLeft: 5 }}>
                      <option value={'auto' satisfies AvoidNegativeTs}>auto</option>
                      <option value={'make_zero' satisfies AvoidNegativeTs}>make_zero</option>
                      <option value={'make_non_negative' satisfies AvoidNegativeTs}>make_non_negative</option>
                      <option value={'disabled' satisfies AvoidNegativeTs}>disabled</option>
                    </Select>
                  </td>
                  <td>
                    {renderNoticeIcon(notices.specific['avoidNegativeTs'], rightIconStyle) ?? <HelpIcon onClick={onAvoidNegativeTsHelpPress} />}
                  </td>
                </AnimatedTr>
              )}

              <AnimatedTr>
                <td>
                  {t('"ffmpeg" experimental flag')}
                </td>
                <td>
                  <Switch checked={ffmpegExperimental} onCheckedChange={setFfmpegExperimental} />
                </td>
                <td>
                  <HelpIcon onClick={onFfmpegExperimentalHelpPress} />
                </td>
              </AnimatedTr>

              <AnimatedTr>
                <td>
                  {t('More settings')}
                </td>
                <td>
                  <IoIosSettings size={24} role="button" onClick={toggleSettings} style={{ marginLeft: 5 }} />
                </td>
                <td />
              </AnimatedTr>
            </>
          )}
        </tbody>
      </table>
    </ExportSheet>
  );
}

export default memo(ExportConfirm);
