import { Suspense, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { enableMapSet } from 'immer';
import type * as ElectronRenderer from 'electron/renderer';
import type Remote from '@electron/remote';
import type path from 'node:path';
import type fs from 'node:fs';
import type fsPromises from 'node:fs/promises';
import type mimeTypes from 'mime-types';
import type i18nextFsBackend from 'i18next-fs-backend';
import type cueParser from 'cue-parser';

import '@fontsource/open-sans/300.css';
import '@fontsource/open-sans/300-italic.css';
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/400-italic.css';
import '@fontsource/open-sans/500.css';
import '@fontsource/open-sans/500-italic.css';
import '@fontsource/open-sans/600.css';
import '@fontsource/open-sans/600-italic.css';
import '@fontsource/open-sans/700.css';
import '@fontsource/open-sans/700-italic.css';
import '@fontsource/open-sans/800.css';
import '@fontsource/open-sans/800-italic.css';

import '@radix-ui/themes/styles.css';

import type { KeyboardLayoutMap } from './types';
import { patchInspectQueryParam, patchMergedQueryParam, patchPlayerQueryParam } from '../../common/features/patchPlayer';
import { patchDetachableWindowQueryParam } from '../../common/features/patchDeletable';
import AppRoot from './features/patch/AppRoot';
import PatchDetachableCheckApp from './features/patchDeletable/PatchDetachableCheckApp';
import ErrorBoundary from './ErrorBoundary';
import './i18n';

import type { RemoteApiLegacy } from '../../main';

import './main.css';
import './swal2.scss';


/* eslint-disable @stylistic/operator-linebreak, @stylistic/indent -- chained conditional types read best like this */
type TypedRemote = Omit<typeof Remote, 'require'> & {
  require: <T extends string>(module: T) => (
    T extends './index.js' ? RemoteApiLegacy :
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any
  );
};

declare global {
  interface Window {
    require: <T extends string>(module: T) => (
      T extends '@electron/remote' ? TypedRemote :
      T extends 'electron' ? typeof ElectronRenderer :
      T extends 'node:path' ? typeof path :
      T extends 'node:fs' ? typeof fs :
      T extends 'node:fs/promises' ? typeof fsPromises :
      T extends 'mime-types' ? typeof mimeTypes :
      T extends 'i18next-fs-backend' ? typeof i18nextFsBackend :
      T extends 'cue-parser' ? typeof cueParser :
      never
    );
    /* eslint-enable @stylistic/operator-linebreak, @stylistic/indent */
  }
  interface Navigator {
    keyboard: {
      getLayoutMap: () => Promise<KeyboardLayoutMap>;
    }
  }
}


enableMapSet();

const { app } = window.require('@electron/remote');

console.log('Version', app.getVersion());


const container = document.getElementById('root')!;
const root = createRoot(container);

// patch: the results windows are opened with `?patchPlayer=1` (see main/features/patchPlayer). They
// run the same app in `playerMode` instead of a separate player UI. The merged-result window adds
// `?patchMerged=1`: it plays one file and has no merge key. The check player adds `?patchInspect=1`:
// it plays the source the detached-source check double-clicked and never claims a result.
const searchParams = new URLSearchParams(window.location.search);
const isPatchPlayerWindow = searchParams.get(patchPlayerQueryParam) === '1';
const isPatchMergedWindow = isPatchPlayerWindow && searchParams.get(patchMergedQueryParam) === '1';
const isPatchInspectWindow = isPatchPlayerWindow && searchParams.get(patchInspectQueryParam) === '1';
// patch: the detached-source check is a window of its own with its own UI (not the player app).
const isPatchDetachableCheckWindow = searchParams.get(patchDetachableWindowQueryParam) === '1';

root.render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<div />}>
        {isPatchDetachableCheckWindow
          ? <PatchDetachableCheckApp />
          : <AppRoot playerMode={isPatchPlayerWindow} mergedMode={isPatchMergedWindow} inspectMode={isPatchInspectWindow} />}
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
);
