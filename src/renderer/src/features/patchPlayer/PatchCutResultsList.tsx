import { memo, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';

import type { PatchCutResultEntry } from '../../../../common/features/patchPlayer';
import { controlsBackground, darkModeTransition } from '../../colors';
import useUserSettings from '../../hooks/useUserSettings';

import PatchCutResultRow from './PatchCutResultRow';

/**
The cut-results playlist of the player window (fork-owned).

Deliberately not the upstream `BatchFilesList`: the results are a fixed, ordered playlist with
no remove / reorder / merge, its own labels, and clicking a row plays it. The list is replaced
whenever a new export finishes (see `usePatchPlayerPlaylist`).

The check player's list also carries groups: every source starts a header, followed by its results,
so "which source is this result from" reads without opening the check window. The other windows
never set `group`, so their list is unchanged.
*/
function PatchCutResultsList({ entries, currentPath, width, onSelect, title, others, othersTitle, onSelectOther, missingPaths }: {
  entries: readonly PatchCutResultEntry[],
  currentPath: string | undefined,
  width: number,
  onSelect: (entry: PatchCutResultEntry) => void,
  /** The list title; the merged-result window shows the merged file instead of the cut results. */
  title?: string | undefined,
  /** Other videos of the work folder, shown in a collapsible section below the playlist. */
  others?: readonly string[] | undefined,
  othersTitle?: string | undefined,
  onSelectOther?: ((path: string) => void) | undefined,
  /** Paths another window moved or renamed away (`useResultFilesExist`): shown, not playable. */
  missingPaths?: ReadonlySet<string> | undefined,
}) {
  const { t } = useTranslation();
  const { springAnimation } = useUserSettings();
  const currentRef = useRef<HTMLDivElement | null>(null);

  // How many entries each group has: the header says it, so a source with ten results does not look
  // like a source with one when the list is scrolled.
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      if (entry.group == null) continue;
      counts.set(entry.group, (counts.get(entry.group) ?? 0) + 1);
    }
    return counts;
  }, [entries]);

  // Keep the playing result visible when the playlist is replaced or the player advances.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentPath]);

  return (
    <motion.div
      className="no-user-select"
      style={{ width, background: controlsBackground, color: 'var(--gray-12)', borderRight: '1px solid var(--gray-7)', transition: darkModeTransition, display: 'flex', flexDirection: 'column', overflowY: 'hidden', overflowX: 'hidden' }}
      initial={{ x: -width }}
      animate={{ x: 0 }}
      exit={{ x: -width }}
      transition={springAnimation}
    >
      <div style={{ paddingBottom: '.5em', paddingTop: 0, paddingLeft: '.5em', fontSize: '.8em' }}>
        {title ?? t('Cut results ({{count}})', { count: entries.length })}
      </div>

      <div style={{ overflowX: 'hidden', overflowY: 'auto' }}>
        {entries.map((entry, index) => {
          const isCurrent = entry.path === currentPath;
          const startsGroup = entry.group != null && entry.group !== entries[index - 1]?.group;
          return (
            <div key={entry.path}>
              {startsGroup && (
                <div
                  title={entry.group}
                  style={{
                    fontSize: '.8em',
                    color: 'var(--gray-11)',
                    fontWeight: 600,
                    padding: '.45em .5em .1em',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {t('{{group}} ({{count}})', { group: entry.group, count: groupCounts.get(entry.group ?? '') ?? 0 })}
                </div>
              )}
              <PatchCutResultRow
                entry={entry}
                index={index}
                isCurrent={isCurrent}
                missing={missingPaths?.has(entry.path)}
                onSelect={onSelect}
                currentRef={isCurrent ? currentRef : undefined}
              />
            </div>
          );
        })}
        {others != null && others.length > 0 && (
          <details style={{ marginTop: '.4em' }}>
            <summary style={{ fontSize: '.8em', paddingLeft: '.5em', cursor: 'pointer' }}>
              {othersTitle ?? t('Other videos ({{count}})', { count: others.length })}
            </summary>
            {others.map((path, index) => {
              const isCurrent = path === currentPath;
              return (
                <PatchCutResultRow
                  key={path}
                  entry={{ path }}
                  index={index}
                  isCurrent={isCurrent}
                  missing={missingPaths?.has(path)}
                  onSelect={(entry) => onSelectOther?.(entry.path)}
                  currentRef={undefined}
                />
              );
            })}
          </details>
        )}
      </div>
    </motion.div>
  );
}

export default memo(PatchCutResultsList);
