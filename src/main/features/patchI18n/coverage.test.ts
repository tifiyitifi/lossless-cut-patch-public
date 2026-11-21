import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, it } from 'vitest';

import {
  extractTKeys, findMissingTranslations, findPlaceholderMismatches,
} from '../../../common/features/patchI18n/coverage.js';

const root = process.cwd();

function readJson(rel: string): Record<string, string> {
  return JSON.parse(readFileSync(join(root, rel), 'utf8')) as Record<string, string>;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

// Fork-owned feature slices are scanned automatically; upstream files
// (`App.tsx`, `Settings.tsx`, …) are not scanned whole because they also
// carry upstream strings that are missing in Chinese upstream. Their
// fork-added keys are listed in `SEAM_KEYS`; add new seams here.
function forkFeatureFiles(): string[] {
  const files: string[] = [];
  const featureRoots = [
    'src/renderer/src/features',
    'src/main/features',
    'src/common/features',
  ];
  for (const base of featureRoots) {
    const dir = join(root, base);
    for (const name of readdirSync(dir)) {
      if ((name.startsWith('patch') && name !== 'patchLegacy') || name === 'damagedSource' || name === 'timecodeInput' || name === 'updater') {
        files.push(...walk(join(dir, name)));
      }
    }
  }
  return [...new Set(files)];
}

/**
Keys the extractor cannot see, so they are listed by hand.

Besides the literals in upstream files (`App.tsx`, …), a key can reach the translation call
through a helper: `sourceStatusKey`, `folderKey`, `groupTitleKey` and `messageTextKey` in
`PatchWorkFoldersDialog.tsx` all return a key that the caller passes on. Both `i18next-cli extract`
and `extractTKeys` only read string literals, so renaming a key inside such a helper silently drops
it from `en` while the zh files keep the old one. When changing one of those helpers, change the
literal here too - or, better, pass a literal at the call site (as `Matched by file name` does).
Their `{{count}}` variants are plural keys (`_one` / `_other`).
*/
const SEAM_KEYS = [
  'Work folders and results...',
  'Known issues',
  'Repair',
  'Unlock cutting',
  'Check for updates from GitHub...',
  'Are you sure you want to clear the source file list?',
  'A finish job is moving files. Wait for it to finish.',
  'Close the finish dialog before exporting.',
  'Another window is using this work folder. Wait for its export to finish.',
  'Some cut results are being played in another window. Stop them there first.',
  'The cut list was changed during the export. The results match the cut list from when the export started.',
  'This video is already open in another window',
  'Close it there first.',
  'Clear the source file list',
  // Fork guards and notices inside the upstream export flow (`App.tsx`).
  'Select at least one segment to export.',
  'The merge order was saved. The clips were not cut again.',
  'The merged file name belongs to a file this app did not write. Remove it or allow replacing it.',
  'The merged result to rename is missing',
  'Renamed the merged result',
  'Cutting is unlocked.',
  'This video is stored with broken frame timing. The video of each clip will be re-encoded, so the clips are correct in every player, but they are no longer lossless. The audio is copied without loss.',
  'This video is stored with broken frame timing and the repair is turned off, so the clips will keep jumping here (and in Chrome or Edge) even though they look fine in VLC.',
  'Repair this damaged video by re-encoding it:',
  'Damaged source videos',
  'Repair playback of a damaged source',
  'Some files are stored in a way that the built-in player cannot show correctly: the picture keeps jumping back a frame. Repairing plays them through FFmpeg instead, which converts the picture while you watch. Turn it off to see the file exactly as it is stored.',
  'Playback repair quality',
  'Smoothest playback (800 pixels wide)',
  'Original resolution (more CPU)',
  'Repair exported clips of a damaged source by re-encoding the video',
  'A lossless copy keeps the problem, so the clips would keep jumping here (and in Chrome or Edge) even though they look fine in VLC. Repairing re-encodes the video of every clip, at full resolution, so the clips are correct everywhere. The audio is still copied without loss. Only the parts you actually cut are encoded, so this costs a few seconds per clip, not a re-encode of the whole file.',
  'Ctrl+Delete discards the video: it moves to the waiting-for-deletion folder and the next one opens.',
  'Ask before clearing the source file list',
  'The file list can be cleared from its right-click menu. Clearing removes the rows only: the open video and its results stay.',
  'Skip and move this video (to finished_skip_src)',
  'Next in point starts a new segment',
  // Returned from a switch and passed to t() by the caller, so the t() scan cannot see it.
  'Skipped',
  // Fork branches inside upstream files, chosen by a ternary or a conditional argument.
  'Wait for the current operation to finish.',
  'The next in point starts a new segment.',
  'The in point moves the current segment again.',
  'The pieces of this clip cannot be joined: the file "{{file}}" has no {{type}} track. Export again; if it keeps happening, set "Cut points when merging" to C — no re-encode.',
  'The pieces of this clip cannot be joined: the tracks of the file "{{file}}" do not match the rest of the clip. Export again; if it keeps happening, set "Cut points when merging" to C — no re-encode.',
  'Smoothest playback keeps up on slower computers but shows a smaller picture (800 pixels wide). Original resolution is as sharp as the file itself but needs a fast CPU. You can switch it while watching, from the wrench button under the timeline or Tools → Repair.',
  // Fork sentences inside the upstream export flow (`ExportConfirm.tsx` / `App.tsx`). One is longer
  // than the literal scanner's old length limit, so it is listed here rather than relying on a cap.
  'Why reordering can re-cut clips',
  'Reordering clips is not always a pure rename. A lossless cut is exclusive at its end: the frame sitting exactly at the cut point is left out. For a clip in the middle that\'s fine, because the next clip starts there and supplies that frame. The last clip in the export order has nothing after it, so it keeps the frame at its cut end and the merged video does not lose it. A swap that changes which clip is last therefore cuts that clip again; the rest are reused or renamed, and the merge is just a fast stream copy. A clip that reaches the end of the source is always extended to the real end, whatever its position in the order, so that extension never causes a re-cut. Your cut points and times are unchanged.',
];

const TRANS_KEYS = [
  'One piece of a clip came out without the track it should contain, so the pieces could not be joined.',
  'This happens when a clip starts within one frame of a keyframe, or when the source is damaged at that point.',
  'Export again. If it keeps happening, set <1>Cut points when merging</1> to <3>C — no re-encode</3>, which cuts every clip in one pass.',
  'Press <1></1> and <3></3> to set the in and out points, then step frame by frame with <5></5> and <7></7> to cut precisely.',
  'Press <1></1> to make the next in point start a new segment instead of moving the current one. The arm is used up by that press.',
  '<0></0> does not delete a video: it moves it into detached_src_media and opens the next one. At the moment the app does not delete it on its own; it goes for good only when you delete it in the deletion check (if a kept result of it is on disk) or in the file manager.',
  'Ctrl+E captures a snapshot; Ctrl+Delete discards the video: it moves it to the waiting-for-deletion folder and opens the next one. <1></1> finishes the job with the source moving to finished_skip_src instead.',
];

describe('patchI18n/coverage', () => {
  it('extracts t() keys while skipping it() and variables', () => {
    expect(extractTKeys("t('Hello')")).toEqual(['Hello']);
    expect(extractTKeys("it('not a key', () => {})")).toEqual([]);
    expect(extractTKeys('t(key)')).toEqual([]);
    expect(extractTKeys('i18n.t("World")')).toEqual(['World']);
  });

  it('finds missing keys with plural expansion', () => {
    const en = { 'A {{n}}': 'A {{n}}', B: 'B', C_one: 'C', C_other: 'C' };
    const zh = { 'A {{n}}': '甲 {{n}}' };
    expect(findMissingTranslations(['A {{n}}', 'B', 'C', 'Dynamic'], en, zh)).toEqual(['B', 'C']);
  });

  it('flags placeholder mismatches', () => {
    const en = { 'A {{n}}': 'A {{n}}' };
    expect(findPlaceholderMismatches(['A {{n}}'], en, { 'A {{n}}': '甲' })).toEqual(['A {{n}}']);
  });

  it('extracts a long single-line key instead of dropping it', () => {
    const long = 'x'.repeat(700);
    expect(extractTKeys(`t('${long}')`)).toEqual([long]);
  });

  it('flags a <Trans> tag mismatch', () => {
    const key = 'A <0></0> and <1></1>';
    expect(findPlaceholderMismatches([key], { [key]: key }, { [key]: '甲 <0></0>' })).toEqual([key]);
    expect(findPlaceholderMismatches([key], { [key]: key }, { [key]: '甲 <1></1><0></0>' })).toEqual([]);
  });

  it('every fork feature t() key, seam key and Trans key is in zh_Hans and zh_Hant', () => {
    const en = readJson('locales/en/translation.json');
    const hans = readJson('locales/zh_Hans/translation.json');
    const hant = readJson('locales/zh_Hant/translation.json');
    const keys = new Set<string>([...SEAM_KEYS, ...TRANS_KEYS]);
    for (const file of forkFeatureFiles()) {
      for (const key of extractTKeys(readFileSync(file, 'utf8'))) {
        keys.add(key);
      }
    }
    const forkKeys = [...keys].filter((k) => k in en);
    expect(findMissingTranslations(forkKeys, en, hans)).toEqual([]);
    expect(findMissingTranslations(forkKeys, en, hant)).toEqual([]);
    expect(findPlaceholderMismatches(forkKeys, en, hans)).toEqual([]);
    expect(findPlaceholderMismatches(forkKeys, en, hant)).toEqual([]);
    // Reading every fork file synchronously can outlast the 5s default on a loaded CI runner.
  }, 30_000);

  it('every key that carries a <Trans> placeholder is in zh_Hans and zh_Hant', () => {
    // `<Trans>` keys never reach `extractTKeys`, so a fork sentence could lose its Chinese and no
    // test would notice. A `<Trans>` key always carries numbered placeholders (`<0></0>`, ...), which
    // makes the whole class checkable without listing each sentence by hand.
    const en = readJson('locales/en/translation.json');
    const hans = readJson('locales/zh_Hans/translation.json');
    const hant = readJson('locales/zh_Hant/translation.json');
    const keys = Object.keys(en).filter((key) => /<\d+>/.test(key));
    expect(findMissingTranslations(keys, en, hans)).toEqual([]);
    expect(findMissingTranslations(keys, en, hant)).toEqual([]);
    expect(findPlaceholderMismatches(keys, en, hans)).toEqual([]);
    expect(findPlaceholderMismatches(keys, en, hant)).toEqual([]);
  });
});
