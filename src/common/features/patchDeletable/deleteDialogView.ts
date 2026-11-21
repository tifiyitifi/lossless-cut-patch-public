/**
How the permanent-delete confirmation shows the files it is about to remove (fork-owned).

The dialog lists exactly the sources that will be deleted - the selected ones in
`detached_src_media` that the fresh report calls deletable (a kept result on disk by default, plus
the extra kinds the user allowed in the deletion settings). A small thumbnail is the fastest way to
recognise "is this the file I mean", so the default is a grid; the list is there for many files or a
narrow dialog. The choice is remembered in the patch settings.
*/
export type PatchDetachDeleteDialogView = 'grid' | 'list';

export const patchDetachDeleteDialogViews = ['grid', 'list'] as const satisfies readonly PatchDetachDeleteDialogView[];

export const patchDetachDeleteDialogViewDefault: PatchDetachDeleteDialogView = 'grid';

/** A stored view value, or the default when the config holds anything else. */
export function parsePatchDetachDeleteDialogView(value: unknown): PatchDetachDeleteDialogView {
  return typeof value === 'string' && (patchDetachDeleteDialogViews as readonly string[]).includes(value)
    ? value as PatchDetachDeleteDialogView
    : patchDetachDeleteDialogViewDefault;
}
