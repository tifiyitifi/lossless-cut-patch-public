import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useDebounce } from 'use-debounce';
import isEqual from 'lodash/isEqual';

import isDev from '../isDev';
import { saveLlcProject } from '../edlStore';
import { mapSaveableSegments } from '../segments';
import { getSuffixedOutPath } from '../util';
import type { StateSegment } from '../types';
import type { LlcTimeFormat } from '../../../common/features/patchData/llcTime';
import { shouldSuppressProjectSave } from '../../../common/features/patchWork';
import type { ProjectSaveSuppression } from '../../../common/features/patchWork';
import { errorToast } from '../swal';
import i18n from '../i18n';


export default ({ autoSaveProjectFile, storeProjectInWorkingDir, filePath, customOutDir, cutSegments, llcTimeFormat, suppressedProjectSave }: {
  autoSaveProjectFile: boolean,
  storeProjectInWorkingDir: boolean,
  filePath: string | undefined,
  customOutDir: string | undefined,
  cutSegments: StateSegment[],
  // patch: how the project file stores its times; part of the save key so switching it rewrites the file.
  llcTimeFormat: LlcTimeFormat,
  /**
  patch: a cut list that was read from the video's own name (`a.llc`) instead of `<video>-proj.llc`.

  The app cannot own that file, so writing the canonical name just because the video was opened
  would create a second project file. The hold is only for the content that was read; the caller
  clears it with the next file, and any changed cut list or forced save bypasses it (see
  `shouldSuppressProjectSave`).
  */
  suppressedProjectSave?: ProjectSaveSuppression | undefined,
}) => {
  const projectSuffix = 'proj.llc';
  // New LLC format can be stored along with input file or in working dir (customOutDir)
  const getEdlFilePath = useCallback((fp?: string, cod?: string) => getSuffixedOutPath({ customOutDir: cod, filePath: fp, nameSuffix: projectSuffix }), []);
  const getProjectFileSavePath = useCallback((storeProjectInWorkingDirIn: boolean) => getEdlFilePath(filePath, storeProjectInWorkingDirIn ? customOutDir : undefined), [getEdlFilePath, filePath, customOutDir]);
  const projectFileSavePath = useMemo(() => getProjectFileSavePath(storeProjectInWorkingDir), [getProjectFileSavePath, storeProjectInWorkingDir]);

  const currentSaveOperation = useMemo(() => {
    if (!projectFileSavePath) return undefined;
    return { cutSegments, projectFileSavePath, filePath, llcTimeFormat };
  }, [cutSegments, filePath, projectFileSavePath, llcTimeFormat]);

  // NOTE: Could lose a save if user closes too fast, but not a big issue I think
  const [debouncedSaveOperation] = useDebounce(currentSaveOperation, isDev ? 2000 : 500);

  // eslint-disable-next-line @eslint-react/naming-convention-ref-name -- TODO fix (new rule in @mifi/lint-config)
  const lastSaveOperation = useRef<typeof debouncedSaveOperation>(undefined);

  // patch: the content the held save belongs to. Captured once per hold (when the object changes),
  // so a later edit cannot move the baseline and quietly disable the save.
  const suppressionBaselineRef = useRef<{ suppression: ProjectSaveSuppression, segments: StateSegment[] }>(undefined);
  // Which hold has already been captured: a save clears the baseline, and without this the next
  // edit would be captured as a new baseline (and suppressed) instead of being written.
  const capturedSuppressionRef = useRef<ProjectSaveSuppression>(undefined);

  useEffect(() => {
    if (suppressedProjectSave == null) {
      suppressionBaselineRef.current = undefined;
      capturedSuppressionRef.current = undefined;
      return;
    }
    if (capturedSuppressionRef.current === suppressedProjectSave) return;
    capturedSuppressionRef.current = suppressedProjectSave;
    suppressionBaselineRef.current = { suppression: suppressedProjectSave, segments: cutSegments };
  }, [cutSegments, suppressedProjectSave]);

  // patch: the save body is callable on demand (`flushSave`), so the finish flow can flush the
  // debounced save before the source video (and its `.llc`) is moved on disk. Otherwise the pending
  // save would recreate the project file at the old location afterwards.
  const saveOperation = useCallback(async (operation: typeof currentSaveOperation, { force = false }: { force?: boolean } = {}) => {
    try {
      if (!autoSaveProjectFile
        || operation?.filePath == null
        // Don't create llc file if no segments yet
        || operation.cutSegments.length === 0
        // or if initial segment (and not deselected): https://github.com/mifi/lossless-cut/issues/2745#issuecomment-3979480707
        || (operation.cutSegments[0]?.initial && operation.cutSegments[0].selected)
      ) {
        return;
      }

      // patch: opening a video whose cut list is named after it (`a.llc`) must not create
      // `a-proj.llc` as a side effect. Only that content, that file and that video qualify; any
      // change, any other media, a canonical name and every forced save go through untouched.
      const baseline = suppressionBaselineRef.current;
      if (!force && baseline != null && shouldSuppressProjectSave({
        suppression: baseline.suppression,
        filePath: operation.filePath,
        projectFileSavePath: operation.projectFileSavePath,
        segmentsEqual: isEqual(mapSaveableSegments(baseline.segments), mapSaveableSegments(operation.cutSegments)),
      })) {
        console.log('Holding back the auto-save of a cut list loaded from its own name', operation.projectFileSavePath);
        return;
      }

      if (lastSaveOperation.current && lastSaveOperation.current.projectFileSavePath === operation.projectFileSavePath && lastSaveOperation.current.llcTimeFormat === operation.llcTimeFormat && isEqual(mapSaveableSegments(lastSaveOperation.current.cutSegments), mapSaveableSegments(operation.cutSegments))) {
        console.log('Segments unchanged, skipping save');
        return;
      }

      console.log('Saving project file', operation.projectFileSavePath, operation.cutSegments);
      await saveLlcProject({ savePath: operation.projectFileSavePath, mediaFilePath: operation.filePath, cutSegments: operation.cutSegments, timeFormat: operation.llcTimeFormat });
      lastSaveOperation.current = operation;
      // patch: the hold covers the content that was read; a real save replaces it.
      suppressionBaselineRef.current = undefined;
    } catch (err) {
      errorToast(i18n.t('Unable to save project file'));
      console.error('Failed to save project file', err);
    }
  }, [autoSaveProjectFile]);

  useEffect(() => {
    saveOperation(debouncedSaveOperation);
  }, [debouncedSaveOperation, saveOperation]);

  /** Save the current segments now (and make the pending debounced save a no-op). */
  const flushSave = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    await saveOperation(currentSaveOperation, { force });
  }, [currentSaveOperation, saveOperation]);

  return {
    getEdlFilePath,
    projectFileSavePath,
    getProjectFileSavePath,
    flushSave,
  };
};
