import type { KeyboardEventHandler, MouseEventHandler, ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { patchExportFormats, patchImportFormats } from '../../../../../common/features/patchData';
import type { PatchExportFormat, PatchFileOperation, PatchImportFormat } from '../../../../../common/features/patchData';
import type { Html5ifyMode } from '../../../../../common/types';
import { usePatchSession } from '../session/patchSessionContext';

/** The encode speeds upstream offers for converting a file to a player-supported format. */
const html5ifySpeeds: Html5ifyMode[] = ['fast-audio-remux', 'fast-audio', 'fast', 'slow', 'slow-audio', 'slowest'];

const fieldStyle = { display: 'flex', alignItems: 'center', gap: '.5em' } as const;
const detailsStyle = { opacity: 0.75, fontSize: '.9em' } as const;

/**
 * Parameter dialog for the file operations that cannot run without input (html5ify speed, decimate
 * keyframe step + frame rate, export format). Everything else runs straight from the console /
 * palette.
 */
export default function FileOperationDialog({ operation, onClose }: { operation: PatchFileOperation, onClose: () => void }) {
  const { t } = useTranslation();
  const { runFileOperation, detectedFps } = usePatchSession();
  const [speed, setSpeed] = useState<Html5ifyMode>('fast-audio-remux');
  const [n, setN] = useState('1');
  const [fps, setFps] = useState(() => (detectedFps != null && detectedFps > 0 ? String(Math.round(detectedFps)) : '20'));
  const [format, setFormat] = useState<PatchExportFormat>('csv');
  const [importFormat, setImportFormat] = useState<PatchImportFormat>('csv');

  // Same wording as upstream's own import/export menus.
  const importFormatLabels: Record<PatchImportFormat, string> = {
    csv: t('Times in seconds (CSV)'),
    'csv-frames': t('Frame numbers (CSV)'),
    edl: t('EDL'),
    cutlist: t('Cutlist'),
    xmeml: t('DaVinci Resolve / Final Cut Pro XML'),
    fcpxml: t('Final Cut Pro FCPX / FCPXML'),
    cue: t('CUE sheet file'),
    pbf: t('PotPlayer Bookmarks (.pbf)'),
    srt: t('Subtitles (SRT)'),
    'dv-analyzer-summary-txt': t('DV Analyzer Summary.txt'),
    otio: t('OpenTimelineIO'),
    llc: t('Import project (LLC)...'),
    youtube: t('Text chapters / YouTube'),
  };

  // Labels mirror the wording upstream uses for the same choices.
  const formatLabels: Record<PatchExportFormat, string> = {
    csv: t('Times in seconds (CSV)'),
    'csv-human': t('Timestamps (CSV)'),
    'csv-frames': t('Frame numbers (CSV)'),
    'tsv-human': t('Timestamps (TSV/TXT)'),
    srt: t('Subtitles (SRT)'),
    llc: t('Export project (LLC)...'),
  };
  const speedLabels: Record<Html5ifyMode, string> = {
    fastest: t('Fastest: FFmpeg-assisted playback'),
    fast: t('Fast: Full quality remux (no audio), likely to fail'),
    'fast-audio-remux': t('Fast: Full quality remux, likely to fail'),
    'fast-audio': t('Fast: Remux video, encode audio (fails if unsupported video codec)'),
    slow: t('Slow: Low quality encode (no audio)'),
    'slow-audio': t('Slow: Low quality encode'),
    slowest: t('Slowest: High quality encode'),
  };

  const submit = useCallback(() => {
    switch (operation) {
      case 'decimate': {
        const parsedN = Number(n);
        const parsedFps = Number(fps);
        if (!Number.isFinite(parsedN) || parsedN <= 0) return;
        if (!Number.isFinite(parsedFps) || parsedFps <= 0) return;
        runFileOperation(operation, { n: parsedN, fps: parsedFps }).catch((err: unknown) => { console.error(err); });
        break;
      }
      case 'export-cut-list': {
        runFileOperation(operation, { format }).catch((err: unknown) => { console.error(err); });
        break;
      }
      case 'import-cut-list': {
        runFileOperation(operation, { importFormat }).catch((err: unknown) => { console.error(err); });
        break;
      }
      default: {
        runFileOperation(operation, { speed }).catch((err: unknown) => { console.error(err); });
        break;
      }
    }
    onClose();
  }, [format, fps, importFormat, n, onClose, operation, runFileOperation, speed]);

  const onKeyDown = useCallback<KeyboardEventHandler<HTMLDivElement>>((event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }, [onClose]);

  const onBackdropMouseDown = useCallback<MouseEventHandler<HTMLDivElement>>((event) => {
    if (event.target === event.currentTarget) onClose();
  }, [onClose]);

  let title: string;
  let body: ReactNode;

  // One branch per parameterised operation.
  /* eslint-disable unicorn/prefer-switch */
  if (operation === 'decimate') {
    title = t('Decimate video');
    body = (
      <>
        <div style={detailsStyle}>
          {t('Decimate allows you to losslessly extract only the keyframes from a video, discarding all non-keyframes. You can also optionally drop some of the keyframes. This can dramatically speed up playback and is useful for shortening long videos with little motion, such as creating time-lapse videos.')}
        </div>
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label style={fieldStyle}>
          <span style={{ flexGrow: 1 }}>{t('Keep every nth keyframe. Use the value "1" to keep all keyframes')}</span>
          <input value={n} onChange={(event) => setN(event.target.value)} inputMode="numeric" style={{ width: '6em', fontFamily: 'monospace' }} />
        </label>
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label style={fieldStyle}>
          <span style={{ flexGrow: 1 }}>{t('Output video frame rate (frames per second)')}</span>
          <input value={fps} onChange={(event) => setFps(event.target.value)} inputMode="numeric" style={{ width: '6em', fontFamily: 'monospace' }} />
        </label>
      </>
    );
  } else if (operation === 'export-cut-list') {
    title = t('Export cut list');
    body = (
      <>
        <div style={detailsStyle}>{t('Writes the marked segments in the chosen format to a file you pick.')}</div>
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label style={fieldStyle}>
          <span style={{ flexGrow: 1 }}>{t('Format')}</span>
          <select value={format} onChange={(event) => setFormat(event.target.value as PatchExportFormat)}>
            {patchExportFormats.map((option) => <option key={option} value={option}>{formatLabels[option]}</option>)}
          </select>
        </label>
        <div style={detailsStyle}>{t('Tip: `export srt` in the console skips this dialog.')}</div>
      </>
    );
  } else if (operation === 'import-cut-list') {
    title = t('Import cut list');
    body = (
      <>
        <div style={detailsStyle}>{t('Replaces the marked segments of the current file with the ones loaded from the chosen format.')}</div>
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label style={fieldStyle}>
          <span style={{ flexGrow: 1 }}>{t('Format')}</span>
          <select value={importFormat} onChange={(event) => setImportFormat(event.target.value as PatchImportFormat)}>
            {patchImportFormats.map((option) => <option key={option} value={option}>{importFormatLabels[option]}</option>)}
          </select>
        </label>
        <div style={detailsStyle}>{t('Tip: `import srt` in the console skips this dialog.')}</div>
      </>
    );
  } else {
    const isBatch = operation === 'convert-batch';
    title = isBatch ? t('Convert the files in the work directory') : t('Convert current file to supported format');
    body = (
      <>
        {isBatch && (
          <div style={detailsStyle}>{t('Every media file in the work directory is converted. Existing outputs are skipped.')}</div>
        )}
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
        <label style={fieldStyle}>
          <span style={{ flexGrow: 1 }}>{t('Speed')}</span>
          <select value={speed} onChange={(event) => setSpeed(event.target.value as Html5ifyMode)}>
            {html5ifySpeeds.map((option) => <option key={option} value={option}>{speedLabels[option]}</option>)}
          </select>
        </label>
      </>
    );
  }
  /* eslint-enable unicorn/prefer-switch */
  return (
    <div
      role="presentation"
      onMouseDown={onBackdropMouseDown}
      onKeyDown={onKeyDown}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '12vh', background: 'rgba(0, 0, 0, .35)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width: 'min(560px, 92vw)', display: 'flex', flexDirection: 'column', gap: '.6em', padding: '.8em', background: 'var(--gray-2)', border: '1px solid var(--gray-7)', borderRadius: '8px', boxShadow: '0 8px 32px rgba(0, 0, 0, .4)' }}
      >
        <div style={{ fontWeight: 600 }}>{title}</div>
        {body}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5em' }}>
          <button type="button" onClick={onClose}>{t('Cancel')}</button>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <button type="button" autoFocus onClick={submit}>{t('Confirm')}</button>
        </div>
      </div>
    </div>
  );
}
