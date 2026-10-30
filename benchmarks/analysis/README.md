# Memory and performance analysis scripts

One-off tools used to find and measure the memory/perf changes in #1961, #1962, #1963, #1967 and #1968. They complement the scenario benchmarks (`benchmarks/scenarios`): those tell you *whether* something got better, these tell you *where* the memory and time go.

None of these are wired into npm scripts or CI. They're plain node scripts, run against a built copy of brighterscript.

## Setup

- **A brighterscript build (`<bscDir>`)**: any folder with `dist/` and `package.json`, eg. the repo root after `npm run build`. To compare versions, make a worktree (`git worktree add --detach <dir> origin/v1`), symlink the repo's `node_modules` into it, and run `npx tsc -p .`.
- **A project and its `args.json`**: run the scenario benchmark once (`npm run benchmark:scenarios -- run --projects <name> --runs 1`). That clones the pinned project into `benchmarks/.tmp/scenarios/projects/<name>@<sha>` and writes `benchmarks/.tmp/scenarios/runs/<run>/args.json` (the bsconfig and project dir). Scripts that take `<args.json>` should be run **from the project dir**, so plugins and `require` entries resolve the way they do for the project.
- **Memory**: the game engine needs `--max-old-space-size=12000` to parse its ~300MB heap snapshot.

## Scripts

### `snapshot/` — what's in memory after validation
Write a snapshot with `write-snapshot.js`, then point the others at it. Each one parses the whole snapshot, which takes a minute or two for big projects.

| Script | Answers |
|---|---|
| `write-snapshot.js` | Validate a project, GC, write a heap snapshot (keeps the program alive so it's in the snapshot) |
| `shapes.js` | Live objects grouped by class, or by property names for plain objects, with who holds each plain-object shape. Good first look at nested objects (eg. AST `tokens` sub-objects) |
| `nested-groups.js` | Totals for arrays by holder (including backing stores), AST `tokens` sub-objects, and `data` objects. Ignore the `Array.__proto__` row: it's the shared prototype counted once per array |
| `array-slack.js` | Unused capacity in arrays' backing stores, by holder (arrays grown with `push` keep ~17 slots). Arrays of plain numbers (eg. `linePositions`) show as empty, because numbers aren't element edges in the snapshot |
| `hidden-classes.js` | Per class: instances, distinct hidden classes, instances with out-of-object property stores, dictionary-mode instances |
| `late-props.js` | For the given classes: properties on every instance vs only some (= assigned after construction, which forks hidden classes) |
| `leftovers.js` | Everything still left after fixes: classes with >1 hidden class or out-of-object stores, and plain-object shapes that grew fields later |

### `live/` — walk the live program after validation
| Script | Answers |
|---|---|
| `empty-containers.js` | Every reachable empty `Map`/`Set`/array/`{}` by holder (`Class.property`), with empty/total counts and the bytes they cost. Skips `Proxy` objects, since reading through a ReferenceType proxy triggers type resolution |
| `token-stats.js` | Tokens by kind, how many are only reachable as trivia, trivia array counts |
| `duplicate-text.js` | How much identifier/literal text is duplicated within a file, and how many trivia arrays would empty out without whitespace |
| `parser-token-array.js` | How many tokens `parser.tokens` holds, and how many nothing else (AST, trivia) keeps alive |
| `token-hidden-classes.js` | Hidden classes across all tokens (needs `--allow-natives-syntax`) |
| `emit.js` | Transpile a project to `<outDir>` even if it has error diagnostics. Build with two versions and `diff -rq` the folders to prove output is byte-for-byte identical |

### `timing/` — phase timings, for changes too small to see end to end
Run each build in a fresh process and alternate builds (eg. 4 rounds of `v1`, candidate, `v1`, candidate...). Compare the min and median across rounds, not one run.

| Script | Answers |
|---|---|
| `lex.js` | `Lexer.scan` over every `.brs`/`.bs` file, 15 passes: median and min |
| `parse.js` | Lex once, then time N passes of `Parser.parse` over every file. Add `--cpu-prof --cpu-prof-dir=<dir>` to profile it, and summarize with `npm run benchmark:scenarios -- analyze <file>` |
| `phases.js` | Median ms per pass for `lex`, `parse` or `transpile` (via `program.getTranspiledFileContents`), after a full validate |

### `profile/` — heap profiles (`--profile heap` in the scenario benchmark)
| Script | Answers |
|---|---|
| `sites.js` | Retained memory by allocation site, with native allocations (`Map`, `Set`, `push`...) credited to the nearest JS caller |
| `site-diff.js` | Per-site difference between two heap profiles (before vs after a change) |
| `native-callers.js` | Who calls `Map`/`Set`/`push`/etc. for the memory still alive |

### `patches/` — preloaded into scenario runs with `--require`
| Script | Does |
|---|---|
| `count-member-tables.js` | Counts BscTypes created vs member tables actually created (writes `counts.json` to `COUNT_OUT`) |
| `drop-parser-tokens.js` | Experiment: empties every `parser.tokens` after parsing, to measure what keeping the array costs |

### `micro/`
| Script | Answers |
|---|---|
| `token-size.js` | Bytes per token for the real `TokenObject` and a few alternative layouts |

## Tips and gotchas
- Timings on a shared machine vary ±10–15% between runs. Use 5 runs with builds alternating, compare run *ranges*, and re-run anything surprising. Retained heap is deterministic to ~0.1MB.
- Don't run two test suites or benchmarks in the same checkout at once (they share `.tmp`), and don't switch branches in a checkout while a background run is using it.
- A second copy of brighterscript inside a plugin's dependencies (eg. under `ropm`) shows up in snapshots as stray hidden classes. Ignore those.
- ts-node picks up the wrong tsconfig when run from scratch folders. Load the compiled `dist` instead.
