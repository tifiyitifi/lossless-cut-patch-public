/**
Suppressible patch-mode notices (pure logic).

A notice is an informational message the app shows on its own, without the user asking for
anything (the "Export is done!" dialog after an export). In a batch run the same message
appears once per file, so the user can silence it for good.

Only the *noise* may be silenced: a notice that carries a warning is a signal that the output
might be wrong, so it is never silenced (see `shouldShowExportFinishedNotice`).

The ids are stable strings, so the silenced list in `patch-config.json` survives renames of the
code around it.
*/

/** Every notice the user can silence, in the order the settings list shows them. */
export const patchNoticeIds = ['exportFinished', 'finishSummary'] as const;

/** The id of a suppressible notice. */
export type PatchNoticeId = (typeof patchNoticeIds)[number];

/** The "Export is done!" dialog shown after a successful export. */
export const patchNoticeExportFinished = 'exportFinished' satisfies PatchNoticeId;

/**
The summary shown after a finish job (`Shift+E`, "The job is finished").

Unlike the export-finished notice its "do not show this again" box starts ticked: the summary is
the last step of a workflow the user already confirmed in the dialog, so a batch run would
otherwise end every file with a click.
*/
export const patchNoticeFinishSummary = 'finishSummary' satisfies PatchNoticeId;

/** Is this notice silenced? */
export function isNoticeSuppressed(suppressed: readonly string[], id: PatchNoticeId) {
  return suppressed.includes(id);
}

/** Silence a notice. Idempotent, and it does not change the given list. */
export function suppressNotice(suppressed: readonly string[], id: PatchNoticeId): string[] {
  if (isNoticeSuppressed(suppressed, id)) return [...suppressed];
  return [...suppressed, id];
}

/** Un-silence a notice. Idempotent, and it does not change the given list. */
export function unsuppressNotice(suppressed: readonly string[], id: PatchNoticeId): string[] {
  return suppressed.filter((entry) => entry !== id);
}

/**
Should the export-finished notice be shown?

A warning (a HEVC quirk, a blocked overwrite, a name clash) can mean the output is wrong, so the
notice is never silenced: it shows every time until the problem is gone. Only the clean "it
worked" case can be silenced.
*/
export function shouldShowExportFinishedNotice({ suppressed, hasWarnings }: { suppressed: readonly string[], hasWarnings: boolean }) {
  if (hasWarnings) return true;
  return !isNoticeSuppressed(suppressed, patchNoticeExportFinished);
}

/**
Should the finish summary be shown?

A job that did not fully succeed (or that carries a warning) is always reported: the user has to
know which file was left behind. Only the clean "it worked" summary can be silenced, and its box
starts ticked - see `patchNoticeFinishSummary`.
*/
export function shouldShowFinishSummaryNotice({ suppressed, ok, hasWarnings }: { suppressed: readonly string[], ok: boolean, hasWarnings: boolean }) {
  if (!ok || hasWarnings) return true;
  return !isNoticeSuppressed(suppressed, patchNoticeFinishSummary);
}
