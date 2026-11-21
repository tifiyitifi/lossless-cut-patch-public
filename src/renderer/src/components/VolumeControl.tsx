import type { ChangeEventHandler } from 'react';
import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { FaVolumeMute, FaVolumeUp } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';

import useActionTitle from '../hooks/useActionTitle';


function VolumeControl({ playbackVolume, setPlaybackVolume, onToggleMutedClick, revealOnVolumeChange = false }: {
  playbackVolume: number,
  setPlaybackVolume: (a: number) => void,
  onToggleMutedClick: () => void,
  // patch: reveal the slider when the volume changes from the keyboard or the wheel.
  revealOnVolumeChange?: boolean,
}) {
  const [volumeControlVisible, setVolumeControlVisible] = useState(false);
  const timeoutRef = useRef<number>(undefined);
  // patch: the volume from the previous render, so only an actual change reveals the slider.
  const previousPlaybackVolumeRef = useRef(playbackVolume);
  const { t } = useTranslation();
  const actionTitle = useActionTitle();

  // patch: a volume change made outside the slider reveals it; the timer below hides it again.
  useEffect(() => {
    const changed = previousPlaybackVolumeRef.current !== playbackVolume;
    previousPlaybackVolumeRef.current = playbackVolume;
    if (changed && revealOnVolumeChange) setVolumeControlVisible(true);
  }, [playbackVolume, revealOnVolumeChange]);

  useEffect(() => {
    const clear = () => clearTimeout(timeoutRef.current);
    clear();
    timeoutRef.current = window.setTimeout(() => setVolumeControlVisible(false), 4000);
    return () => clear();
  }, [playbackVolume, volumeControlVisible]);

  const onVolumeChange = useCallback<ChangeEventHandler<HTMLInputElement>>((e) => {
    e.target.blur();
    setPlaybackVolume(Number(e.target.value) / 100);
  }, [setPlaybackVolume]);

  const onVolumeIconClick = useCallback(() => {
    if (volumeControlVisible) {
      onToggleMutedClick();
    } else {
      setVolumeControlVisible(true);
    }
  }, [onToggleMutedClick, volumeControlVisible]);

  const VolumeIcon = playbackVolume === 0 ? FaVolumeMute : FaVolumeUp;

  return (
    <>
      {volumeControlVisible && (
        <input
          type="range"
          min={0}
          max={100}
          value={playbackVolume * 100}
          style={{ height: 30 }}
          onChange={onVolumeChange}
        />
      )}

      <VolumeIcon
        title={actionTitle(t('Mute preview? (will not affect output)'), 'toggleMuted')}
        size={30}
        role="button"
        style={{ margin: '0 7px', color: 'var(--gray-12)', opacity: 0.7 }}
        onClick={onVolumeIconClick}
      />
    </>
  );
}

export default memo(VolumeControl);
