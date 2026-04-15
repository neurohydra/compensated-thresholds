# Claude Code Instructions — compensated-thresholds

## Project documentation

The full project spec lives in `AI_DOCUMENTATION.md`. Read it at the start of every session before making any changes.

## Keep AI_DOCUMENTATION.md up to date

Whenever a change affects any of the following, update `AI_DOCUMENTATION.md` before finishing the task:
- Tech stack or dependencies (`package.json`)
- File structure (new files, moved files, renamed files)
- Key TypeScript interfaces (in `src/lib/`)
- Analysis methodology or algorithms
- Localisation approach or new locale keys
- Deployment / infrastructure

The doc does **not** need to track: individual bug fixes, styling tweaks, translation copy changes, or refactors that don't change behaviour.

## Coding conventions

- All user-visible strings must go through i18next (`t()` in components, `t: TFunction` param in helpers). Never hardcode UI strings in `src/lib/` files — return i18n keys + params instead.
- Keep `src/lib/` free of React imports; they are pure TypeScript.
- The app has no backend. Everything is client-side.
