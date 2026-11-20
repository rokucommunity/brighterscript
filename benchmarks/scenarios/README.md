# Scenario benchmarks

The ops/sec benchmarks in `benchmarks/targets` answer "is X faster than it was?". These answer "where does the time and memory go on a real project?" - and keep answering it the same way over time.

Each run is a fresh node process per project/version, and records:
- cold load and cold validate time, plus time per validate phase
- retained heap after validation (after a forced GC) and peak RSS
- edit re-validation, like typing in the language server: a comment added to (`body`) or a function added to (`api`) the script file in the most scopes (`shared`) and the biggest script file in only one scope (`leaf`). Every edit is reverted at the end
- a hash of all diagnostics, so a perf change that changes behavior gets caught. `edits restored` checks the diagnostics are identical after all the edits are reverted

Timings in the summary are the best (min) of `--runs`.

## Usage

```bash
npm run build
npm run benchmark:scenarios -- run
npm run benchmark:scenarios -- run --projects jellyfin-roku --runs 5
```

Compare versions in one go (first `--bsc` is the baseline). Anything other than `local` or a path gets npm installed into `.tmp`:

```bash
npm run benchmark:scenarios -- run --bsc 1.0.0-alpha.54 local
```

Compare runs from different branches:

```bash
npm run benchmark:scenarios -- run --label before
# ...switch branches, npm run build...
npm run benchmark:scenarios -- run --label after
npm run benchmark:scenarios -- compare before.json after.json
```

Profiling (`cpu` = whole run, `edits` = just the edit re-validation, `heap` = sampled allocations still live at the end), then summarize:

```bash
npm run benchmark:scenarios -- run --projects jellyfin-roku --runs 1 --profile edits
npm run benchmark:scenarios -- analyze scenarios/results/profiles/<label>/<file>.cpuprofile
```

`analyze` works on any `.cpuprofile` / `.heapprofile`, including ones from `bsc --profile` or `node --cpu-prof`.

Prototype a change without touching `src` by preloading a monkeypatch into every run:

```bash
npm run benchmark:scenarios -- run --require ./my-patch.js --label patched
```

## Projects

`projects.json` has public projects, pinned to a commit so results stay comparable. Put private projects in `projects.local.json` (gitignored) - see `projects.local.example.json`. A project can point at a `bsconfig`, override settings with `config`, `install` its npm deps (for plugins), and pin its edit targets with `editFiles`.

Results (and profiles) go to `scenarios/results`, which is gitignored.
