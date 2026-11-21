import type { PatchOverview, PatchOverviewSource } from './groupResults.js';

/**
The files an overview is made of (fork-owned, pure).

The work-folders dialog shows a size and a duration per file, so the renderer needs the paths that
really exist on disk. Reading the overview itself would also give the paths the ledger remembers but
the disk does not (`missing`), and a `stat` or an FFprobe run on those is wasted work that can only
fail. The selection lives here, apart from the dialog, so it is tested without a DOM.

Only files the dialog can also reveal are returned: a source that is gone (its row is a read-only
"source gone" entry) is skipped, while its results stay - they are the reason the row exists. A path
appears once, even when a hand-copied file is both a source of one root and a result of another.
*/
export function collectOverviewFilePaths(overview: PatchOverview): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  const add = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    paths.push(path);
  };

  const addResults = (source: PatchOverviewSource) => {
    for (const entry of source.clips) add(entry.path);
    for (const entry of source.merged) add(entry.path);
    for (const entry of source.parkedClips) add(entry.path);
    for (const entry of source.parkedMerged) add(entry.path);
  };

  for (const source of overview.sources) {
    if (source.folder !== 'missing') add(source.path);
    addResults(source);
  }
  for (const entry of overview.unowned) add(entry.path);

  return paths;
}
