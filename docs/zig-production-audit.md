# Zig implementation audit — 2026-09-28; acceptance updated 2026-09-29

## Scope and architecture

This is a Brownfield repair of the existing Zig language integration. The
repository has no Spec Kit or OpenSpec change for this work; the existing
language contracts and executable regression tests are the acceptance source.
No specification framework was initialized. Changes remain uncommitted on
`feat/zig-supported`.

CodeGraph was checked and synchronized before inspecting extraction and
resolution. The comparison includes the shared tree-sitter walker, Go receiver
handling, Rust type extraction, reference normalization, and incremental edge
repair. Zig now follows the same grammar → language hooks → common graph
pipeline. The WASM is the compiled **Zig grammar**, not a separate implementation
of graph analysis. It recognizes syntax; language hooks still need to identify
containers, imports, generic factories, and Zig-specific type expressions.

| Defect | Correction | Regression evidence |
| --- | --- | --- |
| Legal empty containers produced hidden `MISSING` identifiers | Patch the grammar for struct/enum/union/opaque; rebuild WASM | Four AST tests assert `rootNode.hasError === false` |
| A nested `@import` swallowed surrounding initializer calls | Inspect builtin AST nodes and use the common body walker | `wrap(@import(...), other())`, nested `@as`, exactly one import |
| Initializer and field-default calls had missing/wrong owners | Preserve declaration/field scope while visiting expressions | Constant ownership and field-default call tests |
| Union payloads, unnamed parameters, local annotations and qualified types lost dependencies | Use grammar fields and preserve qualified type names | Payload, extern parameter, local annotation and namespace tests |
| Nested receiver methods lost enclosing container qualification | Preserve lexical container ownership | `Outer::Inner::run` |
| Explicit error unions and `@This()` had unusable return types | Extract success type and normalize self type | Return-type assertions |
| Generic factory chose an unrelated local container | Find the container under the actual return expression | Factory with local helper type plus validation call |
| C includes were truncated and comments disrupted argument parsing | Read builtin arguments from the AST | Long header path and intervening line comment |
| Relative import aliases could resolve to unrelated same-name symbols | Carry lexical import evidence into a small Zig resolver | Root-level decoy, local aliases, named aliases, absent targets |
| Target deletion lost import constraints during incremental repair | Persist and restore existing candidate metadata | Rename target, reject decoy, restore target, rebind |
| Optional real-repo test failed during collection; weak assertions concealed gaps | Guard absent fixture paths and separately check extraction errors and syntax recovery | Default suite skips unavailable fixtures; configured suites exercise actual files |

The resolver consumes AST-derived import candidates and caches compact alias
bindings parsed from current source (16 files per resolution context). It uses
existing reference and edge metadata; no database schema migration is required.
Language helpers remain together in `src/extraction/languages/zig.ts`, matching
the one-file-per-language layout. Build-module analysis belongs to resolution.

## Grammar provenance and reproducibility

The previous WASM was already in commit
`3057755426ae400a0f05c0e4d0acfb52f9006fc8` (2026-06-07); its exact upstream
revision was undocumented. It was not downloaded during this audit and did
not match the published upstream binary byte-for-byte.

The replacement is built from a checksummed upstream 1.1.2 source archive,
the checked-in four-line patch, Tree-sitter CLI 0.27.0 and Zig 0.16.0. The user
authorized the temporary CLI installation under `/tmp`; no global tools or
project dependencies were changed. Two independent builds produced the same
SHA-256, and the runtime passed 100 repeated parses before replacement.

See [grammar source, license and rebuild instructions](grammars/tree-sitter-zig.md).

## Real-source validation

Tests use temporary snapshots of `.zig`/`.zon` sources, excluding generated
outputs, caches and vendor directories. The original projects were not edited
or initialized by this validation. Counts describe these snapshots, not every
file in each original repository. Private validation projects are identified
only by corpus labels; their names, paths, filenames and symbol-level prompts
are kept outside repository documentation and code. Graph totals below were
refreshed after the 2026-09-29 acceptance fixes.

| Snapshot | Zig files | Indexed files including ZON | Nodes | Edges | Syntax-error files |
| --- | ---: | ---: | ---: | ---: | ---: |
| Private corpus S | 135 | 136 | 2,136 | 3,078 | 0 |
| nullclaw | 294 | 295 | 27,128 | 75,647 | 0 |
| Private corpus L | 1,517 | 1,520 | 38,401 | 71,921 | 8 |

The strict configured suite passes 7 tests with 1 optional fixture skipped on
each of the first two snapshots. The large snapshot passes 6, fails the strict
syntax gate, and skips 1. All eight reported source files are also rejected by
Zig 0.16.0 `zig fmt --check`. They are not silently exempted. The errors
comprise four uses of reserved identifiers, one missing closing parenthesis,
one invalid local declaration, one unfinished expression, and one missing
semicolon. Identifying source filenames are omitted.

The previous grammar reported 147 affected files on the large snapshot; the
replacement removes 139 false syntax failures. This does not establish that
the three applications compile or behave correctly.

Re-indexing independent copies of all three snapshot databases leaves both
node and edge counts identical to the table above (no accumulation or node
explosion). Existing databases used by the agent evaluations were not mutated
during those runs.

Nine multi-step deterministic `codegraph_explore` probes produce a connected
Flow section (three per snapshot):

| Snapshot | Multi-step probes | Result |
| --- | ---: | --- |
| Private corpus S | 3 | Connected Flow sections |
| nullclaw | 3 | Connected Flow sections |
| Private corpus L | 3 | Connected Flow sections |

The initial one-hop queries also returned source and relationships; the common
renderer intentionally omits the Flow heading for a two-node static path.
That presentation rule was not changed just to satisfy an output assertion.

## Initial repair tests and agent-evaluation results (historical)

Reproduction commands:

```bash
npm run build
npx vitest run __tests__/zig-extraction.test.ts __tests__/zig-production.test.ts
npx vitest run --maxWorkers=2 --minWorkers=1
ZIG_E2E_ROOT=/absolute/path/to/snapshot \
  npx vitest run __tests__/zig-real-world-eval.test.ts
```

The initial repair passed 96 dedicated Zig tests. The later static-semantics
verification is recorded below; agent timings in this section are from the
earlier build and were not rerun after that extension. Build includes the viewer and validates
that all 30 grammars are packaged. The first final full-suite attempt passed
5,238 tests and skipped 266, but failed the pre-existing UI latency assertion
(240 ms against a 100 ms threshold) under concurrent evaluation load. Its
complete 63-test file passed on isolated rerun, without changing that threshold.
The full rerun with two workers passes **5,239 tests**, skips **266**, and has
**zero failures** (295 passed / 17 skipped test files, 341 seconds). Verification
host: macOS arm64, Node 24.18.0. `git diff --check` also passes.

A subsequent full rebuild of this repository's own index revealed a separate
fixture drift in that optional UI test: `LRUCache.get` has only 17 incoming
edges in a fresh graph, so its hardcoded “500+” assumption is obsolete. The
test now targets the actual `extractFromSource` hub (710 incoming edges at
audit time), retaining the 500+ minimum, capped/grouped lists and 100 ms bar.
At that stage, all 63 tests in the affected file passed after this correction;
the test-only follow-up was verified with the complete affected suite. The
static-semantics extension below adds subsequent product changes and has its
own final validation record.

Raw validation artifacts are retained locally outside this repository. They
include snapshot statistics, grammar diagnostics, stability checks, flow
outputs and agent session metrics. They are not documentation or distributable
fixtures because they contain private validation source identifiers.

Agent runs use three consecutive, read-only flow questions per session, two
independent sessions per arm, the same questions in each arm, and the existing
CLI-contamination guard. Initial alias-based runs are excluded: this host maps
`sonnet` to DeepSeek in its user settings. The accepted runs explicitly select
`MODEL=claude-sonnet-4-6` with `--effort high`; each result's `modelUsage` is
checked. This process-local override leaves global settings unchanged.

Each row below is one complete three-question session; tool counts include
Bash, not just Read/Grep. All accepted runs return successfully, report the
selected Sonnet model, and have zero successful blocked-CLI contamination.
Grep-tool counts are zero throughout; Bash may still perform source searches.

| Snapshot / run | Seconds with / without | Tools with / without | Read with / without | Bash with / without |
| --- | ---: | ---: | ---: | ---: |
| Private corpus S / 1 | 30.4 / 115.5 | 4 / 33 | 0 / 11 | 0 / 22 |
| Private corpus S / 2 | 99.2 / 124.1 | 11 / 24 | 0 / 9 | 4 / 15 |
| nullclaw / 1 | 58.1 / 99.5 | 7 / 24 | 3 / 11 | 1 / 13 |
| nullclaw / 2 | 111.6 / 108.6 | 13 / 20 | 2 / 7 | 6 / 13 |
| Private corpus L / 1 | 35.1 / 93.6 | 3 / 32 | 0 / 16 | 0 / 16 |
| Private corpus L / 2 | 127.0 / 110.4 | 14 / 26 | 0 / 8 | 12 / 18 |
| TypeScript control / 1 | 69.3 / 87.2 | 7 / 23 | 0 / 12 | 0 / 11 |
| TypeScript control / 2 | 85.1 / 136.4 | 19 / 34 | 11 / 19 | 4 / 15 |

The two-run mean/median is faster with CodeGraph on each Zig snapshot, but two
individual with-arm sessions are slower. Private corpora S and L each have one
fully clean session (no Read/Grep/Bash). Nullclaw still has 2–3 Read calls and
source re-reading in both runs. This is evidence of useful retrieval, **not**
proof of consistently zero fallback or universally lower latency.

The existing harness also records its three feedback metrics. With-arm
residual retrieval occupancy ranges from 14,686–25,270 estimated tokens for
private corpus S, 24,531–35,764 for nullclaw, and 22,504–24,784 for
private corpus L. The
corresponding citation-attributed allocation shares are 81.8–87.7%, 68.0–90.1%,
and 53.4–58.5%. These relative citation metrics are not a measure of absolute
waste. Next-action classifications expose returned-source re-reads (two per
nullclaw run) and Bash searches; resumed turns can also classify the next
question's explore as `explore_again`. Full per-run data is preserved in
the private local summary and harness logs outside this repository.

The TypeScript control is this repository, with three questions tracing
`TreeSitterExtractor.extract → visitNode`, `ReferenceResolver.resolveAll →
resolveOneInner`, and `ToolHandler.execute → handleExplore`. It also shows
run-to-run fallback variance while remaining faster with CodeGraph in both
runs. Its with-arm residual occupancy is 46,323–49,823 estimated tokens and
citation-attributed allocation is 48.8–63.7%. This is a current-build control,
not a before/after performance comparison against a separately built old
commit. Cross-language functional regression is covered by the full suite.

## Acceptance status

The identified grammar, extraction, literal-import resolution, incremental
repair and reproducible-build defects are fixed and verified. The bounded
static-analysis behavior has direct regression and real-source evidence.
The stronger retrieval goal of consistently answering without source-search
fallback is not fully demonstrated by these runs; no universal performance or
compiler-semantic production-readiness claim is made. The remaining boundaries
below must be retained in any release statement. Remote CI and deployment are
outside this local verification.

## Compatibility and remaining boundaries

- Existing indexes require `codegraph index` to refresh already-indexed Zig
  source with the new grammar and reference evidence. A no-change incremental
  sync does not reparse every unchanged file after an extractor update.
- Literal relative `.zig` imports, public alias chains, and a bounded subset
  of unconditional `build.zig` module registration are covered. Supported build
  forms use literal `b.path`, `createModule`/`addModule`, artifact `root_module`,
  and `addImport`. Conditional bindings, helper execution, inline `.imports`
  tables, dependency downloads, computed imports, arbitrary comptime evaluation
  and vtable dispatch remain outside the proven static subset. Cycles, private
  members and ambiguous module/root ownership remain unresolved.
- External modules such as `std` remain outside a project-only graph. Embedded
  files must be admitted to the index; C include paths need build-system data.
- Shared heuristic resolution is still heuristic for references without a
  proven import binding. This audit does not claim compiler-level soundness
  or complete Zig semantic analysis.
- No new dynamic-dispatch synthesis rule is introduced. Import-resolution
  edges use explicit lexical evidence; the negative tests reject decoys.
- Final local validation covers macOS arm64 and Linux arm64. After Docker
  was restarted, the final code passed all 118 Zig regressions and the package
  smoke on Linux arm64 / Node 24.21.0. This Linux run exercises JS/WASM graph
  behavior; compiler-backed fixtures and the Ast oracle were verified on
  macOS with Zig 0.16.0. Windows and remote CI have not run. No publication or
  production deployment is performed by this change.

## Static semantics acceptance extension

Acceptance requires compiler-valid fixtures to preserve exact
symbol names, ownership and call targets for string identifiers, commented
`@call` arguments, inline/escaped literal imports, public function/type aliases,
and unambiguous standalone root modules. Private members, cycles, missing
modules and ambiguous roots must not create guessed edges. Intermediate alias
edits must rebind unchanged callers; incremental and clean indexes must agree.
The grammar notice must ship beside the WASM in source packages and bundled
releases. Compiler checks run only on controlled fixtures, never arbitrary
indexed projects. Passing these checks establishes this declared static subset,
not evaluation of every Zig program or arbitrary comptime/dynamic dispatch.


## Static semantics implementation and syntax differential

The extension handles escaped/quoted identifiers and imports, comments inside
`@call`, inline imports, public function and type re-exports, enum receivers,
ordinary instance inference, and unambiguous root/build-module bindings. Alias
and build edits rebind unchanged callers. A failing regression exposed parked
references that did not recover after a conditional module registration became
static again; Zig edits now retry failed Zig references as well as reopening
edges with changed dependency evidence. This may add work on large Zig edits;
no-change syncs and other languages are unaffected by that retry.

Fresh-process tests cover parsing workers, resolution workers, sync and reopen.
They caught missing grammar initialization that in-process tests concealed.
The MIT grammar notice is copied next to the WASM and checked in staged packages.
The release workflow now depends on a reusable Zig validation job; its remote
execution remains outstanding.

`std.zig.Ast` is an independent syntax oracle, not a runtime dependency or a
compiler-semantic call-graph oracle. The helper reads source and calls
`Ast.parse`; it never executes corpus `build.zig` or application code. The Node
runner checks both disagreement directions and fails on any disagreement.
The fixture command passes 31 valid source files plus 2 malformed controls.

```bash
ZIG_COMPILER=/absolute/path/to/zig-0.16.0 node scripts/check-zig-ast.mjs
# Optional: a local JSON array of absolute source paths; no corpus paths are logged.
ZIG_COMPILER=/absolute/path/to/zig-0.16.0 node scripts/check-zig-ast.mjs /tmp/source-paths.json
```

| Corpus | Files | Accepted by both | Rejected by both | Only Ast rejects | Only WASM rejects |
| --- | ---: | ---: | ---: | ---: | ---: |
| Private corpus S | 135 | 135 | 0 | 0 | 0 |
| nullclaw | 294 | 294 | 0 | 0 | 0 |
| Private corpus L | 1,517 | 1,506 | 8 | 3 | 0 |

The large corpus **fails strict syntax parity**: three additional malformed
files are accepted by the tolerant grammar (missing separators/initializers
and declaration placement diagnostics). These are retained as measured
limitations, not hidden by exclusions or more grammar patches. All 1,935 files
accepted by Zig Ast are also accepted by the WASM; this does not prove all Zig
syntax is supported. Tree-sitter recovery diagnostics are not a replacement
for compiler validation. The nine Flow probes and two independent clean graph
builds per corpus pass with the node/edge counts shown above.


## 2026-09-28 local verification (before acceptance extension)

- Final complete suite: **5,261 passed, 266 skipped, zero failures** across
  297 passing and 17 skipped test files (221.41 seconds). This run includes
  the final receiver and failed-reference recovery fixes.
- `npm run build`: passes, including the viewer, all 30 grammar assets and the
  Zig MIT notice.
- Compiler-backed Zig suites: **118 passed**. The 17 static fixture scenarios
  and the same-name field/receiver fixture also pass the Zig 0.16.0 compiler.
- Controlled Ast differential: **33 files**, 31 accepted and 2 rejected by both
  parsers; zero disagreements. Corpus limitations are detailed above.
- Source npm tarball: packed, extracted, production dependencies installed,
  and package smoke passed using the extracted package's own runtime modules.
- Final Linux arm64 container / Node 24.21.0: **118 Zig tests passed** in
  30.63 seconds, with no failures or skips. A separately packed/extracted npm
  artifact with production dependencies passed both normal resolution and
  forced resolver-worker smoke checks. Core source/test checksums match the
  host working tree; the packaged WASM checksum matches the recorded build.
- Self-contained macOS arm64 archive: built, extracted, and smoke-tested with
  its bundled Node 24.16.0, including alias rebinding and graph reopen. Its CLI
  reports 1.6.0. The archive uses the WASM path; no native kernel was present.
- CodeGraph's own index was synchronized, and the new helpers/resolver paths
  were checked through `codegraph explore`; status is up to date.
- Workflow YAML parsing, Zig helper formatting and `git diff --check` pass.

The current acceptance source remains this audit plus executable tests; no
OpenSpec or Spec Kit lifecycle was initialized. The changes and local archive
are ready for review against the declared static-indexing scope. Release
publication is still gated on remote CI/platform validation. Do not describe
this as 100% compiler semantics, strict corpus syntax parity, or a published
production release.


## 2026-09-29 declared acceptance contract

This section is the acceptance source for the follow-up hardening, together
with the named executable fixtures. It refines the existing audit; no second
specification framework is introduced. “100%” means all required checks in
this bounded contract pass, not all possible Zig programs or runtime behavior.

| Requirement | Executable evidence | Pass condition |
| --- | --- | --- |
| Zig 0.16.0 controlled syntax | `check-zig-ast.mjs` | 34 valid source files and 2 invalid controls agree with Ast; no unexpected difference |
| Recorded recovery differences | `zig-recovery-cases.json`, `check-zig-ast.mjs --recovery-contract`, `zig-acceptance.test.ts` | All three remain Ast-invalid; exact retained nodes/calls match the reviewed expectations; no decoy edges |
| Declaration identity and ownership | `zig-acceptance.test.ts` | Exact 17-node schema, including error-set members; correct kinds, qualified names, visibility and calls |
| Static call targets | `zig-static-cases.json` | 19 named compiler-valid scenarios; expected calls match exactly, so both missing and extra targets fail |
| Incremental correctness | `zig-acceptance.test.ts`, static-semantics tests | Module retargeting, alias edits, deletion and restoration agree with clean graph rebuilds |
| No skipped runtime requirements | `check-zig-test-report.mjs` | All five required suites pass, at least 125 tests, no skipped/todo/failed tests, no missing or empty suite |
| Packaged runtime | `check-zig-package.mjs` | Grammar + notice, error members, quoted names, public aliases, rebind and reopen pass from the packed artifact, with normal and worker resolution |
| Native platform matrix | `zig-validation.yml` | Linux/macOS/Windows × x64/arm64 × Node 22/24 all pass; compiler and full cross-language regression job passes |

The three recovery fixtures are independently written minimal cases, not
copies of private source. They preserve the distinctions between strict syntax
parity and tolerant indexing: the recovery checker explicitly reports
`strictSyntaxParity: false`. Default corpus mode still fails on **any** syntax
disagreement. No whitelist silently turns a strict parity failure into success.
For malformed source, CodeGraph may retain recognizable declarations and
lexical references; it does not certify that the program compiles. Recovery
must not invent declarations from unquoted reserved words or attach unsupported
member expressions to unrelated same-named functions.

The new contracts first failed on three concrete behaviors: an illegal bare
`export` declaration could bind a legal quoted call, quoted keyword names lost
their necessary quoting, and error-set members were missing. A further
compiler-valid cross-file enum case exposed private visibility incorrectly
assigned to implicitly public members. The fixes stay in the Zig language
module: canonicalize reserved identifiers correctly, reject keyword declaration
names, emit error members, and preserve enum/error member visibility. The
WASM and grammar patch are unchanged.

The runtime gate also rejects deliberately corrupted reports containing a
skip, a reduced test denominator, or a missing suite. The platform matrix uses
native runner labels from [GitHub's runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
and validates packed production dependencies on each platform. The workflow
has push, pull-request and manual triggers and remains a required dependency
of the existing release workflow. Running validation does not publish a release.

Local and remote evidence must remain distinct: adding the matrix is not proof
it ran. The local-only snapshot below is historical; the completed remote matrix
is recorded in the subsequent remote acceptance section.


### 2026-09-29 local gate evidence

- macOS arm64 / Node 24.18.0: all **125 runtime contract tests passed**, with
  zero skips, using Zig 0.16.0 for the 19 static scenarios, receiver fixture
  and node-schema fixture. Both Ast modes passed their stated contracts;
  strict parity remains false for the three named recovery cases.
- Linux arm64 / Node 22.23.3 and 24.21.0: **125/125** runtime tests pass on each,
  with zero skips. Separately packed production artifacts pass normal and
  forced-worker resolution, including the new error-member/keyword assertions.
- The rebuilt macOS arm64 archive passes those same package checks with its
  bundled Node 24.16.0. No native extraction kernel was present; Zig uses WASM.
- All three real-source snapshots were independently rebuilt twice after the
  fixes: graph totals are stable, and all nine multi-step Flow probes pass.
  Error-set members now account for the additional source-backed nodes. The
  final complete suite passes **5,268 tests**, skips **266 optional tests**,
  and has **zero failures** (298 passing / 17 skipped files, 255.33 seconds).
  Required Zig suites have zero skips. This supersedes the earlier dated totals.

| Native platform | Node 22 | Node 24 |
| --- | --- | --- |
| Linux arm64 | Local pass | Local pass |
| macOS arm64 | Remote run pending | Local pass |
| Linux x64 | Remote run pending | Remote run pending |
| macOS x64 | Remote run pending | Remote run pending |
| Windows x64 | Remote run pending | Remote run pending |
| Windows arm64 | Remote run pending | Remote run pending |


At the end of the local-only pass, remote execution was still pending. Before
pushing, the existing `feat/zig-supported` branch was checked: the working HEAD was
`40f112453583a2304c4b605a3a9d6545919662bd`, and it is 627 commits ahead of the
remote branch, with no remote-only commits. Publishing the local changes on
that branch would also upload those existing commits. No commit, push, tag or
release was performed during this local acceptance pass.

### 2026-09-29 remote acceptance after main merge

The user authorized committing and pushing all changes. Local `main` was
fast-forwarded to `003305f1e7edbb2f3b966f1631585aab02cef7bf`; merge
`3c78c1d76dbaeacf1c8fab925a24975589cc0fab` incorporates it into
`feat/zig-supported`. No conflict or history rewrite was required.

[Zig validation run 36452441903](https://github.com/partme-ai/codegraph/actions/runs/36452441903)
completed successfully on tested commit
`11a5422ba6f52597b99ced20dae8f793fccdf672`: all 13 jobs passed.
The 12 downloaded runtime reports each contain **125 passed, zero failed and
zero skipped tests**. Every platform also passed normal and forced-worker
checks against its separately packed production artifact.

The Linux x64 compiler job passed all **125 compiler-backed graph tests**,
strict Ast comparison on **36 files** (34 accepted by both, two rejected by
both, zero disagreements), and the three explicitly separate recovery cases.
The complete cross-language suite passed **5,285 tests**, with **274 skipped**
and **zero failures** (299 passing / 17 skipped files). The required Zig suites
have no skips. After merging main, the local build and 150 targeted tests also
passed, including main's 25 new source-completeness tests.

| Native platform | Node 22 | Node 24 |
| --- | --- | --- |
| Linux arm64 | Remote pass | Remote pass |
| macOS arm64 | Remote pass | Remote pass |
| Linux x64 | Remote pass | Remote pass |
| macOS x64 | Remote pass | Remote pass |
| Windows x64 | Remote pass | Remote pass |
| Windows arm64 | Remote pass | Remote pass |

Remote execution exposed two CI portability issues, now fixed: Git Bash paths
must be normalized before tar extracts a Windows archive, and the three-cycle
incremental/clean-index parity test needs a 30-second integration-test timeout
on Windows ARM instead of Vitest's default five seconds. All graph assertions
and the zero-skip gate remain intact; no tests were removed or retried into a
passing report.

The declared acceptance contract is now satisfied, including the native
platform matrix and compiler/full-regression gate. This is release-readiness
evidence for the bounded static-indexing contract, not proof of all possible
Zig semantics or strict syntax parity on malformed programs. The three named
recovery differences remain documented. No tag, npm publication or release
workflow was triggered.
