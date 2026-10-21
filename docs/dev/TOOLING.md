# Tooling

Commands for working on the code. Run them from the repository root; they cover every workspace.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Server (`tsx`) and web (Vite) together, on the first free ports from 3001 and 5173 (printed at start), so every checkout and worktree can run its own. `DATA_DIR` sets the data folder; a worktree defaults to the main checkout's `apps/server/data`. |
| `npm run check` | The one pre-commit command: Biome format and lint checks (no writes), TypeScript, every Vitest test, then knip. Stops at the first failing step; takes about 7 seconds. |
| `npm run typecheck` | TypeScript for every package. |
| `npm test` | Vitest, all packages. |
| `npm run lint` | Lint only, no writes. |
| `npm run format` | Apply Biome formatting. |
| `npm run fix` | Apply formatting and Biome's safe lint fixes (never the unsafe ones). |
| `npm run knip` | Unused files, exports, types and dependencies across workspaces. |
| `npm run build` | Typecheck and build the production web bundle. |

## Biome

The recommended lint preset, two-space indentation, single quotes, semicolons and a 120-column line. Import
organizing and the other assists are **off**, to avoid noisy import-order changes. Excluded: generated output,
`node_modules`, data directories, coverage, Playwright reports, TypeScript build metadata, the lockfile, `PLAN.md`,
every `AGENTS.md` and the vendored `slop_list.json` (kept byte for byte as upstream).

Rules turned off, and why (`biome.json`):

- `noNonNullAssertion`, `noExplicitAny`: validated graph lookups and the flexible node and provider boundaries would be
  rewritten for style only.
- `useExhaustiveDependencies`: changing effect dependencies or callback identities changes fetching and editor
  behaviour; that needs a React-focused change of its own.
- `noArrayIndexKey`: changing keys in ordered lists could change component identity and state.
- `useButtonType`, `useAltText`, `noStaticElementInteractions`, `noLabelWithoutControl`,
  `useAriaPropsSupportedByRole`: retrofitting these belongs in a dedicated accessibility pass. The other recommended
  accessibility rules stay on.
- `noDescendingSpecificity`: the stylesheets layer page and component overrides on purpose.
- `noUnsafeOptionalChaining`, **only in `apps/web/src/api.test.ts`**: its assertions inspect mock calls right after
  awaiting the requests. The rule stays on for application code.

A few `useOptionalChain` warnings remain, because Biome classifies their fixes as unsafe.

Large mechanical reformats go in their own `style:` commit, listed in `.git-blame-ignore-revs`. To hide them in local
blame:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## knip

`knip.json` lists the entry points explicitly: server startup, the web entry and Vite config, the package entry points
(including shared's `./ports` subpath) and the test files. Project patterns cover source and config files only, so
live data and build output are never scanned. Package entry exports are workspace APIs on purpose, and tests and
configs are roots of their own. There is no ignore list. knip may print redundancy hints about entry points its
plugins also infer; they don't fail `check`.

## Live checks

Never run anything against `apps/server/data`. To try the server against real data, copy `data/` to a temp folder and
run `node <repo>/node_modules/tsx/dist/cli.mjs <repo>/apps/server/src/main.ts` with the copy's parent as working
directory and `PORT` set; delete the copy afterwards (it holds the secrets and the master key).
