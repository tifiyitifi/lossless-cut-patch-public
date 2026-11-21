# `src/renderer/src/features/<name>/`

Fork-only feature slices: UI + hooks for one capability.

- One capability = one `<name>/` directory. Keep the slice self-contained and deletable as a whole.
- User-facing strings must go through `t()` / `<Trans>` (zero exemptions); no hardcoded UI copy.
- Tests colocated as `*.test.ts`. See `AGENTS.md` → Feature slices.
