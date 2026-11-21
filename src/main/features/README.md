# `src/main/features/<name>/`

Fork-only feature slices: main-process part of one capability (ffmpeg / config / files).

- One capability = one `<name>/` directory. Keep the slice self-contained and deletable as a whole.
- Cross-process wiring only in `src/main/index.ts` (RPC actions) and `src/preload/index.ts`.
- Tests colocated as `*.test.ts`. See `AGENTS.md` → Feature slices.
