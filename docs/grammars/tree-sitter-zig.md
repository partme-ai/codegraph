# tree-sitter-zig.wasm — provenance & rebuild

`src/extraction/wasm/tree-sitter-zig.wasm` is vendored because Zig has no
grammar in the `tree-sitter-wasms` npm package this repo otherwise loads from.

## Recorded facts (verifiable)

- **SHA-256**: `512184b21b9d234b9462f0afaeb6932d508ce7b21ca5247ee47e04ba191fa807`
- **Exported symbol**: `tree_sitter_zig`
- **tree-sitter ABI**: 15 (verified with `node scripts/add-lang/check-grammar.mjs
  src/extraction/wasm/tree-sitter-zig.wasm <sample>.zig` — 20/20 clean parses,
  safe to reuse across files)
- **Upstream**: built from a `tree-sitter-zig` grammar via
  `tree-sitter build --wasm`; the exact upstream repository and revision were
  **not recorded when the file was first vendored**. Before this ships, pin the
  revision: identify it by comparing the node-kind table below against upstream
  tags, then record repo + commit here the way `tree-sitter-cobol.md` does.

## What the grammar covers (node inventory as exercised by the tests)

Named node kinds the extractor relies on: `function_declaration`,
`variable_declaration`, `test_declaration`, `comptime_declaration`,
`using_namespace_declaration`, `container_field`, `struct_declaration`,
`enum_declaration`, `union_declaration`, `opaque_declaration`,
`error_set_declaration`, `call_expression`, `builtin_function`,
`field_expression`, `struct_initializer`, `anonymous_struct_initializer`,
`parameters`, `parameter`, `arguments`, `block`, `return_expression`,
`error_union_type`, `pointer_type`, `slice_type`, `array_type`,
`optional_type`, `nullable_type`, `builtin_type`, `identifier`.

Verified against Zig **0.16** source at scale (1.5k-file real project: labeled
switch, non-exhaustive enums, tagged unions with `inline else`, fat-pointer
vtables, `@cImport`, multiline strings — zero parse errors).

## Known grammar gaps (extraction compensates or skips)

- `comptime var x: T = ...;` at container/file scope does not parse (recovers
  into an ERROR node). The extractor skips ERROR subtrees entirely — no garbage
  nodes enter the graph, and the declaration is simply absent.
- `!foo(...)` / `!std.mem.eql(...)` parse with the negation operator inside the
  callee node (`error_union_type` root). The extractor strips the leading `!`
  from call reference names.

## Rebuild

```bash
git clone <pinned-upstream>/tree-sitter-zig && cd tree-sitter-zig
tree-sitter build --wasm
cp tree-sitter-zig.wasm <repo>/src/extraction/wasm/
# copy step also required by the root build (see copy-assets in package.json)
```

After any rebuild: update the SHA-256 above, then re-run the zig test suites —
`__tests__/zig-extraction.test.ts` is the behavioral contract for the node
kinds listed above.
