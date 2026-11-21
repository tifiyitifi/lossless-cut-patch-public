import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FaCut, FaExpand, FaPause, FaPlay, FaStepBackward, FaStepForward } from 'react-icons/fa';

import { usePatchSession } from '../session/patchSessionContext';
import CutBar from './CutBar';

const controlButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  padding: '.25em .4em',
} as const;

/** Column 2, top: the player plus the cut bar. Keyboard is handled globally by PatchKeyboard. */
export default function PlayerPanel() {
  const { t } = useTranslation();
  const {
    fileDuration,
    videoRef, videoContainerRef, videoUrl,
    playing, playbackRate, relevantTime,
    togglePlay, frameStep, toggleFullscreen,
    onStartPlaying, onStopPlaying, onVideoAbort, onSeeked, onTimeUpdate, onDurationChange,
    formatTimecode,
    playbackVolume,
    openFileDialog,
    cut,
    playerView, previewIndex, previewPlaylist, onPreviewEnded,
  } = usePatchSession();

  const handleCut = useCallback(() => {
    cut().catch((err: unknown) => { console.error(err); });
  }, [cut]);

  const handleOpenClick = useCallback(() => {
    openFileDialog().catch((err: unknown) => { console.error(err); });
  }, [openFileDialog]);

  const currentTimeText = formatTimecode({ seconds: relevantTime, shorten: false });
  const durationText = fileDuration != null ? formatTimecode({ seconds: fileDuration, shorten: false }) : '--:--';
  const isSourceView = playerView === 'source';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        className="no-user-select"
        style={{ position: 'relative', flexGrow: 1, minHeight: 0, background: 'black', overflow: 'hidden' }}
        ref={videoContainerRef}
      >
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          src={videoUrl}
          tabIndex={-1}
          muted={playbackVolume === 0}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', visibility: videoUrl == null ? 'hidden' : 'visible' }}
          onLoadedMetadata={(event) => {
            // eslint-disable-next-line no-param-reassign
            event.currentTarget.volume = playbackVolume;
          }}
          onPlay={onStartPlaying}
          onPause={onStopPlaying}
          onAbort={onVideoAbort}
          onSeeked={onSeeked}
          onDurationChange={onDurationChange}
          onTimeUpdate={onTimeUpdate}
          onEnded={onPreviewEnded}
          onDoubleClick={toggleFullscreen}
        />

        {!isSourceView && previewPlaylist.length > 0 && (
          <div style={{ position: 'absolute', top: '.4em', left: '.6em', padding: '.15em .5em', borderRadius: '4px', background: 'rgba(0, 0, 0, .55)', fontSize: '.8em', fontFamily: 'monospace' }}>
            {playerView === 'merge' ? t('Predicted merge video') : t('Cut clips')} {previewIndex + 1}/{previewPlaylist.length}
          </div>
        )}

        {videoUrl == null && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '.8em', color: 'var(--gray-11)' }}>
            <div>{t('No media file loaded')}</div>
            <button type="button" onClick={handleOpenClick}>{t('Open file')}</button>
          </div>
        )}

        {videoUrl != null && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: '.5em', padding: '.35em .6em', background: 'linear-gradient(to top, rgba(0,0,0,0.65), transparent)' }}>
            <button type="button" style={controlButtonStyle} title={t('Previous frame')} onClick={() => frameStep(-1)}><FaStepBackward /></button>
            <button type="button" style={controlButtonStyle} title={t('Play')} onClick={() => togglePlay()}>
              {playing ? <FaPause /> : <FaPlay />}
            </button>
            <button type="button" style={controlButtonStyle} title={t('Next frame')} onClick={() => frameStep(1)}><FaStepForward /></button>

            <span style={{ fontFamily: 'monospace', fontSize: '.9em' }}>{currentTimeText} / {durationText}</span>

            <span style={{ opacity: 0.7, fontSize: '.85em' }}>{playbackRate}x</span>

            <button type="button" style={controlButtonStyle} title={t('Cut')} onClick={handleCut}><FaCut /></button>

            <button type="button" style={{ ...controlButtonStyle, marginLeft: 'auto' }} title={t('Toggle fullscreen')} onClick={toggleFullscreen}><FaExpand /></button>
          </div>
        )}
      </div>

      {isSourceView && <CutBar />}
    </div>
  );
}
