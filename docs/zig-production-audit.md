# Zig indexing scope and validation

Zig follows the shared tree-sitter extraction and reference-resolution pipeline.
The vendored WASM recognizes syntax; TypeScript language hooks extract nodes
and dependencies. No Zig installation is required to index a project. Zig
0.16.0 is used only for optional compiler-backed validation.

## Supported indexing behavior

- Functions, methods, structs, enums, unions, opaque types, error sets, fields,
  enum/error members, type aliases, constants, variables and test declarations.
- Quoted identifiers, lexical ownership, declaration visibility, container
  methods and bounded inference of receiver types.
- Generic functions returning a literal container, initializer calls, field
  defaults, struct instantiations and type dependencies.
- Literal relative imports, scoped bindings, public alias chains and bounded
  literal `build.zig` module registrations. `root` resolves only when project
  evidence identifies an unambiguous root; `std` and `builtin` stay external.
- Incremental rebinding when imports or aliases change, removal of stale call
  edges, worker resolution and persistence across database reopening.
- `.zon` manifests are tracked as files, without fabricated declaration nodes.

The implementation reuses existing node/edge metadata and requires no database
schema migration. Re-index an existing project to discover its Zig files.

## Grammar provenance

The grammar source archive, vendored source change, tool versions, SHA256 checksums and license
are recorded in [the grammar build instructions](grammars/tree-sitter-zig.md).
The checked-in grammar and its MIT notice are copied into production packages.
The grammar is prebuilt; normal application builds do not rebuild it.

## Reproducible validation

From a normal development checkout with dependencies available:

```sh
npm run build
ZIG_COMPILER=zig npx vitest run \
  __tests__/zig-extraction.test.ts __tests__/zig-production.test.ts \
  __tests__/zig-static-semantics.test.ts __tests__/zig-instance-fields.test.ts \
  __tests__/zig-acceptance.test.ts \
  --reporter=default --reporter=json --outputFile=/tmp/zig-runtime-report.json
node scripts/check-zig-test-report.mjs /tmp/zig-runtime-report.json
node scripts/check-zig-package.mjs .
CODEGRAPH_PARALLEL_RESOLVE_MIN=0 node scripts/check-zig-package.mjs .
ZIG_COMPILER=zig node scripts/check-zig-ast.mjs
ZIG_COMPILER=zig node scripts/check-zig-ast.mjs --recovery-contract
```

The runtime report gate requires all five suites, at least 125 tests, no
failures and no skipped/todo tests. With Zig 0.16.0 available, controlled source
fixtures are independently checked by the compiler. The strict `std.zig.Ast`
differential contains 36 files: 34 accepted by both parsers and two rejected by
both. Recovery cases are checked separately and do not count as syntax parity.
The ordinary test suite can run without Zig; independent compiler invocations are then omitted, while graph assertions still run.

`zig-real-world-eval.test.ts` accepts externally supplied corpus paths through
its environment variables and snapshots source files without modifying the
original projects. Private source paths, filenames and symbols are not embedded
in the repository. Historical evaluation covered small, medium and large
snapshots (135, 294 and 1,517 Zig files), nine connected multi-step flow probes,
and stable graph counts after repeated indexing. Agent comparisons with Sonnet
high used two runs per arm and three prompts per corpus: successful CLI
contamination was zero, but residual reads and individually slower runs remain.
These observations do not establish universal retrieval-speed improvement.

### Fresh real-repository check (2026-10-31)

Pinned public snapshots: `zigtools/lsp-kit` `3e1058d` (11 Zig files),
`zigtools/zls` `25df3a3` (90), and `ziglang/zig` `738d2be9` (2,950).
The compiler index used a copy containing its `.zig` and `.zon` sources, with
relative paths preserved. Indexing succeeded on all three: 771, 4,593, and
135,499 nodes respectively. Three source-verified call chains per corpus were
queried through `codegraph explore`; all nine rendered connected three-hop
Flow sections. These probes establish graph connectivity for the named flows,
not a retrieval-efficiency improvement for agents.

The current ZLS snapshot has tree-sitter recovery in 2 of 90 files, and the
current Zig compiler snapshot in 103 of 2,950 files. Both snapshots contain
syntax beyond the Zig 0.16.0 fixture contract; these are real coverage gaps
for current development trees. `lsp-kit` parsed all 11 files. The generic
real-world test's fixed `>50` import threshold is too high for that small
corpus (15 imports observed); that failure is a size mismatch in the test
threshold, not an extraction exception.

On `lsp-kit`, two independent Sonnet high with/without runs asked how
`rangeToSlice` reaches `positionToIndex`. A persistent daemon was prewarmed,
the CLI was blocked in both arms, and no CLI attempt returned output:

| Run | CodeGraph: seconds / tools / Read | No CodeGraph: seconds / tools / Read |
| --- | --- | --- |
| 1 | 21 / 2 / 0 | 31 / 11 / 1 |
| 2 | 24 / 3 / 0 | 23 / 5 / 2 |

Each CodeGraph arm used two `explore` calls and no Grep. Retrieval residual
was 8,831 vs 10,314 tokens in run 1 and 8,927 vs 9,828 in run 2. The agent
requested a second `explore` after the first in both runs, but performed no
Read/Grep after either. One CodeGraph run was slower by one second, so the
strict faster-in-every-run retrieval acceptance target is **not met**. The
medium and large corpora have deterministic flow probes, not fresh agent A/B
runs; this small-corpus comparison cannot establish their agent efficiency.

## Recheck on public repositories (2026-10-31)

The standard grammar and rebased branch were exercised against three independent
public source snapshots. The index was written only to temporary copies.

| Repository snapshot | Zig files | Index result | Parser recovery |
| --- | ---: | --- | ---: |
| `zigtools/lsp-kit` `3e1058d` | 11 | 771 nodes, 1,790 edges | 0 files |
| `zigtools/zls` `25df3a3` | 90 | 4,593 nodes, 11,765 edges | 2 files |
| `ziglang/zig` `738d2be9` (Zig files only) | 2,950 | 135,499 nodes, 291,337 edges | 103 files |

The ZLS snapshot uses 0.18 development syntax; two files require grammar
recovery. The compiler snapshot includes intentionally invalid compile-error
fixtures **and** valid source the pinned 1.1.2 grammar recovers (including
inline assembly and fields named `async`/`await`). The 103-file figure is a
raw recovery count, not 103 valid-source defects; it also is not successful
strict syntax validation. `zig-real-world-eval.test.ts` uses an
absolute `>50` import threshold that the 11-file lsp-kit sample cannot meet
(15 imports), and its repeated full-corpus scans exceed the default 30-second
per-test timeout on the compiler snapshot. The index and the nine graph probes
below completed independently of those test-harness limits.

Three named, three-hop `codegraph explore` probes per repository all rendered
a connected Flow section (9/9). The small sample used offset conversion and
code generation chains; the medium sample used diagnostics, go-to-definition,
and completion chains; the large sample used build and AIR legalization chains.
This proves the named paths are present, not that an agent can answer every
natural-language question without further file access.

Sonnet high was run twice per arm on one flow question per repository with
CodeGraph MCP pre-warmed and the CodeGraph CLI blocked in both arms. The rows
show each independent run in order; `Read` counts are direct file reads.

| Size | With CodeGraph: seconds / Read | Without: seconds / Read | Explore follow-up |
| --- | --- | --- | --- |
| Small | 16 / 0; 23 / 0 | 21 / 1; 24 / 1 | A second Explore, then answer, in both runs |
| Medium | 38 / 2; 17 / 0 | 67 / 6; 26 / 4 | One run searched for a test file after Explore |
| Large | 29 / 1; 22 / 1 | 28 / 4; 19 / 5 | Both runs re-read `src/Air/Legalize.zig` |

The large project's Explore response was capped near 25 KB and omitted part of
the requested function body in a long source file; both agents then read that
same file. The large with-arm was slower in both runs and retained more
retrieval context than the without-arm. The strict near-zero Read/Grep and
faster-than-baseline acceptance target therefore remains **unmet**. These
three questions and two runs per arm are narrower than the full three-prompts-
per-repository agent matrix; the measurements should not be generalized beyond
the observed flows. The remaining retrieval gap is in Explore's source-window
allocation for long files, outside Zig parsing and import resolution.

## Explicit boundaries

This is static code indexing, not a Zig compiler or interpreter. It does not
evaluate arbitrary `comptime` code, computed build graphs/imports, generic type
execution or arbitrary vtable dispatch. `@embedFile` resolves only indexed
files, and C include search paths require separate build-system evidence.

Tree-sitter accepts three named malformed-source fixtures that Zig's AST rejects:
`reserved_declaration`, `unparenthesized_initializer` and `reserved_field`.
`__tests__/fixtures/zig-recovery-cases.json` records the exact expected nodes and
calls, including rejection of unrelated same-named targets. These fixtures make
recovery behavior explicit; they are not supported valid Zig syntax, and parser
acceptance alone must not be used as a syntax-validity guarantee.

Tests exercise both conservative negative resolution and successful edges.
Runtime availability and successful parsing alone are not acceptance evidence.
