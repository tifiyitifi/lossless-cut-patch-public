import type { FunctionComponent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import i18n from 'i18next';
import { Theme } from '@radix-ui/themes';
import { DockviewReact, themeDark, themeLight } from 'dockview-react';
import type { DockviewApi, DockviewReadyEvent, IDockviewPanelProps } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';

import SwalContainer from '../../components/SwalContainer';
import getSwal from '../../swal';
import KeyGuidePanel from './panels/KeyGuidePanel';
import MergePreviewPanel from './panels/MergePreviewPanel';
import PlayerPanel from './panels/PlayerPanel';
import SegmentsPanel from './panels/SegmentsPanel';
import VideoListPanel from './panels/VideoListPanel';
import ViewSwitchOverlay from './panels/ViewSwitchOverlay';
import FileOperationDialog from './panels/FileOperationDialog';
import WorkDirPanel from './panels/WorkDirPanel';
import CommandPalette from './console/CommandPalette';
import ConsolePanel from './console/ConsolePanel';
import KeyBindingEditor from './keyboard/KeyBindingEditor';
import PatchKeyboard from './keyboard/PatchKeyboard';
import patchConfig from './patchConfigApi';
import { patchLayoutVersion, planDefaultLayout, getAdjacentPanel } from '../../../../common/features/patchData';
import type { PatchLayoutPanelId, PatchFileOperation, PatchPanelDirection } from '../../../../common/features/patchData';
import PatchSessionProvider from './session/PatchSessionProvider';
import PatchSettingsDialog from './settings/PatchSettingsDialog';
import PatchSettingsProvider from './settings/PatchSettingsProvider';
import { PatchUiContext, usePatchUi } from './ui/patchUiContext';
import type { PatchUiValue } from './ui/patchUiContext';
import useSharedDarkMode from './useSharedDarkMode';

/** All panels in focus-cycle order (Tab / Shift+Tab). */
const patchPanelIds = ['workDir', 'videoList', 'keyGuide', 'player', 'console', 'segments', 'mergePreview'] as const;
/** Panels reachable with Alt+1..6. */
const patchFocusPanelIds = patchPanelIds.slice(0, 6);

const { ipcRenderer } = window.require('electron');

/** Draws a focus ring around the panel that currently owns the keyboard. */
function withFocusRing(Component: FunctionComponent): FunctionComponent<IDockviewPanelProps> {
  function FocusRingPanel({ api }: IDockviewPanelProps) {
    const { focusedPanelId } = usePatchUi();
    const focused = focusedPanelId === api.id;
    return (
      <div
        data-patch-panel={api.id}
        tabIndex={-1}
        style={{ height: '100%', outline: focused ? '3px solid var(--accent-9)' : undefined, outlineOffset: '-3px' }}
      >
        <Component />
      </div>
    );
  }
  return FocusRingPanel;
}

const components: Record<PatchLayoutPanelId, FunctionComponent<IDockviewPanelProps>> = {
  workDir: withFocusRing(WorkDirPanel),
  videoList: withFocusRing(VideoListPanel),
  keyGuide: withFocusRing(KeyGuidePanel),
  player: withFocusRing(PlayerPanel),
  console: withFocusRing(ConsolePanel),
  segments: withFocusRing(SegmentsPanel),
  mergePreview: withFocusRing(MergePreviewPanel),
};

const panelTitles: Record<PatchLayoutPanelId, string> = {
  workDir: i18n.t('Working directory'),
  videoList: i18n.t('Video list'),
  keyGuide: i18n.t('Shortcut guide'),
  player: i18n.t('Player and cut timeline'),
  console: i18n.t('Command console'),
  segments: i18n.t('Segments / playlist'),
  mergePreview: i18n.t('Merge preview'),
};

type SerializedLayout = ReturnType<DockviewApi['toJSON']>;

/**
 * Build the default three-column layout (used on first run and when the layout is reset).
 *
 * The structure (which panel is added in which order, and with which sizes) lives in the pure
 * `planDefaultLayout` so the dockview ordering rules are covered by unit tests: dockview only honours
 * a size when a panel is added *relative to another* panel, the first panel fills the window, and a
 * new row takes its height from the reference row.
 */
function buildDefaultLayout(api: DockviewApi) {
  for (const spec of planDefaultLayout(api.width, api.height)) {
    api.addPanel({
      id: spec.id,
      component: spec.id,
      title: panelTitles[spec.id],
      ...(spec.position != null ? { position: spec.position } : {}),
      ...(spec.initialWidth != null ? { initialWidth: spec.initialWidth } : {}),
      ...(spec.initialHeight != null ? { initialHeight: spec.initialHeight } : {}),
    });
  }

  api.getPanel('player')?.api.setActive();
}

/** Patch-mode root UI: three columns in a dockable layout. */
export default function PatchApp() {
  const darkMode = useSharedDarkMode();
  const [dockviewApi, setDockviewApi] = useState<DockviewApi>();
  const [focusedPanelId, setFocusedPanelId] = useState<string>();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [keyBindingsOpen, setKeyBindingsOpen] = useState(false);
  const [viewOverlayOpen, setViewOverlayOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fileOperation, setFileOperation] = useState<PatchFileOperation>();

  const handleReady = useCallback((event: DockviewReadyEvent) => {
    const { api } = event;
    setDockviewApi(api);

    // Restore a saved layout when there is one *and* it was saved with the current default-layout
    // version; otherwise rebuild, so layout changes in the app take effect without a manual reset.
    const { layout, layoutVersion } = patchConfig.getPatchSettings();
    if (layout != null && layoutVersion === patchLayoutVersion) {
      try {
        api.fromJSON(layout as SerializedLayout);
        return;
      } catch (err) {
        console.warn('Failed to restore the saved patch layout, rebuilding the default one', err);
      }
    }
    buildDefaultLayout(api);
  }, []);

  const saveLayout = useCallback(() => {
    if (dockviewApi == null) return;
    patchConfig.setPatchSetting('layout', dockviewApi.toJSON());
    patchConfig.setPatchSetting('layoutVersion', patchLayoutVersion);
    getSwal().toast.fire({ icon: 'success', text: i18n.t('Layout saved') });
  }, [dockviewApi]);

  const resetLayout = useCallback(() => {
    patchConfig.setPatchSetting('layout', undefined);
    if (dockviewApi == null) return;
    dockviewApi.clear();
    buildDefaultLayout(dockviewApi);
  }, [dockviewApi]);

  const focusPanel = useCallback((id: string) => {
    dockviewApi?.getPanel(id)?.api.setActive();
    setFocusedPanelId(id);
    // Move the real DOM focus into the panel so Tab can reach its controls (see the Tab handler).
    document.querySelector<HTMLElement>(`[data-patch-panel="${id}"]`)?.focus();
  }, [dockviewApi]);

  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const openKeyBindings = useCallback(() => setKeyBindingsOpen(true), []);
  const closeKeyBindings = useCallback(() => setKeyBindingsOpen(false), []);
  const openViewOverlay = useCallback(() => setViewOverlayOpen(true), []);
  const closeViewOverlay = useCallback(() => setViewOverlayOpen(false), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openFileOperation = useCallback((operation: PatchFileOperation) => setFileOperation(operation), []);
  const closeFileOperation = useCallback(() => setFileOperation(undefined), []);

  const uiValue = useMemo<PatchUiValue>(() => ({
    focusedPanelId,
    focusPanel,
    viewOverlayOpen,
    openViewOverlay,
    closeViewOverlay,
    fileOperation,
    openFileOperation,
    closeFileOperation,
  }), [closeFileOperation, closeViewOverlay, fileOperation, focusPanel, focusedPanelId, openFileOperation, openViewOverlay, viewOverlayOpen]);

  // Track the dockview active panel so Alt+1..6 / Tab cycling knows where we are.
  useEffect(() => {
    if (dockviewApi == null) return undefined;
    const disposable = dockviewApi.onDidActivePanelChange((event) => setFocusedPanelId(event.panel?.id));
    return () => disposable.dispose();
  }, [dockviewApi]);

  // Commands from the app menu (`Mode`), which is where patch mode keeps its rarely used entries.
  useEffect(() => {
    const onMenuCommand = (_event: unknown, command: unknown) => {
      switch (command) {
        case 'key-bindings': { openKeyBindings(); break; }
        case 'save-layout': { saveLayout(); break; }
        case 'reset-layout': { resetLayout(); break; }
        case 'settings': { openSettings(); break; }
        default: { break; }
      }
    };
    ipcRenderer.on('patchMenuCommand', onMenuCommand);
    return () => { ipcRenderer.off('patchMenuCommand', onMenuCommand); };
  }, [openKeyBindings, openSettings, resetLayout, saveLayout]);

  // App-level UI keys: command palette (anywhere), `:` console, Alt+1..6 focus, Tab cycle, Esc home.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { key, target } = event;

      // The command palette is reachable from anywhere, including while typing.
      if (event.ctrlKey && event.shiftKey && key.toLowerCase() === 'p') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
        return;
      }

      // Alt combinations never type text, so panel navigation still works while typing.
      if (!event.altKey && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
      if (target instanceof HTMLElement && target.isContentEditable) return;
      if (event.ctrlKey || event.metaKey) return;

      if (event.altKey) {
        if (/^[1-6]$/.test(key)) {
          event.preventDefault();
          const id = patchFocusPanelIds[Number(key) - 1];
          if (id != null) focusPanel(id);
          return;
        }

        // Alt+Arrow moves to the visually adjacent panel (left/right cross columns, up/down
        // walk within a column). A no-op at the layout edges.
        const directions: Record<string, PatchPanelDirection> = {
          ArrowUp: 'up',
          ArrowDown: 'down',
          ArrowLeft: 'left',
          ArrowRight: 'right',
        };
        const direction = directions[key];
        if (direction != null && focusedPanelId != null) {
          const next = getAdjacentPanel(focusedPanelId as PatchLayoutPanelId, direction);
          if (next != null) {
            event.preventDefault();
            focusPanel(next);
          }
        }
        return;
      }

      // Don't hijack navigation while a dialog is open.
      if (document.querySelector('[role="dialog"],[role="alertdialog"]') != null) return;

      // `:` jumps to the command console.
      if (key === ':') {
        event.preventDefault();
        focusPanel('console');
        return;
      }

      if (key === 'Tab') {
        // Once the focus is inside the active panel (it is parked on the panel wrapper by
        // `focusPanel`), let the browser walk the panel's own buttons instead of switching panels.
        const panelElement = focusedPanelId != null ? document.querySelector(`[data-patch-panel="${focusedPanelId}"]`) : null;
        const { activeElement } = document;
        if (panelElement != null && activeElement != null && panelElement.contains(activeElement)) return;

        event.preventDefault();
        const currentIndex = focusedPanelId != null ? patchPanelIds.indexOf(focusedPanelId as typeof patchPanelIds[number]) : -1;
        const direction = event.shiftKey ? -1 : 1;
        const nextIndex = (currentIndex + direction + patchPanelIds.length) % patchPanelIds.length;
        const id = patchPanelIds[nextIndex];
        if (id != null) focusPanel(id);
        return;
      }

      if (key === 'Escape') focusPanel('player');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusPanel, focusedPanelId]);

  return (
    <Theme appearance={darkMode ? 'dark' : 'light'} accentColor="cyan">
      <div id="app-root" className={darkMode ? 'dark-theme' : undefined} style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--gray-1)', color: 'var(--gray-12)' }}>
        <div style={{ flexGrow: 1, minHeight: 0 }}>
          <PatchSettingsProvider>
            <PatchUiContext.Provider value={uiValue}>
              <PatchSessionProvider>
                <PatchKeyboard />
                <DockviewReact
                  components={components}
                  onReady={handleReady}
                  theme={darkMode ? themeDark : themeLight}
                />
                {paletteOpen && <CommandPalette onClose={closePalette} />}
                {keyBindingsOpen && <KeyBindingEditor onClose={closeKeyBindings} />}
                {viewOverlayOpen && <ViewSwitchOverlay onClose={closeViewOverlay} />}
                <PatchSettingsDialog open={settingsOpen} onClose={closeSettings} />
                {fileOperation != null && <FileOperationDialog operation={fileOperation} onClose={closeFileOperation} />}
              </PatchSessionProvider>
            </PatchUiContext.Provider>
          </PatchSettingsProvider>
        </div>

        {/* Patch mode has to mount the swal wrapper itself: upstream only renders it in base mode, so
            every `getSwal().toast.fire(...)` (Exporting / Merged / post-processing…) was invisible. */}
        <SwalContainer darkMode={darkMode} />
      </div>
    </Theme>
  );
}
