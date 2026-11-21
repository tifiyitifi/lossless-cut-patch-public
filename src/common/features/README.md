# `src/common/features/<name>/`

Fork-only feature slices: cross-process shared types + pure logic for one capability.

- One capability = one `<name>/` directory. Keep the slice self-contained and deletable as a whole.
- Pure logic only here (no Electron / DOM APIs); tests colocated as `*.test.ts`.
- See `AGENTS.md` → Feature slices.
